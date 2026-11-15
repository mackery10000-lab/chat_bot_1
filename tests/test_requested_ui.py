"""Scenario gates and transcript retention behind the conversation UI."""
import json
from copy import deepcopy
from tests.test_smoke import GameTestCase, intent
import app as web


class RequestedUITest(GameTestCase):
    def save(self, state):
        gid = self.client.get_cookie(web.COOKIE).value
        with self.service.store.connect() as db:
            db.execute('UPDATE games SET state=? WHERE id=?',
                       (json.dumps(state, ensure_ascii=False), gid))

    def saved(self):
        return self.service.store.get(self.client.get_cookie(web.COOKIE).value)

    def test_manual_reading_exposes_door_interactions(self):
        state = self.saved()
        state.update(location='car_4', npc='')
        state['inventory'].append('facility_manual')
        state['flags']['mission_accepted'] = True
        self.save(state)
        snapshot = self.client.get('/api/game').json
        self.assertFalse(snapshot['game']['controls']['door'])
        self.assertEqual(snapshot['scene']['hotspots'], [])
        self.a('operate', 'cover')
        self.assertFalse(self.flags().get('cover_open'))
        self.a('read_item', 'facility_manual')
        self.assertTrue(self.data['game']['controls']['door'])
        self.assertEqual({p['id'] for p in self.data['scene']['hotspots']},
                         {'crew_door', 'inspection_cover', 'door_handle'})
        self.a('operate', 'cover')
        self.assertTrue(self.flags()['cover_open'])

    def test_testimony_hint_only_while_cleaner_needs_description(self):
        state = self.saved()
        state.update(location='car_3', npc='cleaner', pending_dialogue='describe_ticket')
        state['inventory'].append('elder_testimony')
        state['flags'].update(light_on=True, elder_features=True)
        for npc, pending, recovered, expected in (
            ('cleaner', 'describe_ticket', False, True),
            ('cleaner', 'confirm_description', False, True),
            ('cleaner', '', False, False),
            ('elder', 'describe_ticket', False, False),
            ('', 'describe_ticket', False, False),
            ('cleaner', 'describe_ticket', True, False),
        ):
            with self.subTest(npc=npc, pending=pending, recovered=recovered):
                state.update(npc=npc, pending_dialogue=pending)
                state['flags']['ticket_recovered'] = recovered
                self.assertEqual(self.service.snapshot_from(state)['game']['testimony_hint'], expected)

    def test_cleaner_description_hint_survives_elder_revisit_and_reload(self):
        state = self.saved()
        state.update(location='car_3', npc='')
        state['inventory'].append('elder_testimony')
        state['flags'].update(light_on=True, elder_features=True)
        self.save(state)

        def choose(label):
            choice = next(row for row in self.data['game']['choices'] if row['label'] == label)
            self.call(action=choice['action'])

        self.a('select_npc', 'cleaner')
        self.assertFalse(self.data['game']['testimony_hint'])
        choose('혹시 승차권을 보셨나요?')
        self.assertTrue(self.data['game']['testimony_hint'])
        choose('노인에게 다시 물어본다.')
        self.assertFalse(self.data['game']['testimony_hint'])
        choose('청소 직원이랑 대화한다.')
        # The authored description stage survives changing NPCs; the short
        # answer obligation deliberately does not. A visual hint must not
        # recreate that obligation or supply either ticket feature.
        self.assertEqual(self.saved()['pending_dialogue'], '')
        self.assertTrue(self.data['game']['testimony_hint'])
        self.assertTrue(self.client.get('/api/game').json['game']['testimony_hint'])
        choose('분실물의 모양을 직접 설명한다.')
        self.assertTrue(self.data['ui']['compose'])
        self.assertTrue(self.data['game']['testimony_hint'])
        self.a('read_item', 'elder_testimony')
        self.assertTrue(self.data['game']['testimony_hint'])
        self.a('end_talk')
        self.assertFalse(self.data['game']['testimony_hint'])
        self.a('select_npc', 'cleaner')
        self.assertTrue(self.data['game']['testimony_hint'])
        self.assertNotIn('ticket_old', self.items())
        self.call(value=intent('describe', 'cleaner', 'appearance', features=['faded', 'hole']))
        self.assertIn('ticket_old', self.items())
        self.assertFalse(self.data['game']['testimony_hint'])

    def test_cleaner_description_hint_requires_earned_testimony_and_active_scene(self):
        original = self.saved()
        original.update(location='car_3', npc='cleaner', pending_dialogue='',
                        scenario_steps={'cleaner': 'describe'})
        original['inventory'].append('elder_testimony')
        original['flags'].update(light_on=True, elder_features=True)
        variants = (
            ({}, {}, True),
            ({'pending_dialogue': 'describe_ticket'}, {'elder_features': False}, False),
            ({}, {'elder_features': None}, False),
            ({'inventory': ['ticket_current']}, {}, False),
            ({}, {'light_on': False}, False),
            ({'npc': 'elder'}, {}, False),
            ({'npc': ''}, {}, False),
            ({'location': 'car_2'}, {}, False),
            ({'status': 'bad'}, {}, False),
            ({}, {'ticket_recovered': True}, False),
        )
        for fields, flags, expected in variants:
            with self.subTest(fields=fields, flags=flags):
                state = deepcopy(original)
                state.update(fields)
                state['flags'].update(flags)
                before = deepcopy(state)
                self.assertIs(self.service.snapshot_from(state)['game']['testimony_hint'], expected)
                self.assertEqual(state, before)

    def test_dialogues_older_than_240_entries_survive_turn_and_reload(self):
        state = self.saved()
        state['history'] = [dict(role='npc', speaker='탐험가', npc='explorer',
                                 text=f'기존 대화 {index}') for index in range(300)]
        self.save(state)
        self.a('read_item', 'ticket_current')
        history = self.data['game']['history']
        self.assertEqual(len(history), 302)  # greeting + 300 saved + reading
        self.assertEqual(history[1]['text'], '기존 대화 0')
        self.assertEqual(self.client.get('/api/game').json['game']['history'], history)
        self.assertEqual(len(self.saved()['history']), 240)
        self.assertEqual(len(self.saved()['history_archive']), 61)
        self.a('read_item', 'ticket_current')
        self.assertEqual(len(self.data['game']['history']), 303)
        self.assertEqual(self.data['game']['history'][1]['text'], '기존 대화 0')
