"""Lost-property prerequisites and unrelated passenger requests stay separate."""

from copy import deepcopy
from unittest.mock import patch

from services.dialogue_policy import approve_free_reply
from services.generator import DemoGenerator
from tests.test_smoke import GameTestCase, intent


class NpcInteractionFeedbackTest(GameTestCase):
    def state(self):
        return self.service.store.get(self.client.get_cookie("train_game").value)

    def test_cleaner_never_opens_lost_property_before_elder_information(self):
        self.three()
        for topic in ("greeting", "lost_ticket", "appearance", "help", "greeting"):
            with self.subTest(topic=topic):
                self.t("cleaner", topic)
                self.assertNotRegex(self.data["reply"], "분실|잃어버|승차권|모양|특징|노인.*대화")
                self.assertEqual(self.state()["pending_dialogue"], "")
                self.assertNotIn("ticket_old", self.items())
                self.assertFalse(any("describe" in c["id"] or "ticket" in c["id"]
                                     for c in self.data["game"]["choices"]))
        self.call(value=intent("describe", "cleaner", "appearance", features=["faded", "hole"]))
        self.assertNotIn("ticket_old", self.items())
        self.assertEqual(self.state()["pending_dialogue"], "")
        self.a("select_npc", "elder")
        self.t("cleaner", "lost_ticket")
        self.assertNotIn("ticket_old", self.items())
        self.assertNotRegex(self.data["reply"], "분실|승차권|모양|특징")
        self.t("elder", "appearance")
        self.t("cleaner", "lost_ticket")
        self.assertEqual(self.state()["pending_dialogue"], "describe_ticket")
        self.call(value=intent("describe", "cleaner", "appearance", features=["faded", "hole"]))
        self.assertIn("ticket_old", self.items())

    def test_generated_cleaner_smalltalk_cannot_offer_the_ticket_branch(self):
        self.three()
        self.a("select_npc", "cleaner")
        before = self.state()
        with patch.object(self.model, "generate", return_value="잃어버린 물건의 모양을 설명해 주시겠어요?"):
            self.call(value=dict(intent(target="cleaner", topic="background"), dialogue_mode="lore"),
                      message="무슨 일을 하세요?")
        self.assertNotRegex(self.data["reply"], "분실|승차권|잃어버|모양|특징")
        self.assertEqual(self.state()["flags"], before["flags"])
        self.assertEqual(self.state()["pending_dialogue"], "")
        for mode in ("lore", "smalltalk"):
            self.assertNotIn("분실물", approve_free_reply("분실물이 있으면 모양을 설명해 주세요.", "cleaner", mode, before))

    def test_restroom_request_cannot_consume_engine_choice_or_pending_mission(self):
        self.four()
        self.a("select_npc", "attendant")
        self.call(action=self.data["game"]["choices"][0]["action"])
        self.assertIn("기관실", self.data["game"]["choices"][0]["label"])
        for phase in ("before_engine_request", "waiting_for_anomaly", "mission_offer", "permission_granted"):
            if phase == "waiting_for_anomaly":
                self.t("attendant", "permission")
            elif phase == "mission_offer":
                self.t("attendant", "loop")
                self.t("attendant", "permission")
            elif phase == "permission_granted":
                self.office()
                self.a("move", "crew")
                self.a("read_report")
                self.a("ack_document", "route_report")
                self.a("move", "car_4")
                self.a("present", "route_report", recipient="attendant")
            for topic in ("permission", "help", "stop"):
                with self.subTest(phase=phase, topic=topic):
                    before = self.state()
                    value = dict(intent(target="attendant", topic=topic), dialogue_mode="scenario",
                                 dialogue_choice_id=self.data["game"]["choices"][0]["id"].removeprefix("car_4."))
                    self.call(value=value, message="화장실에 가고 싶어요.")
                    self.assertIn("화장실", self.data["reply"])
                    self.assertNotRegex(self.data["reply"], "기관실|승무원실|출입금지")
                    after = self.state()
                    for field in ("flags", "inventory", "pending_dialogue", "scenario_steps", "confirmation"):
                        self.assertEqual(after.get(field), before.get(field))

    def test_general_help_does_not_start_an_engine_request(self):
        self.four()
        self.t("attendant", "help")
        self.assertNotIn("기관실", self.data["reply"])
        self.assertEqual(self.state()["pending_dialogue"], "")
        for topic in ("permission", "stop"):
            self.t("attendant", topic)
            self.assertIn("기관실", self.data["reply"])
            self.assertEqual(self.state()["pending_dialogue"], "why_engine")

    def test_restroom_grounding_preserves_a_separate_explicit_engine_request(self):
        value = intent(target="attendant", topic="permission")
        parsed = DemoGenerator()._ground(value, "화장실은 나중에 가고 기관실에 들어가고 싶습니다.",
                                          {"active_npc": "attendant"})
        self.assertEqual(parsed["topic"], "permission")

    def test_removed_attendant_choices_do_not_return_after_authored_dialogue(self):
        self.four()
        sample = deepcopy(self.state())
        sample["npc"] = "attendant"
        for door_open in (False, True):
            sample["flags"]["door_open"] = door_open
            with patch.object(self.service.engine, "_scenario_options", return_value=[]):
                while True:
                    choices = self.service.engine.choices(sample)
                    self.assertNotRegex(str(choices), "표정을 살핀다|걱정되는 일")
                    if choices[0]["id"] == "end_talk":
                        break
                    self.service.engine.choose(sample, choices[0]["id"])
