"""Isolated real Flask game fixtures. Never calls a remote model or the player save."""
import json
import os
from pathlib import Path
import sys
import tempfile
from flask import redirect, request
from werkzeug.serving import make_server

BASE = Path(os.environ.get('GAMEPLAY_QA_GAME_ROOT') or Path(__file__).resolve().parents[1]).resolve()
sys.path.insert(0,str(BASE))
import app as web
from services.chatbot_service import ChatbotService

class LocalModel:
    def generate_loading_lore(self, context):
        return '무거운 커튼 사이로 밤의 어둠이 스며들고, 객차에는 바퀴가 선로를 지나는 소리가 남습니다.'

    def interpret(self,message,context):
        descriptions={
            '누렇게 바랜 종이입니다.':['faded'],
            '구멍이 뚫린 종이입니다.':['hole'],
            '누렇게 바랜 종이에 구멍이 뚫려 있는 승차권입니다.':['faded','hole'],
        }
        if message in descriptions:
            return dict(intent='describe',target='cleaner',recipient='cleaner',topic='appearance',
                        mode='act',quote=message,dialogue_mode='scenario',
                        affirmed_features=descriptions[message],denied_features=[],
                        described_item='ticket_old',referent_relation='same',dialogue_choice_id='')
        if message=='입력창 확인':
            return dict(intent='talk',target=context['active_npc'],topic='off_topic',mode='act',quote=message)
        raise AssertionError('UI checks must not call a live model')
    def generate(self,question,username,character,knowledge):
        return character['_runtime']['canonical']

tmp=tempfile.TemporaryDirectory(prefix='gameplay-ui-qa-')
web.chatbot=ChatbotService(generator=LocalModel(),db_path=Path(tmp.name)/'qa.sqlite3')

@web.app.get('/qa/new')
def seed():
    phase=request.args.get('phase','base')
    gid,state=web.chatbot.store.create('이미지 인벤토리 검수')
    # These fixtures represent progressed saves; new games exercise the real
    # title/name routes in the browser checker, including the opening video.
    state['revision']=1
    state['inventory']=list(web.chatbot.config['items'])
    state['location']='car_3'
    state['flags'].update(light_on=True,elder_features=True,explorer_met=True,
                          supplies_received=True,mission_accepted=True,door_open=True)
    if phase in ('proof','driver','car4','returned','full','control'):
        state['flags'].update(report_found=True,report_read=True,ticket_recovered=True,
                              old_ticket_read=True,ticket_returned=True)
        state['read'].append('route_report')
    if phase in ('proof','driver','control'):
        state['location']='engine'
        state['flags'].update(engine_permission=True,driver_explained=phase in ('proof','control'),year_claimed=phase in ('proof','control'),year_proven=phase=='control')
    elif phase=='crew': state['location']='crew'
    elif phase in ('car4','door','door_read'):
        state['location']='car_4'
        if phase in ('door','door_read'): state['flags']['door_open']=False
        if phase=='door_read': state['flags']['manual_read']=True
    elif phase=='transcript':
        state.update(location='car_2',npc='explorer')
        state['history']=[entry for index in range(150) for entry in (
            dict(role='user',speaker=state['username'],npc='explorer',text=f'이전 대화 {index+1}'),
            dict(role='npc',speaker='탐험가',npc='explorer',text=f'탐험가의 대답 {index+1}'),
        )]
    elif phase=='dark': state['flags']['light_on']=False
    elif phase=='full': state['flags']['destination_hint']=True
    elif phase=='early': state['flags']['elder_features']=False
    elif phase=='hint_only':state['flags'].update(elder_features=False,destination_hint=True)
    elif phase=='record_two_actions':
        state['location']='car_4'
        state['flags'].update(report_found=True,report_read=False)
    elif phase=='acquire':
        state.update(location='car_2',npc='explorer',scenario_steps={'explorer':'answer'})
        state['inventory']=['ticket_current']
        state['flags']={'notice_read':True,'explorer_met':True}
    elif phase=='feedback':
        state.update(location='car_1',npc='',inventory=['ticket_current'],read=[],flags={},visited=['car_1'])
    elif phase=='cleaner_items':
        state.update(npc='cleaner',pending_dialogue='describe_ticket',
                     inventory=['ticket_current','newspaper','flashlight','facility_manual','elder_testimony'])
    elif phase in ('ending_good','ending_bad'):
        state.update(status=phase[7:],location='engine',npc='',attempts=0)
    elif phase.startswith('scene_') and phase[6:] in ('car_1','car_2','car_3','car_4','crew','engine'):
        state['location']=phase[6:]
        state['flags'].update(notice_read=True, report_found=True, report_read=True,
                              ticket_recovered=True, ticket_returned=True, destination_hint=True,
                              engine_permission=True, driver_explained=True, year_proven=True)
        if state['location']=='car_4':state['flags']['door_open']=False
    elif phase.startswith('nav_'):
        state['location']='car_1'
        state['flags'].update(notice_read=True,ticket_recovered=True,
                              ticket_returned=True,destination_hint=True,
                              cover_open=True,lever_down=True)
        if phase=='nav_blocked':state['flags']['notice_read']=False
        elif phase=='nav_engine':
            state['location']='car_4'
            state['flags'].update(report_read=True,engine_permission=True)
        elif phase=='nav_crew_locked':
            state['location']='crew'
            state['flags'].update(report_read=True,engine_permission=False)
        elif phase=='nav_conversation':
            state.update(location='car_2',npc='explorer')
    with web.chatbot.store.connect() as db:
        db.execute('UPDATE games SET state=?,revision=? WHERE id=?',
                   (json.dumps(state,ensure_ascii=False),state['revision'],gid))
    response=redirect('/chat')
    response.set_cookie(web.COOKIE,gid,httponly=True,samesite='Lax')
    return response

server=make_server('127.0.0.1',0,web.app,threaded=True)
if __name__ == '__main__':
    print('QA_PORT='+str(server.server_port),flush=True)
    try:server.serve_forever()
    finally:server.server_close();tmp.cleanup()
