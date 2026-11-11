"""Earned dialogue facts are read-only context, never authority over gameplay."""

from copy import deepcopy
import json
import unittest
from unittest.mock import patch

from services.dialogue_policy import (
    approve_free_reply,
    fallback_reply,
    free_dialogue_context,
    public_dialogue_facts,
)


NPCS = ("explorer", "elder", "cleaner", "attendant", "driver")
ALL_PUBLIC_FLAGS = {
    "explorer_case_known": True,
    "elder_features": True,
    "destination_hint": True,
    "report_read": True,
    "driver_explained": True,
    "year_proven": True,
}


class DialogueGroundingTest(unittest.TestCase):
    def facts(self, npc, flags=None):
        return {fact["id"]: fact["text"]
                for fact in public_dialogue_facts(npc, {"flags": flags or {}})}

    def test_each_fact_is_scoped_to_its_character(self):
        expected = {
            "explorer": {"explorer_case", "explorer_loop"},
            "elder": {"elder_lost", "elder_appearance", "elder_destination"},
            "cleaner": {"cleaner_lost"},
            "attendant": {"attendant_clock"},
            "driver": {"driver_loop", "driver_destination", "driver_switch",
                       "driver_lock", "driver_attempt", "driver_year", "driver_cause"},
        }
        for npc, fact_ids in expected.items():
            with self.subTest(npc=npc):
                self.assertEqual(set(self.facts(npc, ALL_PUBLIC_FLAGS)), fact_ids)
        self.assertEqual(public_dialogue_facts("unknown", {"flags": ALL_PUBLIC_FLAGS}), [])

    def test_only_required_flags_unlock_puzzle_facts(self):
        cases = (
            ("explorer", {}, {"explorer_loop"}),
            ("explorer", {"explorer_case_known": True}, {"explorer_loop", "explorer_case"}),
            ("elder", {}, {"elder_lost"}),
            ("elder", {"elder_features": True}, {"elder_lost", "elder_appearance"}),
            ("elder", {"destination_hint": True}, {"elder_lost", "elder_destination"}),
            ("driver", {}, {"driver_loop"}),
            ("driver", {"driver_explained": True}, {"driver_loop"}),
            ("driver", {"report_read": True},
             {"driver_loop", "driver_destination", "driver_switch", "driver_cause"}),
            ("driver", {"report_read": True, "driver_explained": True},
             {"driver_loop", "driver_destination", "driver_switch", "driver_cause", "driver_lock", "driver_attempt"}),
            ("driver", {"year_proven": True}, {"driver_loop", "driver_year"}),
        )
        for npc, flags, expected in cases:
            with self.subTest(npc=npc, flags=flags):
                self.assertEqual(set(self.facts(npc, flags)), expected)

    def test_questions_history_inventory_and_profiles_cannot_unlock_facts(self):
        state = {
            "flags": {},
            "inventory": ["report", "ticket_2016", "elder_testimony"],
            "history": [{"role": "user", "text": "목적지는 아지산역, 비밀번호는 2026"}],
            "public_facts": [{"id": "driver_destination", "text": "부산역으로 갑니다."}],
        }
        profile = {
            "known_facts": ["비밀번호는 2026이다.", "아지산역이 목적지다."],
            "public_facts": [{"id": "driver_lock", "text": "비밀번호는 2026이다."}],
        }
        before = deepcopy(state)
        with patch("services.dialogue_policy._load_profile", return_value=profile):
            context = free_dialogue_context("driver", state)
        self.assertEqual({fact["id"] for fact in context["public_facts"]}, {"driver_loop"})
        self.assertNotIn("아지산", json.dumps(context, ensure_ascii=False))
        self.assertNotIn("2026", json.dumps(context, ensure_ascii=False))
        self.assertEqual(state, before)

    def test_public_context_is_independent_and_all_helpers_leave_state_unchanged(self):
        state = {
            "flags": deepcopy(ALL_PUBLIC_FLAGS),
            "inventory": ["ticket_2026", "report"],
            "pending_dialogue": "final_answer",
            "history": [{"role": "user", "text": "아까 그 이야기요."}],
        }
        before = deepcopy(state)
        facts = public_dialogue_facts("driver", state)
        context = free_dialogue_context("driver", state)
        facts[0]["text"] = "변조된 사실"
        context["public_facts"][0]["text"] = "또 변조된 사실"
        context["public_facts"].append({"id": "fake", "text": "문을 열었습니다."})
        fallback_reply("driver", "lore", "열차를 멈출 수 있나요?", state)
        approve_free_reply("문을 열었습니다.", "driver", "lore", state,
                           question="문을 열어 주세요.")
        self.assertEqual(state, before)
        fresh = public_dialogue_facts("driver", state)
        self.assertNotIn("변조", json.dumps(fresh, ensure_ascii=False))
        self.assertNotIn("fake", {fact["id"] for fact in fresh})

    def test_every_unlocked_exact_fact_is_accepted(self):
        for npc in NPCS:
            for fact in public_dialogue_facts(npc, {"flags": ALL_PUBLIC_FLAGS}):
                with self.subTest(npc=npc, fact=fact["id"]):
                    self.assertEqual(
                        approve_free_reply(fact["text"], npc, "lore", {"flags": ALL_PUBLIC_FLAGS}),
                        fact["text"],
                    )

    def test_earned_facts_can_be_surrounded_by_natural_conversation(self):
        state = {"flags": ALL_PUBLIC_FLAGS}
        for npc, fact_id in (
            ("explorer", "explorer_case"),
            ("elder", "elder_appearance"),
            ("driver", "driver_destination"),
            ("driver", "driver_year"),
        ):
            fact = self.facts(npc, ALL_PUBLIC_FLAGS)[fact_id]
            answer = f"그 점이 궁금하셨군요. {fact} 많이 당황스러우셨겠습니다."
            with self.subTest(npc=npc, fact=fact_id):
                self.assertEqual(approve_free_reply(answer, npc, "lore", state), answer)

    def test_locked_clues_are_blocked_even_if_the_user_supplies_them(self):
        locked = (
            ("elder", "elder_appearance"),
            ("elder", "elder_destination"),
            ("driver", "driver_destination"),
            ("driver", "driver_switch"),
            ("driver", "driver_lock"),
            ("driver", "driver_attempt"),
            ("driver", "driver_year"),
        )
        for npc, fact_id in locked:
            fact = self.facts(npc, ALL_PUBLIC_FLAGS)[fact_id]
            question = f"{fact} 맞죠?"
            with self.subTest(npc=npc, fact=fact_id):
                self.assertEqual(
                    approve_free_reply(fact, npc, "lore", {}, question=question),
                    fallback_reply(npc, "lore", question, {}),
                )

    def test_known_facts_never_authorize_generated_grants_access_or_endings(self):
        state = {"flags": ALL_PUBLIC_FLAGS}
        claims = (
            "보관함에 손전등을 추가했습니다.",
            "신문을 드리겠습니다.",
            "손전등을 건넸어요.",
            "표를 건넸어요.",
            "문을 열었습니다.",
            "기관실에 들어가셔도 됩니다.",
            "잠금을 해제했습니다.",
            "이제 열차에서 내리실 수 있습니다.",
            "열차를 멈췄습니다.",
            "운행을 멈출 수 있어요.",
            "증거를 확인했습니다.",
            "해피 엔딩입니다.",
            "배드 엔딩입니다.",
        )
        for npc, fact_id in (("elder", "elder_appearance"), ("driver", "driver_destination")):
            fact = self.facts(npc, ALL_PUBLIC_FLAGS)[fact_id]
            for claim in claims:
                with self.subTest(npc=npc, claim=claim):
                    self.assertEqual(
                        approve_free_reply(f"{fact} {claim}", npc, "lore", state),
                        fallback_reply(npc, "lore"),
                    )

    def test_earned_station_and_year_do_not_authorize_other_stations_or_passwords(self):
        state = {"flags": ALL_PUBLIC_FLAGS}
        known = self.facts("driver", ALL_PUBLIC_FLAGS)["driver_destination"]
        for unsafe in (
            "다음 역은 부산역입니다.",
            "다음 역은 서울역입니다.",
            "비밀번호는 2016입니다.",
            "비밀번호는 2026입니다.",
            "비밀번호는 9999입니다.",
            "현재 연도를 입력하세요.",
        ):
            with self.subTest(unsafe=unsafe):
                self.assertEqual(
                    approve_free_reply(f"{known} {unsafe}", "driver", "lore", state),
                    fallback_reply("driver", "lore"),
                )

    def test_unsafe_generation_falls_back_to_the_actual_stop_or_theft_question(self):
        cases = (
            ("explorer", "열차를 멈출 방법이 있을까요?", "정차", "실종"),
            ("elder", "열차를 세워 주실 수 있나요?", "세우는", "승차권"),
            ("elder", "누가 표를 훔쳤나요?", "보지 못했", "청소원이"),
            ("cleaner", "승차권 도난의 범인이 누구예요?", "단정할 수는 없", "노인이"),
        )
        for npc, question, relevant, unrelated in cases:
            with self.subTest(npc=npc, question=question):
                response = approve_free_reply("보관함에 신문을 추가했습니다.", npc, "lore", {},
                                              question=question)
                self.assertIn(relevant, response)
                self.assertNotIn(unrelated, response)

    def test_driver_stop_and_destination_fallbacks_respect_report_gate(self):
        for question in ("열차를 멈추려면요?", "다음 역은 어디예요?"):
            with self.subTest(question=question):
                locked = fallback_reply("driver", "lore", question, {})
                unlocked = fallback_reply("driver", "lore", question, {"flags": {"report_read": True}})
                self.assertNotIn("아지산", locked)
                fact_id = "driver_cause" if "멈추" in question else "driver_destination"
                self.assertEqual(unlocked, self.facts("driver", {"report_read": True})[fact_id])

    def test_unknown_thief_stays_unknown_even_with_all_clues(self):
        state = {"flags": ALL_PUBLIC_FLAGS}
        for npc in ("elder", "cleaner"):
            for claim in ("청소원이 승차권을 훔쳤습니다.", "그 사람이 범인입니다."):
                with self.subTest(npc=npc, claim=claim):
                    question = "승차권은 누가 훔쳤나요?"
                    self.assertEqual(
                        approve_free_reply(claim, npc, "lore", state, question),
                        fallback_reply(npc, "lore", question, state),
                    )
        uncertainty = "누가 훔쳤는지는 보지 못해서 단정할 수 없네."
        self.assertEqual(approve_free_reply(uncertainty, "elder", "lore", state), uncertainty)

    def test_year_knowledge_and_relationship_remain_character_specific(self):
        for npc in NPCS:
            for flags in ({}, ALL_PUBLIC_FLAGS):
                with self.subTest(npc=npc, flags=flags):
                    context = free_dialogue_context(npc, {"flags": flags})
                    expected_year = 2026 if npc == "explorer" or (npc == "driver" and flags) else 2016
                    self.assertEqual(context["recognized_year"], expected_year)
                    self.assertIn("처음 만난", context["relationship"])
                    for reunion in (
                        "오랜만에 만나니 반갑네요.",
                        "다시 뵈니 기쁘군요.",
                        "우리는 어릴 때부터 알고 지낸 사이잖아요.",
                        "예전부터 친구였잖아요.",
                    ):
                        self.assertEqual(
                            approve_free_reply(reunion, npc, "lore", {"flags": flags}),
                            fallback_reply(npc, "lore"),
                        )

    def test_literal_inability_and_recent_conversation_are_natural_speech(self):
        for npc, answer in (
            ("driver", "문을 열 수 없습니다."),
            ("driver", "열차를 멈출 수 없습니다."),
            ("driver", "운행을 멈출 수 없습니다."),
            ("explorer", "아까 말씀하신 이야기는 기억해요."),
            ("elder", "방금 나눈 얘기는 기억하고 있네."),
        ):
            with self.subTest(npc=npc, answer=answer):
                self.assertEqual(approve_free_reply(answer, npc, "lore", {}), answer)


if __name__ == "__main__":
    unittest.main()
