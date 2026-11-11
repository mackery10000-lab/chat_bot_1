"""Scenario gates and transcript retention behind the conversation UI."""
import json
from tests.test_smoke import GameTestCase
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
