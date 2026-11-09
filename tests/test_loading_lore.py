"""Cosmetic AI copy cannot change progress or delay game requests."""
from copy import deepcopy
import threading
import unittest
from unittest.mock import patch

import app as web
from services.generator import DemoGenerator
from services.loading_lore import FALLBACK, LoadingLoreService, clean_loading_text
from tests.test_smoke import GameTestCase

LINE = "무거운 커튼 사이로 밤의 어둠이 스며들고, 객차에는 바퀴가 선로를 지나는 소리가 남습니다."


class LoadingLoreUnitTest(unittest.TestCase):
    def test_generator_uses_existing_api_with_a_short_independent_timeout(self):
        model = DemoGenerator()
        with patch.object(model, '_complete', return_value=LINE) as complete:
            self.assertEqual(model.generate_loading_lore({'visible_room': '객차'}), LINE)
        self.assertEqual(complete.call_args.kwargs, {'timeout': 8.0, 'max_output_tokens': 600})
        self.assertIn('스포일러', complete.call_args.args[0])

    def test_private_state_is_not_sent_and_no_progress_is_mutated(self):
        state = {'location': 'car_3', 'flags': {'light_on': False, 'year_proven': True},
                 'username': '개인 이름', 'history': ['개인 대화'], 'attempts': 1,
                 'confirmation': {'token': 'secret-token'}, 'inventory': ['ticket_old']}
        before = deepcopy(state)
        class Model:
            def generate_loading_lore(self, context):
                self.context = context
                return LINE
        model = Model()
        self.assertEqual(LoadingLoreService().get('game', state, model), {'text': LINE, 'source': 'ai'})
        self.assertEqual(state, before)
        self.assertEqual(set(model.context), {'setting', 'visible_room', 'lighting', 'previous_line'})
        self.assertNotIn('secret-token', str(model.context))
        self.assertNotIn('개인', str(model.context))

    def test_bad_output_and_provider_failure_keep_safe_copy(self):
        for value in (None, '', '<script>alert(1)</script>', '비밀번호는 2026이고 목적지는 아지산역입니다.',
                      '이 열차의 퍼스트 클래스 승객은 특별한 신분을 가지고 있습니다.', '가' * 101):
            self.assertIsNone(clean_loading_text(value))
        class BrokenModel:
            def generate_loading_lore(self, context):
                raise RuntimeError('private provider credentials must never reach the browser')
        self.assertEqual(LoadingLoreService().get('g', {}, BrokenModel()), {'text': FALLBACK, 'source': 'fallback'})

    def test_repeated_requests_reuse_copy_and_refresh_after_cooldown(self):
        clock = [0.0]
        service = LoadingLoreService(clock=lambda: clock[0])
        class Model:
            calls = 0
            def generate_loading_lore(self, context):
                self.calls += 1
                return LINE
        model = Model()
        service.get('g', {}, model);service.get('g', {}, model)
        self.assertEqual(model.calls, 1)
        clock[0] = 16.0
        service.get('g', {}, model)
        self.assertEqual(model.calls, 2)

    def test_inflight_copy_request_does_not_block_another_request(self):
        started, release = threading.Event(), threading.Event()
        class SlowModel:
            def generate_loading_lore(self, context):
                started.set();release.wait(3)
                return LINE
        service = LoadingLoreService()
        worker = threading.Thread(target=lambda: service.get('g', {}, SlowModel()))
        worker.start()
        try:
            self.assertTrue(started.wait(1))
            self.assertEqual(service.get('g', {}, SlowModel())['source'], 'fallback')
        finally:
            release.set();worker.join(2)
        self.assertFalse(worker.is_alive())

    def test_cache_is_bounded(self):
        service = LoadingLoreService(capacity=3)
        class Model:
            def generate_loading_lore(self, context):return LINE
        for index in range(8):service.get(str(index), {}, Model())
        self.assertEqual(list(service.entries), ['5', '6', '7'])


class LoadingLoreRouteTest(GameTestCase):
    def test_loading_copy_uses_same_game_without_spending_a_turn(self):
        gid = self.client.get_cookie(web.COOKIE).value
        before = self.service.store.get(gid)
        with patch.object(web, 'loading_lore', LoadingLoreService()), patch.object(self.model, 'generate_loading_lore', return_value=LINE, create=True):
            response = self.client.post('/api/loading-text', json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'text': LINE, 'source': 'ai'})
        self.assertEqual(self.service.store.get(gid), before)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_missing_cookie_never_invokes_the_model(self):
        self.client.delete_cookie(web.COOKIE)
        with patch.object(self.model, 'generate_loading_lore', create=True) as generate:
            self.assertEqual(self.client.post('/api/loading-text', json={}).status_code, 404)
        generate.assert_not_called()

    def test_wrong_origin_never_invokes_the_model(self):
        with patch.object(self.model, 'generate_loading_lore', create=True) as generate:
            self.assertEqual(self.client.post('/api/loading-text', json={}, headers={'Origin': 'https://wrong.example'}).status_code, 403)
        generate.assert_not_called()

    def test_ai_failure_does_not_break_the_game(self):
        with patch.object(web, 'loading_lore', LoadingLoreService()):
            response = self.client.post('/api/loading-text', json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['source'], 'fallback')
        self.assertEqual(self.client.get('/api/game').json['game']['revision'], 0)
