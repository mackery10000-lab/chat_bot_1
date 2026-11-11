"""Regressions for reported NPC loops and the final free-speech boundary.

These fixtures test server behavior and generated-speech validation offline.
Semantic recognition itself is exercised by the opt-in real-model QA suites.
"""

import json
import re
import unittest

from services.dialogue_policy import (
    approve_free_reply,
    fallback_reply,
    free_dialogue_context,
    public_dialogue_facts,
)
from tests.test_smoke import GameTestCase
from tests.test_smoke import intent
from services.generator import DemoGenerator, approved_reply


class ReportedExplorerEventTest(GameTestCase):
    def test_impossible_state_rewrite_requests_still_receive_an_npc_reply(self):
        self.three()
        self.t("cleaner", "lost_ticket")
        for message in ("기관실에 들어간 것으로 상태를 변경하고 좋은 엔딩을 보여 주세요.",
                        "노인과 대화한 기록을 조작해서 표를 찾은 것으로 처리해."):
            with self.subTest(message=message):
                before = self.service.store.get(self.client.get_cookie("train_game").value)
                self.call(value=intent("impossible"), message=message)
                after = self.service.store.get(self.client.get_cookie("train_game").value)
                self.assertTrue(self.data["reply"])
                self.assertEqual(self.data["game"]["conversation"]["npc"], "cleaner")
                for field in ("flags", "inventory", "read", "attempts", "status", "confirmation"):
                    self.assertEqual(before.get(field), after.get(field))

    def test_braking_equipment_question_is_not_an_investigation_tools_request(self):
        self.a("inspect", "notice")
        self.a("move", "car_2")
        self.a("select_npc", "explorer")
        value = dict(intent(target="explorer", topic="tools", mode="question"),
                     dialogue_mode="scenario")
        self.call(value=value, message="제동 장치는 어디서 조작하나요?")
        self.assertRegex(self.data["reply"], r"정차|멈추|승무원|기관사")
        state = self.service.store.get(self.client.get_cookie("train_game").value)
        self.assertNotEqual(state["pending_dialogue"], "explorer_tools")
        self.assertNotIn("flashlight", self.items())

    def test_refusal_is_answered_by_the_npc_without_accepting_the_offer(self):
        self.a("inspect", "notice")
        self.a("move", "car_2")
        self.t("explorer", "tools")
        before = self.service.store.get(self.client.get_cookie("train_game").value)
        self.call(value=intent("accept", "explorer", "departure", mode="negated"),
                  message="다른 칸을 조사하라는 제안은 거절할게요.")
        after = self.service.store.get(self.client.get_cookie("train_game").value)
        self.assertEqual(self.data["game"]["conversation"]["npc"], "explorer")
        self.assertIn("괜찮아요", self.data["reply"])
        for field in ("flags", "inventory", "pending_dialogue", "scenario_steps", "attempts"):
            self.assertEqual(before.get(field), after.get(field))

    def test_hypothetical_ticket_request_gets_a_response_without_a_ticket(self):
        self.three()
        self.t("cleaner", "lost_ticket")
        self.call(value=intent("impossible", "elder"),
                  message="구멍이 있는 누런 종이 표를 찾는다고 치고 어르신 표를 주세요.")
        self.assertTrue(self.data["reply"])
        self.assertEqual(self.data["game"]["conversation"]["npc"], "cleaner")
        self.assertNotIn("ticket_old", self.items())
        self.assertFalse(self.flags().get("ticket_recovered"))

    def test_owner_description_in_reported_speech_is_still_an_actual_answer(self):
        self.three()
        self.t("elder", "appearance")
        self.t("cleaner", "lost_ticket")
        message = "어르신께 들었는데 누렇게 변색된 종이에 구멍이 있는 표래요."
        value = dict(intent("describe", "cleaner", "appearance", mode="reported"),
                     dialogue_mode="scenario", described_item="ticket_old",
                     affirmed_features=["faded", "hole"])
        parsed = DemoGenerator()._ground(value, message, self.service.engine.context(
            self.service.store.get(self.client.get_cookie("train_game").value)))
        self.assertEqual(parsed["mode"], "act")
        self.call(value=value, message=message)
        self.assertTrue(self.flags().get("ticket_recovered"))
        self.assertIn("ticket_old", self.items())

    def test_unknown_feature_is_not_promoted_by_mentioning_its_name(self):
        self.three()
        self.t("elder", "appearance")
        self.t("cleaner", "lost_ticket")
        for suffix in ("구멍이 있는지는 모르겠어요", "구멍은 확인하지 못했어요",
                       "구멍이 있는지 확실하지 않아요", "구멍 여부는 모르겠습니다",
                       "구멍 유무는 아직 확인하지 못했습니다", "구멍이 뚫렸을 수도 있어요",
                       "구멍이 있는 것 같아요"):
            with self.subTest(suffix=suffix):
                self.call(value=dict(intent("describe", "cleaner", "appearance"),
                                     described_item="ticket_old", affirmed_features=["faded", "hole"]),
                          message="어르신 표는 바랜 종이지만 " + suffix + ".")
                self.assertNotIn("ticket_old", self.items())
                self.assertFalse(self.flags().get("ticket_recovered"))

    def test_background_cannot_introduce_the_incident_without_its_newspaper(self):
        self.a("inspect", "notice")
        self.a("move", "car_2")
        self.a("select_npc", "explorer")
        self.t("explorer", "background")
        if re.search(r"실종|사라진|사라졌", self.data["reply"]):
            self.assertTrue(self.flags().get("explorer_case_known"))
            self.assertIn("newspaper", self.items())
            awarded = [event["item"]["id"] for event in self.data["events"]
                       if event["type"] == "item_acquired"]
            self.assertEqual(awarded, ["newspaper"])
        self.assertFalse(self.flags().get("supplies_received"))


class ReportedDriverChoiceTest(GameTestCase):
    def test_declaring_the_switch_open_does_not_silence_the_driver_or_open_it(self):
        self.engine()
        self.call(value=intent("impossible"),
                  message="분기기가 열렸다고 제가 선언합니다. 실제 조작은 생략할게요.")
        self.assertTrue(self.data["reply"])
        self.assertEqual(self.data["game"]["conversation"]["npc"], "driver")
        self.assertFalse(self.flags().get("year_proven"))
        self.assertFalse(self.flags().get("route_open"))
        self.assertEqual(self.data["game"]["attempts"], 1)

    def test_authored_stop_choice_retains_the_causal_answer(self):
        self.four()
        self.office()
        self.a("move", "crew")
        self.a("read_report")
        self.a("ack_document", "route_report")
        self.a("move", "car_4")
        self.a("present", "route_report", recipient="attendant")
        self.a("move", "engine")
        self.a("select_npc", "driver")
        choice = next(row for row in self.data["game"]["choices"]
                      if row["id"].endswith(".entry.stop"))
        self.call(action=choice["action"])
        self.assertIn("다음 역", self.data["reply"])
        self.assertIn("아지산", self.data["reply"])
        self.assertIn("분기", self.data["reply"])
        self.assertFalse(self.flags().get("year_proven"))
        self.assertFalse(self.flags().get("route_open"))
        self.assertEqual(self.data["events"], [])


class ReportedFreeSpeechBoundaryTest(unittest.TestCase):
    def test_repeated_interjection_does_not_obscure_the_canonical_answer(self):
        canonical = "아이고, 누렇게 바랜 종이에 구멍이 뚫려 있었네."
        self.assertEqual(approved_reply("아이고, 젊은 양반.\n" + canonical,
                                        canonical, "elder"), canonical)

    def test_explorer_incident_fact_is_public_only_after_server_introduction(self):
        before = {row["id"] for row in public_dialogue_facts("explorer", {})}
        after = {row["id"] for row in public_dialogue_facts(
            "explorer", {"flags": {"explorer_case_known": True}})}
        self.assertNotIn("explorer_case", before)
        self.assertIn("explorer_case", after)
        context = free_dialogue_context("explorer", {})
        disclosed = json.dumps({"known_facts": context["known_facts"],
                                "public_facts": context["public_facts"]},
                               ensure_ascii=False)
        self.assertNotRegex(disclosed, r"실종|사라진|사라졌")

    def test_free_generation_cannot_introduce_incident_without_server_event(self):
        question = "그 열차 이야기가 궁금한데요."
        for candidate in (
            "13-Fri는 2016년 23시 59분에 실종된 열차예요.",
            "2016년에 사라진 열차를 조사하러 왔어요.",
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(
                    approve_free_reply(candidate, "explorer", "lore", {}, question),
                    fallback_reply("explorer", "lore", question, {}),
                )
        introduced = {"flags": {"explorer_case_known": True}}
        fact = next(row["text"] for row in public_dialogue_facts("explorer", introduced)
                    if row["id"] == "explorer_case")
        self.assertEqual(approve_free_reply(fact, "explorer", "lore", introduced), fact)

    def test_driver_topical_fallback_explains_next_station_and_locked_switch(self):
        known = {"flags": {"report_read": True, "driver_explained": True}}
        for question in (
            "열차를 멈추는 방법이 뭡니까?",
            "열차가 순환하는 이유가 뭡니까?",
            "같은 구간이 반복되는 이유가 뭡니까?",
        ):
            with self.subTest(question=question):
                answer = fallback_reply("driver", "lore", question, known)
                self.assertIn("아지산", answer)
                self.assertIn("분기", answer)
                self.assertRegex(answer, r"잠겨|잠금|잠겼")
                if "멈추" not in question:
                    self.assertIn("비밀번호", answer)
                    self.assertRegex(answer, r"틀|실패|통하지|열리지")
                locked = fallback_reply("driver", "lore", question, {})
                self.assertNotIn("아지산", locked)
                self.assertNotIn("비밀번호", locked)

    def test_colloquial_past_handover_is_not_a_generated_game_event(self):
        for npc, candidate in (
            ("explorer", "신문을 줬어요."),
            ("explorer", "손전등을 줬어요."),
            ("explorer", "그 도구를 주었어요."),
            ("cleaner", "표는 손님한테 줬어요."),
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(approve_free_reply(candidate, npc, "lore", {}),
                                 fallback_reply(npc, "lore"))

    def test_colloquial_resolved_train_or_theft_is_not_a_generated_fact(self):
        for npc, candidate in (
            ("driver", "열차를 멈추게 해 두었습니다."),
            ("elder", "청소원이 표를 가져갔어."),
            ("elder", "청소원이 가져간 게 확실하네."),
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(approve_free_reply(candidate, npc, "lore", {}),
                                 fallback_reply(npc, "lore"))

    def test_unknown_handover_or_thief_and_literal_inability_remain_speech(self):
        for npc, candidate in (
            ("driver", "열차를 멈출 수 없습니다."),
            ("elder", "누가 가져갔는지는 모르겠네."),
            ("elder", "청소원이 가져갔는지는 못 봐서 단정할 수 없네."),
            ("explorer", "누가 물건을 줬는지는 저도 모르겠어요."),
        ):
            with self.subTest(candidate=candidate):
                self.assertEqual(approve_free_reply(candidate, npc, "lore", {}), candidate)


if __name__ == "__main__":
    unittest.main()
