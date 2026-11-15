"""Freeze canon, presentation and non-dialogue execution gates during routing work."""

import ast
import hashlib
import json
from pathlib import Path
import unittest

from services.dialogue_routing import ground_dialogue_route, resolve_dialogue_route
from tests.test_smoke import intent


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tests/fixtures/dialogue_preservation.json"


class DialoguePreservationTest(unittest.TestCase):
    def test_canon_ui_and_core_execution_gates_match_the_prechange_version(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for filename, digest in manifest["files"].items():
            with self.subTest(file=filename):
                content = (ROOT / filename).read_text(encoding="utf-8").encode("utf-8")
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)
        tree = ast.parse((ROOT / "services/chatbot_service.py").read_text(encoding="utf-8"))
        classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
        for key, digest in manifest["execution_contracts"].items():
            owner, _, name = key.partition(".")
            node = classes[owner]
            if name:
                node = next(method for method in node.body if isinstance(method, ast.FunctionDef) and method.name == name)
            with self.subTest(contract=key):
                self.assertEqual(hashlib.sha256(ast.dump(node, include_attributes=False).encode()).hexdigest(), digest)

    def test_revalidation_is_idempotent_and_has_no_state_or_context_authority(self):
        context = dict(active_npc="attendant", pending_dialogue="crew_help", last_dialogue_mode="scenario",
                       answer_expectation={"kind": "mission_offer", "allows_short_accept": True},
                       dialogue_choices=[{"id": "story.attendant.accept.accept", "label": "좋아요.",
                                          "semantic": {"type": "talk", "topic": "help", "accept": True}}])
        for message, mode in (("그 제안대로 맡겠습니다.", "act"),
                              ("제가 돕는다면 어떻게 되나요?", "hypothesis"),
                              ("그 부탁은 거절합니다.", "negated")):
            original = dict(intent("accept", "attendant", "help", mode=mode), quote=message,
                            dialogue_choice_id="story.attendant.accept.accept", dialogue_mode="lore")
            frozen_context = json.dumps(context, sort_keys=True)
            frozen_input = json.dumps(original, sort_keys=True)
            first = ground_dialogue_route(original, message, context)
            self.assertEqual(ground_dialogue_route(first, message, context), first)
            resolve_dialogue_route(first, message, context)
            self.assertEqual(json.dumps(context, sort_keys=True), frozen_context)
            self.assertEqual(json.dumps(original, sort_keys=True), frozen_input)
