"""Restart detaches the session before returning to ticket issuance."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as web
from services.chatbot_service import ChatbotService
from tests.test_smoke import ScriptedModel


class EntryResetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = ChatbotService(
            generator=ScriptedModel(), db_path=Path(self.tmp.name) / "state.sqlite3"
        )
        self.swap = patch.object(web, "chatbot", self.service)
        self.swap.start()
        self.client = web.app.test_client()

    def tearDown(self):
        self.swap.stop()
        self.tmp.cleanup()

    def test_restart_returns_to_landing_before_creating_a_game(self):
        before = self.client.post("/api/game/new", json={"username": "이전승객"})
        self.assertEqual(before.status_code, 200)
        old_cookie = self.client.get_cookie(web.COOKIE).value
        inspected = self.client.post("/api/chat", json={
            "action": {"type": "inspect", "target": "notice"},
            "request_id": "notice_before_reset", "revision": 0,
        })
        self.assertEqual(inspected.status_code, 200)
        self.assertTrue(self.service.store.get(old_cookie)["flags"]["notice_read"])

        result = self.client.post("/api/game/reset", json={})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json, {"redirect": "/"})
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        self.assertIsNone(self.client.get_cookie(web.COOKIE))
        self.assertEqual(self.client.get("/api/game").status_code, 404)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/detail").status_code, 200)
        self.assertIsNone(self.client.get_cookie(web.COOKIE))

        after = self.client.post("/api/game/new", json={"username": "새승객"})
        self.assertNotEqual(old_cookie, self.client.get_cookie(web.COOKIE).value)
        self.assertEqual(after.json["game"]["username"], "새승객")
        self.assertEqual(after.json["game"]["revision"], 0)
        self.assertFalse(self.service.store.get(
            self.client.get_cookie(web.COOKIE).value
        )["flags"].get("notice_read"))

    def test_reset_is_idempotent_and_rejects_a_foreign_origin(self):
        for _ in range(2):
            self.assertEqual(self.client.post("/api/game/reset", json={}).status_code, 200)
        self.client.post("/api/game/new", json={"username": "승객"})
        cookie = self.client.get_cookie(web.COOKIE).value
        result = self.client.post("/api/game/reset", json={}, headers={
            "Origin": "https://example.invalid",
        })
        self.assertEqual(result.status_code, 403)
        self.assertEqual(self.client.get_cookie(web.COOKIE).value, cookie)
        self.assertEqual(self.client.get("/api/game").status_code, 200)


if __name__ == "__main__":
    unittest.main()
