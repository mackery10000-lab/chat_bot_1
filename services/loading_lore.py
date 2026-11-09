"""Read-only loading atmosphere. Never enters the game engine or save transaction."""

from collections import OrderedDict
import re
from threading import Lock
import time


FALLBACK = "낡은 목재 객차 안으로 바퀴가 선로를 지나는 낮은 진동이 전해집니다."
PUBLIC_SETTING = (
    "짙은 밤을 달리는 오래된 열차",
    "목재 벽과 낡은 좌석, 무거운 커튼",
    "차창 너머의 어둠과 선로를 지나는 바퀴 소리",
)
ROOMS = {"car_1": "객차", "car_2": "객차", "car_3": "객차",
         "car_4": "출입문 앞", "crew": "승무원실", "engine": "기관실"}


def clean_loading_text(value):
    if not isinstance(value, str):
        return None
    text = " ".join(value.strip().split())
    # Atmosphere must not turn into puzzle advice, invented world rules or markup.
    if not 15 <= len(text) <= 100 or re.search(
        r"[0-9A-Za-z<>`#*]|아지산|비밀번호|승차권|바랜\s*종이|구멍|정답|엔딩|"
        r"퍼스트\s*클래스|일등석|귀족|천국|지옥|죽은|망자|유령|탈출|현재\s*연도", text
    ):
        return None
    return text


class LoadingLoreService:
    def __init__(self, *, clock=time.monotonic, cooldown=15.0, capacity=128):
        self.clock, self.cooldown, self.capacity = clock, cooldown, capacity
        self.lock = Lock()
        self.entries = OrderedDict()

    def get(self, game_id, state, generator):
        now = self.clock()
        with self.lock:
            entry = self.entries.get(game_id)
            if entry is not None:
                self.entries.move_to_end(game_id)
                if entry["pending"] or now - entry["at"] < self.cooldown:
                    return {"text": entry["text"], "source": entry["source"]}
            else:
                entry = {"text": FALLBACK, "source": "fallback", "at": now, "pending": False}
                self.entries[game_id] = entry
                while len(self.entries) > self.capacity:
                    self.entries.popitem(last=False)
            entry["pending"], entry["at"] = True, now
            setting = list(PUBLIC_SETTING)
            if state.get("flags", {}).get("loop_observed"):
                setting.append("차창 밖에서 같은 철교와 터널이 반복되는 것을 이미 관찰했다")
            context = {"setting": setting,
                       "visible_room": ROOMS.get(state.get("location"), "객차"),
                       "lighting": "어두움" if state.get("location") == "car_3" and not state.get("flags", {}).get("light_on") else "희미한 열차 조명",
                       "previous_line": entry["text"]}
        try:
            text = clean_loading_text(generator.generate_loading_lore(context))
        except Exception:
            text = None
        with self.lock:
            if text:
                entry.update(text=text, source="ai")
            entry["pending"] = False
            return {"text": entry["text"], "source": entry["source"]}
