"""Partial lost-property descriptions produce decoys without bypassing the story."""

from unittest.mock import patch

from tests.test_smoke import GameTestCase, intent


class CleanerItemsTest(GameTestCase):
    DECOYS = {"faded_paper", "punched_receipt"}

    def ready(self):
        self.three()
        self.t("elder", "appearance")
        self.t("cleaner", "lost_ticket")

    def describe(self, *features, message=None, **fields):
        value = intent("describe", "cleaner", "appearance", features=features, **fields)
        if message is None:
            return self.call(value=value)
        return self.call(value=value, message=message)

    def acquisitions(self):
        return {
            event["item"]["id"] for event in self.data["events"]
            if event.get("type") == "item_acquired"
        }

    def assert_ticket_unrecovered(self):
        self.assertNotIn("ticket_old", self.items())
        self.assertFalse(self.flags().get("ticket_recovered"))
        self.assertFalse(self.flags().get("ticket_returned"))
        self.assertFalse(self.flags().get("destination_hint"))

    def test_faded_description_awards_only_the_faded_paper_and_persists_it(self):
        self.ready()
        self.describe("faded", message="누렇게 바랜 종이입니다.")
        self.assertEqual(self.items() & self.DECOYS, {"faded_paper"})
        self.assertEqual(self.acquisitions(), {"faded_paper"})
        self.assert_ticket_unrecovered()
        saved = self.client.get("/api/game").json
        self.assertIn("faded_paper", {item["id"] for item in saved["game"]["inventory"]})

    def test_hole_description_awards_only_the_punched_receipt(self):
        self.ready()
        self.describe("hole", message="구멍이 뚫린 종이입니다.")
        self.assertEqual(self.items() & self.DECOYS, {"punched_receipt"})
        self.assertEqual(self.acquisitions(), {"punched_receipt"})
        self.assert_ticket_unrecovered()

    def test_partial_turns_do_not_combine_and_each_item_is_awarded_once(self):
        self.ready()
        for feature, item in (("faded", "faded_paper"), ("hole", "punched_receipt")):
            with self.subTest(feature=feature):
                self.describe(feature)
                self.assertEqual(self.acquisitions(), {item})
                self.assert_ticket_unrecovered()
                self.describe(feature)
                self.assertEqual(self.acquisitions(), set())
                self.assert_ticket_unrecovered()
        self.assertEqual(self.items() & self.DECOYS, self.DECOYS)
        self.describe("faded", "hole")
        self.assertEqual(self.acquisitions(), {"ticket_old"})
        self.assertTrue(self.flags()["ticket_recovered"])
        self.assertEqual(self.items() & self.DECOYS, self.DECOYS)

    def test_complete_description_does_not_award_partial_items(self):
        self.ready()
        self.describe("faded", "hole")
        self.assertEqual(self.acquisitions(), {"ticket_old"})
        self.assertFalse(self.items() & self.DECOYS)
        self.assertTrue(self.flags()["ticket_recovered"])

    def test_descriptions_after_recovery_never_award_new_decoys(self):
        self.ready()
        self.describe("faded", "hole")
        for feature in ("faded", "hole"):
            with self.subTest(feature=feature):
                self.describe(feature)
                self.assertEqual(self.acquisitions(), set())
                self.assertFalse(self.items() & self.DECOYS)
                self.assertTrue(self.flags()["ticket_recovered"])

    def test_elder_information_and_light_remain_required(self):
        # Merely naming a distant cleaner must not deliver an inventory item.
        self.describe("faded")
        self.assertFalse(self.items() & self.DECOYS)
        self.a("inspect", "notice")
        self.a("move", "car_2")
        self.t("explorer", "identity")
        self.t("explorer", "departure")
        self.a("move", "car_3")
        self.describe("hole")
        self.assertFalse(self.items() & self.DECOYS)
        self.a("use_item", "flashlight")
        for feature in ("faded", "hole"):
            self.describe(feature)
            self.assertFalse(self.items() & self.DECOYS)
            self.assertEqual(self.acquisitions(), set())
        self.t("elder", "appearance")
        self.describe("faded")
        self.assertIn("faded_paper", self.items())

    def test_negated_uncertain_and_other_objects_do_not_award_decoys(self):
        self.ready()
        cases = (
            ("바랜 종이도 아니고 구멍도 없습니다.", "act", "ticket_old", "same"),
            ("누렇게 바랜 종이를 찾는다고 말하지 않겠습니다.", "negated", "ticket_old", "same"),
            ("만약 누렇게 바랜 종이라면 어떨까요?", "hypothesis", "ticket_old", "same"),
            ("구멍이 있는 종이라고 누군가 말했대요.", "reported", "ticket_old", "same"),
            ("그 종이에 구멍이 있나요?", "question", "ticket_old", "same"),
            ("제 승차권은 누렇게 바랜 종이입니다.", "act", "ticket_current", "different"),
            ("이 휴지는 누렇게 바랜 종이입니다.", "act", "tissue", "different"),
            ("저 영수증에는 구멍이 있어요.", "act", "receipt", "different"),
            ("초대장은 누렇게 바랜 종이에 구멍이 뚫려 있어요.", "act", "ticket_old", "same"),
            ("받은 바랜 종이에 구멍이 뚫려 있어요.", "act", "ticket_old", "same"),
            ("휴지는 바랜 종이고 영수증에는 구멍이 있습니다.", "act", "unknown", "different"),
        )
        for message, mode, item, relation in cases:
            with self.subTest(message=message):
                self.describe("faded", "hole", message=message, mode=mode,
                              described_item=item, relation=relation)
                self.assertFalse(self.items() & self.DECOYS)
                self.assertEqual(self.acquisitions(), set())
                self.assert_ticket_unrecovered()

    def test_free_dialogue_with_feature_words_does_not_award_items(self):
        self.ready()
        before = self.items()
        parsed = dict(intent(target="cleaner", topic="background"), dialogue_mode="lore")
        with patch.object(self.model, "generate", return_value="오래 쓴 종이는 조심해서 다루지요. 손님도 손을 조심해 주세요."):
            self.call(value=parsed, message="청소하면서 바랜 종이나 구멍난 종이를 만지는 일은 힘들지 않나요?")
        self.assertEqual(self.items(), before)
        self.assertEqual(self.acquisitions(), set())
        self.assert_ticket_unrecovered()

    def test_decoys_cannot_be_returned_as_the_ticket_or_open_the_next_car(self):
        self.ready()
        self.describe("faded")
        self.describe("hole")
        for item in sorted(self.DECOYS):
            with self.subTest(item=item):
                self.a("read_item", item)
                self.a("present", item, recipient="elder")
                self.assert_ticket_unrecovered()
        self.a("move", "car_4")
        self.assertEqual(self.data["game"]["location"]["id"], "car_3")
        self.describe("faded", "hole")
        self.a("read_item", "ticket_old")
        self.a("present", "ticket_old", recipient="elder")
        self.t("elder", "destination")
        self.a("move", "car_4")
        self.assertEqual(self.data["game"]["location"]["id"], "car_4")
        self.assertTrue(self.flags()["ticket_returned"])
        self.assertTrue(self.flags()["destination_hint"])

    def test_decoys_keep_the_wrong_evidence_confirmation_and_bad_ending(self):
        for item in sorted(self.DECOYS):
            with self.subTest(item=item):
                self.new()
                self.ready()
                self.describe("faded" if item == "faded_paper" else "hole")
                self.ticket()
                self.a("move", "car_4")
                self.office()
                self.a("move", "crew")
                self.a("read_report")
                self.a("ack_document", "route_report")
                self.a("move", "car_4")
                self.a("present", "route_report", recipient="attendant")
                self.a("move", "engine")
                self.t("driver", "destination")
                self.claim_year()
                self.a("prepare_evidence", item)
                self.assertEqual(self.data["game"]["status"], "playing")
                self.assertEqual(self.data["game"]["confirmation"]["item"], item)
                self.assertFalse(self.flags().get("year_proven"))
                self.a("confirm", token=self.data["game"]["confirmation"]["token"])
                self.assertEqual(self.data["game"]["status"], "bad")
                self.assertEqual(self.data["game"]["reason"], "wrong_evidence")
                self.assertFalse(self.flags().get("year_proven"))
