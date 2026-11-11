"""Offline API regressions for semantic dialogue, authored choices, and gates.

The fixture supplies semantic classifier results, never game outcomes. The real
request routing, game engine, persistence, inventory events, and public choices
must agree regardless of a coarse dialogue-mode classification or an interlude.
Live classifier wording is checked separately by the opt-in QA tools.
"""

from copy import deepcopy
import json

import app as web
from services.dialogue_policy import fallback_reply
from tests.test_smoke import GameTestCase, ScriptedModel, intent
from tools.live_dialogue_cases import protected_state


class SemanticDialogueFixture(ScriptedModel):
    def __init__(self):
        super().__init__()
        self.utterances = {}

    def interpret(self, message, context):
        return deepcopy(self.utterances.get(message, self.value))

    def generate(self, question, username, character, knowledge):
        runtime = character.get("_runtime", {})
        mode = runtime.get("dialogue_mode")
        if mode:
            return fallback_reply(character["_id"], mode)
        return runtime.get("canonical", "")


class FreeTextProgressionTest(GameTestCase):
    def setUp(self):
        super().setUp()
        self.model = SemanticDialogueFixture()
        self.service.generator = self.model

    def state(self):
        return self.service.store.get(self.client.get_cookie(web.COOKIE).value)

    def say(self, message, topic="other", *, kind="talk", npc=None, target=None,
            recipient="", dialogue_mode="scenario", choice_id="", mode="act", features=()):
        value = dict(intent(kind, target or npc or self.data["game"]["npc"], topic,
                            mode=mode, features=features, recipient=recipient),
                     dialogue_mode=dialogue_mode, dialogue_choice_id=choice_id,
                     quote=message)
        self.model.utterances[message] = value
        return self.call(message=message)

    def restore(self, checkpoint):
        """Fork an earned synthetic checkpoint; never touch a player's save."""
        gid = self.client.get_cookie(web.COOKIE).value
        with self.service.store.connect() as db:
            db.execute("UPDATE games SET state=?,revision=?,lease=NULL,lease_until=0 WHERE id=?",
                       (json.dumps(checkpoint, ensure_ascii=False), checkpoint["revision"], gid))
        self.data = self.service.snapshot(gid)

    def explorer(self):
        self.a("inspect", "notice")
        self.a("move", "car_2")
        self.a("select_npc", "explorer")

    def driver(self):
        self.four()
        self.office()
        self.a("move", "crew")
        self.a("read_report")
        self.a("ack_document", "route_report")
        self.a("move", "car_4")
        self.a("present", "route_report", recipient="attendant")
        self.a("move", "engine")
        self.a("select_npc", "driver")

    def prepare_npc(self, npc):
        if npc == "explorer":
            self.explorer()
        elif npc == "elder":
            self.three()
            self.a("select_npc", npc)
        elif npc == "cleaner":
            self.three()
            self.t("elder", "appearance")
            self.a("select_npc", npc)
        elif npc == "attendant":
            self.four()
            self.a("select_npc", npc)
        else:
            self.driver()

    @staticmethod
    def acquisitions(data):
        return [event["item"]["id"] for event in data["events"]
                if event["type"] == "item_acquired"]

    def outcome(self):
        return {"progress": protected_state(self.state()),
                "acquisitions": self.acquisitions(self.data),
                "choices": self.data["game"]["choices"],
                "ui": {key: self.data["ui"][key]
                       for key in ("document", "compose", "inventory", "control")
                       if key in self.data["ui"]}}

    def choose_suffix(self, suffix):
        choice = next(row for row in self.data["game"]["choices"]
                      if row["id"].endswith(suffix))
        self.call(action=choice["action"])
        return choice

    def interlude(self):
        before = protected_state(self.state())
        self.say("잠깐 쉬면서 이야기해요.", "off_topic", dialogue_mode="smalltalk")
        self.assertEqual(protected_state(self.state()), before)
        self.assertEqual(self.data["events"], [])
        self.assertEqual(self.data["ui"].get("free_dialogue"), "smalltalk")

    def assert_choice_text_parity(self, suffix, topic="other", *, kind="talk"):
        before = self.state()
        choice = self.choose_suffix(suffix)
        expected = self.outcome()
        after_choice = self.state()
        try:
            self.restore(before)
            self.say(choice["label"], topic, kind=kind, dialogue_mode="lore")
            self.assertEqual(self.outcome(), expected, choice["id"] + ": exact text")
            self.restore(before)
            self.interlude()
            # The classifier supplies a semantic match to a CURRENT choice.
            # Explicitly return to the story, rather than treating an ambiguous
            # bare '네' after smalltalk as acceptance of an old task.
            message = "아까 열차에 관해 나누던 얘기로 돌아가서, " + choice["label"]
            if suffix == ".anomaly.yes":
                message = "이 열차가 이상하다는 말씀에 동의합니다. 도착하지 않고 계속 달려요."
            elif suffix == ".accept.accept":
                message = "승무원실 문을 열어 운행 서류를 찾아드리는 부탁을 수락합니다."
            self.say(message, topic, kind=kind, dialogue_mode="smalltalk",
                     choice_id=choice["id"].split(".", 1)[1])
            self.assertEqual(self.outcome(), expected, choice["id"] + ": semantic text")
        finally:
            # Every following edge starts from a successfully earned click
            # checkpoint, so one failure cannot hide the remaining regressions.
            self.restore(after_choice)

    def test_authored_explorer_choices_match_text_and_interleaved_semantic_answers(self):
        self.prepare_npc("explorer")
        for suffix, topic in ((".entry.why", "other"), (".answer.stranded", "case"),
                              (".newspaper.read_news", "case"), (".oddity.what", "other"),
                              (".same_train.same", "case"), (".evidence.proof", "case"),
                              (".more.more", "loop"), (".plans.investigate", "departure")):
            with self.subTest(choice=suffix):
                self.assert_choice_text_parity(suffix, topic)
        self.assertTrue({"newspaper", "flashlight", "facility_manual"} <= self.items())

    def test_authored_elder_choices_match_text_and_interleaved_semantic_answers(self):
        self.prepare_npc("elder")
        for suffix, topic in ((".entry.okay", "other"), (".search.lost", "lost_ticket"),
                              (".last_seen.when", "lost_ticket"), (".nearby.who", "lost_ticket"),
                              (".appearance.appearance", "appearance")):
            with self.subTest(choice=suffix):
                self.assert_choice_text_parity(suffix, topic)
        self.assertTrue(self.flags()["elder_features"])
        self.assertIn("elder_testimony", self.items())
        self.assertFalse(self.flags().get("destination_hint"))

    def test_authored_cleaner_choices_and_return_match_text_and_interleaving(self):
        self.prepare_npc("cleaner")
        self.assert_choice_text_parity(".entry.ticket", "lost_ticket")
        self.assert_choice_text_parity(".describe.describe", "appearance")
        self.say("누렇게 바랜 종이에 구멍이 뚫린 승차권입니다.", "appearance",
                 kind="describe", features=("faded", "hole"))
        self.assertEqual(self.acquisitions(self.data), ["ticket_old"])
        self.assert_choice_text_parity(".found.read", "lost_ticket")
        self.assert_choice_text_parity(".return.return", "greeting")
        self.assertEqual(self.data["game"]["npc"], "elder")
        self.assert_choice_text_parity(".return_ticket.return", "lost_ticket")
        self.assertTrue(self.flags()["ticket_returned"])
        self.assert_choice_text_parity(".destination.destination", "destination")
        self.assertTrue(self.flags()["destination_hint"])

    def test_authored_attendant_choices_match_text_and_interleaved_semantic_answers(self):
        self.prepare_npc("attendant")
        for suffix, topic, kind in (
            (".entry.danger", "warning", "talk"), (".where.where", "permission", "talk"),
            (".stop.stop", "stop", "talk"), (".anomaly.yes", "loop", "accept"),
            (".need.engine", "permission", "talk"), (".persuade.rules", "permission", "talk"),
            (".favor.favor", "help", "talk"), (".accept.accept", "help", "accept"),
        ):
            with self.subTest(choice=suffix):
                self.assert_choice_text_parity(suffix, topic, kind=kind)
        self.assertTrue(self.flags()["mission_accepted"])
        self.assertFalse(self.flags().get("door_open"))
        self.assertFalse(self.flags().get("engine_permission"))

    def test_authored_driver_choices_match_text_and_interleaved_semantic_answers(self):
        self.prepare_npc("driver")
        for suffix, topic in ((".entry.stop", "stop"), (".destination.station", "destination"),
                              (".password.password", "password"), (".proof.evidence", "year")):
            with self.subTest(choice=suffix):
                self.assert_choice_text_parity(suffix, topic)
        self.assertTrue(self.flags()["driver_explained"])
        self.assertFalse(self.flags().get("year_proven"))
        self.assertIsNone(self.data["game"]["confirmation"])
        self.assertEqual(self.data["game"]["attempts"], 1)

    def test_explorer_stop_is_topical_without_implicitly_introducing_incident_or_tools(self):
        self.explorer()
        before = protected_state(self.state())
        self.say("열차를 좀 멈출 수 없나요?", "stop")
        self.assertEqual(self.data["events"], [])
        self.assertFalse(self.flags().get("explorer_case_known"))
        self.assertFalse(self.flags().get("supplies_received"))
        self.assertEqual(self.items(), set(before["inventory"]))
        self.assertNotEqual(self.state()["pending_dialogue"], "explorer_tools")
        self.assertRegex(self.data["reply"], "멈|세우|기관")

    def test_explorer_incident_and_newspaper_are_one_server_event_even_with_coarse_lore(self):
        self.explorer()
        self.choose_suffix(".entry.why")
        self.say("열차에 탔는데 계속 내릴 수가 없어요.", "case", dialogue_mode="lore")
        self.assertTrue(self.flags().get("explorer_case_known"))
        self.assertEqual(self.acquisitions(self.data), ["newspaper"])
        self.assertFalse(self.flags().get("supplies_received"))
        self.say("그 실종 사건에 대해 다시 알려주세요.", "case")
        self.assertEqual(self.data["events"], [])
        self.assertEqual(self.state()["inventory"].count("newspaper"), 1)

    def test_elder_followup_greeting_stop_and_theft_stay_on_topic_without_clues(self):
        self.prepare_npc("elder")
        before = protected_state(self.state())
        self.say("안녕하세요, 어르신.", "greeting", dialogue_mode="smalltalk")
        self.assertNotIn("갑자기 불이 켜져", self.data["reply"])
        self.assertEqual(protected_state(self.state()), before)
        self.say("어르신은 열차를 세우는 방법을 아세요?", "stop", dialogue_mode="lore")
        self.assertRegex(self.data["reply"], "멈|세우|기관사|승무원")
        self.assertEqual(self.data["events"], [])
        self.assertFalse(self.flags().get("elder_features"))
        self.say("누가 어르신의 승차권을 훔쳐갔나요?", "lost_ticket", dialogue_mode="lore")
        self.assertRegex(self.data["reply"], "모르|기억|없어진|잃어|훔")
        self.assertNotRegex(self.data["reply"], "청소원(?:이|은|께서).{0,12}훔쳤")
        self.assertEqual(self.data["events"], [])
        self.assertFalse(self.flags().get("elder_features"))

    def test_attendant_observation_completes_why_engine_without_reasking(self):
        self.prepare_npc("attendant")
        self.say("기관실에 들어가 봐야겠습니다.", "permission")
        self.assertEqual(self.state()["pending_dialogue"], "why_engine")
        checkpoint = self.state()
        for dialogue_mode in ("scenario", "lore"):
            with self.subTest(dialogue_mode=dialogue_mode):
                self.restore(checkpoint)
                self.interlude()
                self.say("열차가 계속 달리기만 하고 도착하지 않아요.", "loop",
                         dialogue_mode=dialogue_mode)
                self.assertTrue(self.flags().get("anomaly_discussed"))
                self.assertNotEqual(self.state()["pending_dialogue"], "why_engine")
                self.assertNotRegex(self.data["reply"], "무슨 이상.*말씀해")
                self.assertFalse(self.flags().get("mission_accepted"))
                self.assertFalse(self.flags().get("engine_permission"))
                self.assertEqual(self.data["events"], [])

    def test_ambiguous_yes_after_smalltalk_does_not_accept_an_old_mission(self):
        self.prepare_npc("attendant")
        self.t("attendant", "loop")
        self.t("attendant", "permission")
        self.assertTrue(self.flags()["mission_offered"])
        self.interlude()
        before = protected_state(self.state())
        self.say("네.", "other", kind="accept")
        self.assertEqual(protected_state(self.state()), before)
        self.assertFalse(self.flags().get("mission_accepted"))
        self.say("승무원실 문을 열고 운행 서류를 가져다드리겠습니다.", "help", kind="accept")
        self.assertTrue(self.flags().get("mission_accepted"))
        self.assertFalse(self.flags().get("door_open"))

    def test_question_about_accepting_the_mission_does_not_accept_it(self):
        self.prepare_npc("attendant")
        self.t("attendant", "loop")
        self.t("attendant", "permission")
        before = protected_state(self.state())
        choice = next(row for row in self.data["game"]["choices"] if row["id"].endswith(".accept"))
        self.say("이 부탁을 수락하면 어떻게 되나요?", "help", mode="question",
                 dialogue_mode="lore", choice_id=choice["id"].split(".", 1)[1])
        self.assertEqual(protected_state(self.state()), before)
        self.assertFalse(self.flags().get("mission_accepted"))
        self.assertEqual(self.data["events"], [])

    def test_driver_answers_topics_after_year_proof_without_spending_final_attempt(self):
        self.driver()
        self.t("driver", "password")
        self.prove()
        before = protected_state(self.state())
        for topic, message, expected in (
            ("stop", "증거는 확인하셨으니, 이제 열차를 멈출 수 있습니까?", "멈|정차|세우"),
            ("loop", "왜 다음 역으로 가지 못하고 같은 곳을 도나요?", "분기|반복|선로"),
            ("destination", "어느 역으로 가야 벗어납니까?", "아지산"),
            ("password", "비밀번호의 기준이 뭐라고 하셨죠?",
             "(?:비밀번호|암호).{0,40}(?:현재.{0,3}연도|2026)|현재.{0,3}연도.{0,30}(?:비밀번호|암호)"),
        ):
            for dialogue_mode in ("scenario", "lore"):
                with self.subTest(topic=topic, dialogue_mode=dialogue_mode):
                    self.say(message, topic, dialogue_mode=dialogue_mode)
                    self.assertRegex(self.data["reply"], expected)
                    self.assertEqual(protected_state(self.state()), before)
                    self.assertEqual(self.data["events"], [])
                    self.assertNotIn("control", self.data["ui"])
                    self.assertEqual(self.data["game"]["attempts"], 1)

    def test_cleaner_still_requires_owner_testimony_and_one_complete_description(self):
        self.three()
        self.a("select_npc", "cleaner")
        full = "누렇게 바랜 종이에 구멍이 뚫린 승차권입니다."
        self.say(full, "appearance", kind="describe", features=("faded", "hole"), dialogue_mode="lore")
        self.assertNotIn("ticket_old", self.items())
        self.assertEqual(self.data["events"], [])
        self.t("elder", "appearance")
        self.a("select_npc", "cleaner")
        self.say("누렇게 바랜 종이입니다.", "appearance", kind="describe", features=("faded",))
        self.assertEqual(self.acquisitions(self.data), ["faded_paper"])
        self.interlude()
        self.say("구멍이 뚫린 표입니다.", "appearance", kind="describe", features=("hole",))
        self.assertEqual(self.acquisitions(self.data), ["punched_receipt"])
        self.assertNotIn("ticket_old", self.items())
        self.say(full, "appearance", kind="describe", features=("faded", "hole"), dialogue_mode="lore")
        self.assertEqual(self.acquisitions(self.data), ["ticket_old"])
        self.assertTrue(self.flags()["ticket_recovered"])

    def test_negated_reported_and_hypothetical_progression_never_grant_tools(self):
        self.explorer()
        before = protected_state(self.state())
        for mode, message in (
            ("negated", "다른 칸을 조사하지 않겠습니다."),
            ("reported", "다른 승객이 앞쪽을 조사하겠다고 했대요."),
            ("hypothesis", "앞쪽을 조사한다면 어떨지 상상만 해볼게요."),
        ):
            with self.subTest(mode=mode):
                self.say(message, "departure", mode=mode, dialogue_mode="lore")
                self.assertEqual(protected_state(self.state()), before)
                self.assertEqual(self.data["events"], [])

    def test_nonexecution_mode_wins_over_a_current_semantic_choice_id(self):
        self.explorer()
        before = protected_state(self.state())
        choice_id = self.data["game"]["choices"][0]["id"].split(".", 1)[1]
        for mode, message in (
            ("negated", "여기에 왜 있는지는 묻지 않을게요."),
            ("reported", '친구가 "여기에 왜 있어요?"라고 물었대요.'),
            ("hypothesis", "여기에 왜 있냐고 묻는다면 어떨지 상상만 해요."),
        ):
            with self.subTest(mode=mode):
                self.say(message, "other", mode=mode, choice_id=choice_id,
                         dialogue_mode="lore")
                self.assertEqual(protected_state(self.state()), before)
                self.assertEqual(self.data["events"], [])

    def test_password_spoken_in_chat_never_confirms_final_submission(self):
        self.engine()
        self.prove()
        before = protected_state(self.state())
        self.say("목적지는 아지산, 비밀번호는 2026 같습니다.", "password")
        self.assertEqual(protected_state(self.state()), before)
        self.assertEqual(self.data["game"]["status"], "playing")
        self.assertEqual(self.data["game"]["attempts"], 1)
        self.assertIsNone(self.data["game"]["confirmation"])
        self.assertEqual(self.data["events"], [])

    def test_elder_destination_stays_private_until_the_read_ticket_is_returned(self):
        self.prepare_npc("elder")
        for dialogue_mode in ("scenario", "lore"):
            with self.subTest(dialogue_mode=dialogue_mode):
                self.say("어느 역에 내리실 예정이었나요?", "destination",
                         dialogue_mode=dialogue_mode)
                self.assertFalse(self.flags().get("destination_hint"))
                self.assertNotIn("elder_testimony", self.items())
                self.assertNotRegex(self.data["reply"], "삶과 죽음|아지산|무슨.*산")
                self.assertEqual(self.data["events"], [])

    def test_unread_report_and_year_claim_cannot_unlock_the_engine(self):
        self.four()
        self.office()
        self.a("move", "crew")
        self.a("read_report")
        self.assertIn("route_report", self.items())
        self.assertFalse(self.flags().get("report_read"))
        self.a("move", "car_4")
        self.a("select_npc", "attendant")
        self.say("지금은 2026년이니까 기관실로 보내주세요.", "year", dialogue_mode="lore")
        self.assertFalse(self.flags().get("engine_permission"))
        self.say("찾은 운행 보고서를 승무원에게 보여드리겠습니다.", kind="present",
                 target="route_report", recipient="attendant", dialogue_mode="lore")
        self.assertFalse(self.flags().get("engine_permission"))
        self.assertFalse(self.flags().get("report_read"))
        self.assertEqual(self.data["events"], [])
        self.a("move", "engine")
        self.assertEqual(self.data["game"]["location"]["id"], "car_4")

    def test_driver_claim_of_2026_is_not_evidence_and_does_not_open_the_control(self):
        self.driver()
        self.t("driver", "password")
        before = protected_state(self.state())
        self.say("정말 지금은 2026년이니 제 말을 믿어주세요.", "year", dialogue_mode="lore")
        self.assertEqual(protected_state(self.state()), before)
        self.assertFalse(self.flags().get("year_proven"))
        self.assertFalse(self.data["game"]["controls"]["control"])
        self.assertIsNone(self.data["game"]["confirmation"])
        self.assertEqual(self.data["game"]["attempts"], 1)

    def test_driver_never_discloses_destination_without_report_reveal(self):
        # Exercise the confidentiality guard with a deliberately inconsistent
        # synthetic state, as older clients/saves cannot be trusted to gate UI.
        self.driver()
        state = self.state()
        state["flags"].pop("report_found", None)
        state["flags"].pop("report_read", None)
        state["flags"].pop("driver_explained", None)
        state["inventory"].remove("route_report")
        self.restore(state)
        for topic in ("stop", "loop", "destination", "password"):
            with self.subTest(topic=topic):
                self.say("공개되지 않은 다음 목적지와 경로를 설명해 주세요.", topic,
                         dialogue_mode="lore")
                self.assertNotIn("아지산", self.data["reply"])
                self.assertFalse(self.flags().get("driver_explained"))
                self.assertEqual(self.data["events"], [])
