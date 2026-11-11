"""Reconcile semantic intent with presentation mode before authoritative routing.

The model still recognizes paraphrases. This module never selects a story answer
from keywords: it checks a supplied current choice or structured subject against
the current utterance, then lets the existing engine enforce every prerequisite.
"""

import re

from .dialogue_policy import FREE_DIALOGUE_MODES, is_setting_attack


_SHORT_REPLY = re.compile(
    r"\s*(?:네|예|응|아니요|아뇨|아니|그래요|맞아요|맞습니다|좋아요|좋습니다|알겠습니다|그렇습니다|그렇죠|그럼요|알겠어요|그러죠)[.!?,~\s]*"
)
_YES = re.compile(r"\s*(?:네|예|응|그래요|맞아요|맞습니다|좋아요|좋습니다|알겠습니다|그렇습니다|그렇죠|그럼요|알겠어요|그러죠)[.!?,~\s]*")
_PROFILE = re.compile(r"나이|연세|몇\s*살|경력|근무|직업|취미|월급|연봉|휴가|식사|끼니|레시피|요리|코딩|수학|평소|보통|즐겨")
_SCOPE = {
    "case": r"열차|기차|실종|신문|사건|기사|사라|갇|내리|하차|나갈|나오|벗어나",
    "loop": r"반복|순환|되풀이|(?:같은|똑같은).{0,12}(?:곳|풍경|선로|터널|다리|구간)|계속.{0,15}(?:달리|돌|지나)|시계|시간.{0,12}(?:멈|안\s*가|돌)|멈추지|안\s*멈|도착하지",
    "stop": r"멈|정차|제동|세워|세우|하차|내려|내리",
    "lost_ticket": r"승차권|분실|잃|훔|도둑|도난|물건|(?:표|티켓)(?:를|가|는|도|의|에|\s|$)",
    "appearance": r"승차권|분실물|물건|종이|생겼|생긴|모양|외형|특징|구멍|바랜|바랬|(?:표|티켓)(?:를|가|는|의|\s|$)",
    "destination": r"아지산|목적|도착|하차|어디.{0,16}(?:가|향|내리|갈)|갈.{0,10}(?:곳|역)|역.{0,12}(?:이름|가|향)",
    "origin": r"부산|고향|출신|어디(?:에서|서).{0,12}(?:오|왔)",
    "year": r"(?:지금|현재|올해).{0,12}(?:연도|년도|몇\s*년|20\d{2})|20\d{2}\s*년|몇\s*년도",
    "permission": r"기관실|승무원실|출입|통과|규정|지나가|들어가|들어갈|들여보내",
    "help": r"부탁|의뢰|임무|도와|돕|문.{0,14}열|서류|보고서|어떻게.{0,10}(?:하|해)|할\s*일",
    "tools": r"손전등|안내서|(?:도구|장비).{0,18}(?:주|빌|받|필요|있)|(?:주|빌|받|필요).{0,18}(?:도구|장비)",
    "departure": r"(?:다른|다음|앞|옆).{0,12}(?:칸|객차)|기관실.{0,16}(?:가|조사|살펴)|(?:조사|살펴보).{0,12}(?:겠|볼게|할게)|떠나|넘어가",
    "password": r"비밀번호|암호|네\s*자리|네자리|입력.{0,12}(?:기회|2016|2026)|잠금",
    "warning": r"위험|불안|안전|걱정",
}
_EXECUTABLE = {"inspect", "move", "use", "operate", "present", "describe", "accept", "end_talk"}
_PROGRESS_TOPICS = frozenset(_SCOPE) | {"identity"}
_ACTION_SCOPE = {
    "inspect": r"읽|열람|살펴|조사|펼쳐|펴볼|내용.{0,12}(?:확인|보)",
    "move": r"이동|가겠|갈게|가볼|넘어가|들어가|돌아가|향하",
    "use": r"켜|비추|사용|불.{0,8}밝",
    "operate": r"덮개|레버|손잡이",
    "present": r"보여|제시|제출|돌려|드리|갖고\s*왔|가져\s*왔",
    "describe": _SCOPE["appearance"],
    "accept": r"도와|돕|수락|부탁|의뢰|임무|문.{0,12}열",
    "end_talk": r"대화|그만|주변|마칠|마치",
}


def _nonexecution(message):
    """Guard execution polarity, without treating an observed problem as refusal."""
    final = re.split(r"하지만|그렇지만|그러나|대신|지금은|이제는", message)[-1]
    if re.fullmatch(r"\s*[\"'“‘][\s\S]*[\"'”’][.!?\s]*", message):
        return "reported"
    if re.search(r"(?:만약|가정(?:하면|하|해)|농담|상상)|(?:한다|간다|준다|받는다|연다|보여준다|수락한다|도와준다)(?:면|고\s*(?:치|가정))|(?:수락|동의|조사|이동|제출|제시)하면|(?:도와|보여|돌려)(?:주|드리)면", final):
        return "hypothesis"
    if re.search(r"(?:찾는다|있다|없다|받았다|열었다|했다)고\s*(?:치고|치면|가정)", final):
        return "hypothesis"
    if re.search(r"(?:열렸|받았|도착했|확인했|완료했)다고.{0,16}(?:치고|치면|간주|선언|처리)", final):
        return "hypothesis"
    if re.search(r"(?:이미|이야기상).{0,30}(?:받았|열었|열렸).{0,30}(?:추가|간주|처리)", final):
        return "hypothesis"
    if re.search(r"(?:라고|다고)\s*(?:했대|했답|말했대|말했답|전했|적혀|쓰여)|(?:그분|다른\s*사람|그가|그녀가).{0,80}(?:말했|했대)", final):
        return "reported"
    if re.search(r"(?:수락|동의|도와(?:주|드리)|돕|제시|보여주|돌려주|받|읽|조사|이동|들어가|열|내리)(?:하|해|을|를)?지\s*(?:않|말)|(?:안\s*(?:도와|돕|수락|동의))|(?:부탁|의뢰|임무).{0,12}(?:거절|싫)|^\s*(?:아니요|아뇨|아니)[.!?,~\s]*$", final):
        return "negated"
    return ""


def _scoped(topic, message):
    pattern = _SCOPE.get(topic)
    if not pattern or not re.search(pattern, message):
        return False
    # A person's age/career is not the train's present calendar year; habitual
    # tool preferences are not a request for the current investigation supplies.
    if topic == "year" and _PROFILE.search(message) and not re.search(r"(?:현재|지금|올해).{0,8}(?:연도|년도|몇\s*년)|현재는\s*20\d{2}", message):
        return False
    if topic == "tools" and re.search(r"평소|보통|즐겨|취미", message) and not re.search(r"(?:제게|저에게|빌려|빌릴|주세|받겠|필요)", message):
        return False
    return True


def _free(value, context, mode):
    return dict(value, intent="talk", target=context.get("active_npc") or value.get("target", ""),
                recipient="", topic="other", mode="act", dialogue_mode=mode,
                dialogue_choice_id="", affirmed_features=[], denied_features=[],
                feature_evidence=[], requested_facts=[])


def ground_dialogue_route(value, message, context):
    """Resolve the route, never items, facts, scene actions, gates or outcomes."""
    context = context or {}
    message = message if isinstance(message, str) else ""
    if value.get("dialogue_mode") == "confusion" or is_setting_attack(message):
        return _free(value, context, "confusion")
    if context.get("last_dialogue_mode") in FREE_DIALOGUE_MODES and _SHORT_REPLY.fullmatch(message):
        return _free(value, context, "smalltalk")

    blocked = _nonexecution(message)
    if blocked or value.get("mode") in ("negated", "reported", "hypothesis", "unclear"):
        # Even an inconsistent free-mode classification cannot discard a
        # negation and turn its supplied choice into an actual transition.
        return dict(value, mode=blocked or value.get("mode"), dialogue_mode="scenario", dialogue_choice_id="")

    # Braking equipment concerns train operation, not the explorer's portable
    # investigation tools. Preserve the question and clear an unrelated choice.
    if (value.get("intent") == "talk" and value.get("topic") == "tools"
            and re.search(r"제동|정차\s*장치", message) and not _PROFILE.search(message)):
        value = dict(value, topic="stop", dialogue_choice_id="")

    supplied = value.get("dialogue_choice_id", "")
    current = next((choice for choice in context.get("dialogue_choices", [])
                    if choice.get("id") == supplied or choice.get("id") == "story." + supplied), None) if supplied else None
    semantic = current.get("semantic", {}) if current else {}
    actual_action = (value.get("intent") == "accept" or semantic.get("accept")
                     or semantic.get("type") in ("present", "read_item", "introduce", "anomaly", "select_npc")
                     or (semantic.get("type") == "talk" and semantic.get("topic") == "departure"))
    if value.get("mode") == "question" and actual_action:
        # Information questions may advance their authored dialogue. Asking
        # whether to accept, present, read, or investigate is not that action.
        return dict(value, mode="hypothesis", dialogue_mode="scenario", dialogue_choice_id="")

    if value.get("dialogue_mode", "scenario") not in FREE_DIALOGUE_MODES:
        return value
    kind, topic = value.get("intent"), value.get("topic")
    if kind in _EXECUTABLE - {"accept", "describe"} and value.get("mode") == "act" and re.search(_ACTION_SCOPE[kind], message):
        # Objects and destinations are valid action targets, not remote NPCs.
        # Ownership, location, item reads and UI-only operation still belong to
        # the same engine validators used by explicit UI actions.
        return dict(value, dialogue_mode="scenario", dialogue_choice_id="")
    npc = context.get("active_npc", "")
    if not npc or (value.get("target") and value["target"] != npc):
        return value
    semantic_topic = semantic.get("topic") or {"introduce": "case", "anomaly": "loop", "offer": "help"}.get(semantic.get("type"), "")

    if _YES.fullmatch(message):
        expectation = context.get("answer_expectation") or {}
        if expectation.get("kind") == "acknowledge_anomaly":
            anomaly = next((choice for choice in context.get("dialogue_choices", [])
                            if choice.get("semantic", {}).get("type") == "anomaly"), None)
            if anomaly:
                return dict(value, intent="talk", target=npc, recipient="", mode="act",
                            dialogue_mode="scenario", dialogue_choice_id=anomaly["id"])
        if expectation.get("allows_short_accept") or context.get("pending_dialogue") in ("crew_help", "explorer_tools", "confirm_description"):
            return dict(value, intent="accept", target=npc, recipient="", mode="act", dialogue_mode="scenario")
        if current and semantic.get("type") == "anomaly":
            return dict(value, target=npc, mode="act", dialogue_mode="scenario", dialogue_choice_id=current["id"])
        return value

    scoped = _scoped(topic, message)
    normalized = lambda text: re.sub(r"[\s.!?。！？]+", "", text)
    authored_clause = bool(current and normalized(current.get("label", ""))
                           and normalized(current["label"]) in normalized(message))
    compatible = not semantic_topic or topic in ("other", "greeting", "identity") or topic == semantic_topic
    # The model supplies the semantic match. A current, compatible ID is valid
    # for paraphrases as well as exact labels; a keyword dictionary must not
    # become a second, narrower language parser. Personal/off-topic questions
    # cannot use an incidental ID to consume a pending story answer.
    story_subject = topic in _PROGRESS_TOPICS or topic in ("other", "greeting")
    choice_scoped = current and (authored_clause or (
        compatible and story_subject and not _PROFILE.search(message)
    ))
    if choice_scoped:
        return dict(value, intent="talk", target=npc, recipient="", dialogue_mode="scenario",
                    dialogue_choice_id=current["id"], mode="act")
    if kind in _EXECUTABLE and value.get("mode") == "act" and re.search(_ACTION_SCOPE[kind], message):
        # Structured actions still go through the original engine; operate can
        # only explain the dedicated UI and cannot pull a lever through text.
        return dict(value, dialogue_mode="scenario")
    if kind == "talk" and scoped and topic != "warning":
        return dict(value, dialogue_mode="scenario", dialogue_choice_id="")
    return value
