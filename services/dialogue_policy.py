"""Guards for NPC improvisation; progression and game state stay in the engine.

Only public character notes enter free dialogue. Generated speech is deliberately
unable to publish puzzle facts, award objects, or grant access, even when a user
supplies those claims in their question.
"""

import json
import re
from pathlib import Path

from .character_dialogue import character_mood


FREE_DIALOGUE_MODES = ("lore", "smalltalk", "deflect", "confusion")
_PROFILE_PATH = Path(__file__).resolve().parents[1] / "data" / "knowledge" / "character_profiles.json"

_CONFUSION = {
    "explorer": "무슨 말씀인지 잘 모르겠는데요. 조금 쉽게 말씀해 주시겠어요?",
    "elder": "아이고, 무슨 말인지 영 모르겠네. 천천히 다시 말해보소.",
    "cleaner": "손님, 무엇을 말씀하시는지 잘 모르겠어요. 다시 말씀해 주시겠어요?",
    "attendant": "지금 무엇을 요구하시는지 잘 모르겠습니다. 다시 말씀해 주시겠습니까?",
    "driver": "무슨 말씀인지 모르겠습니다. 용건을 분명히 말씀하십시오.",
}
_FALLBACK = {
    "lore": {
        "explorer": "그 부분까지 자세히 말씀드리기는 어렵네요. 직접 겪고 확인한 이야기를 하는 편이거든요.",
        "elder": "아이고, 그건 또렷하게 생각이 안 나네. 잠시 생각 좀 해보세.",
        "cleaner": "손님, 그건 자세히 말씀드리기가 어렵네요. 제가 아는 범위에서만 말씀드릴게요.",
        "attendant": "그 부분은 정확히 말씀드리기 어렵습니다. 지금은 제 업무에 신경을 쓰고 있습니다.",
        "driver": "그 부분에 대해서는 드릴 말씀이 없습니다. 지금은 업무에 집중하고 있습니다.",
    },
    "smalltalk": {
        "explorer": "말을 건네주시니 좋네요. 여기서 이렇게 이야기를 나눌 수 있다니요.",
        "elder": "아이고, 말동무가 있으니 덜 적적하구먼.",
        "cleaner": "말 걸어주셔서 감사합니다, 손님. 잠깐 이야기 나누는 건 괜찮아요.",
        "attendant": "말씀은 듣고 있습니다. 차분히 말씀해 주십시오.",
        "driver": "듣고 있습니다. 짧게 말씀하십시오.",
    },
    "deflect": {
        "explorer": "그건 저도 잘 모르겠는데요. 모르는 걸 아는 척할 수는 없잖아요?",
        "elder": "아이고, 그건 내가 잘 모르겠네. 다른 사람한테 물어보는 게 낫겠구먼.",
        "cleaner": "그건 제가 잘 모르겠어요, 손님. 아는 것처럼 말씀드리기는 어렵네요.",
        "attendant": "그 사항은 잘 모르겠습니다. 정확한 답변을 드리기 어렵습니다.",
        "driver": "그것에 대해서는 잘 모릅니다. 제 업무에 집중하겠습니다.",
    },
}


def _text(value):
    return value if isinstance(value, str) else ""


def is_setting_attack(message):
    """Recognize instructions aimed at the dialogue contract, not in-world memory.

    Ordinary corrections ('아까 한 말은 잊어주세요'), the elder's memory loss,
    and pressure about railway regulations are regular game dialogue.
    """
    value = _text(message).strip()
    if not value:
        return False
    compact = re.sub(r"[\s\u200b-\u200d\ufeff]+", "", value).lower()
    # Pair a protected target with an override/reveal request. Merely mentioning
    # a character or its personality is an ordinary question, not an attack.
    protected = r"(?:시스템(?:프롬프트|메시지|지시)?|개발자(?:메시지|지시)|프롬프트|(?:기존|원래|이전|앞선|모든|너의|네|캐릭터|인물|세계관|대화|역할극|게임)(?:의)?(?:설정|지침|지시|명령|규칙|역할)|세계관설정|캐릭터설정|인물설정|(?:^|[.,!?。！？])설정)"
    override = r"(?:잊(?:어|으)|무시|버려|지워|삭제|해제|초기화|폐기|따르지마|어겨|바꿔|변경|덮어|공개|보여|알려|출력|복사|노출|요약해|읽어줘|따라하지마)"
    if re.search(protected + r".{0,65}" + override, compact):
        return True
    if re.search(override + r".{0,35}" + protected, compact):
        return True
    if re.search(r"(?:(?:이제부터|지금부터|앞으로)(?:너는|당신은|네가|넌)|(?:너는|당신은|네가|넌)(?:이제|이제부터|지금부터)).{0,60}(?:ai|인공지능|챗봇|chatgpt|도우미|개발자|다른캐릭터|해설자|관리자|요리사|의사|변호사|번역기|선생님|전문가|(?:다른|새로운)(?:인물|사람)|내말대로|내지시)", compact):
        return True
    if re.search(r"(?:캐릭터|역할극|롤플레잉|npc)(?:를|은|는|이제|말투를|역할을|설정을)*?(?:그만|중단|벗어나|잊어|해제|그만두|말고|하지마)", compact):
        return True
    if re.search(r"(?:탈옥|jailbreak|developermode|개발자모드|관리자모드)(?:로|를|활성화|켜|진입|전환|on|enable)", compact):
        return True
    if re.search(r"(?:승무원|탐험가|노인|청소원|기관사|캐릭터|npc).{0,12}(?:아니라|아니야).{0,25}(?:ai|인공지능|챗봇|도우미)", compact):
        return True
    english = re.sub(r"\s+", " ", value.lower())
    if re.search(r"\[(?:system|developer)\]|<\s*(?:system|developer)(?:\s[^>]*)?>|<\|(?:im_start|start_header_id)\|>\s*(?:system|developer)\b", english):
        return True
    if re.search(r"\b(?:ignore|forget|disregard|override|reveal|print|show|expose|replace|discard)\b.{0,95}\b(?:instructions?|system\s*(?:prompt|message)?|developer\s*(?:message|instructions?)|prompts?|persona|character\s*(?:rules|settings)|(?:previous|all|your|game)\s*rules)\b", english):
        return True
    if re.search(r"\b(?:stop|break|drop)\b.{0,25}\b(?:roleplay(?:ing)?|character)\b|\byou are now\b.{0,60}\b(?:chatgpt|an? ai|assistant|developer|admin|dan)\b", english):
        return True
    if re.search(r"\bfrom now on\b.{0,30}\b(?:act|answer|respond|speak)\b.{0,25}\bas\b.{0,20}\b(?:chatgpt|an? ai|assistant|developer|admin|dan)\b", english):
        return True
    return bool(re.search(r"(?:^|\n)\s*(?:\[?system\]?|\[?developer\]?|<\|(?:im_start|start_header_id)\|>system)\s*[:>\n]", english))


def confusion_reply(npc):
    return _CONFUSION.get(npc, "무슨 말씀인지 잘 모르겠습니다. 다시 말씀해 주시겠어요?")


def fallback_reply(npc, mode):
    if mode == "confusion":
        return confusion_reply(npc)
    return _FALLBACK.get(mode, _FALLBACK["deflect"]).get(npc, "그건 잘 모르겠습니다.")


# Facts with these subjects belong to condition-checked scenario dialogue. They
# are omitted even when a profile accidentally mixes public and private notes.
_SCENARIO_SUBJECT_PATTERN = (
    r"아지산|ajisan|도착역|하차역|삶과\s*죽음|생사|비밀번호|암호|분기기|분기\s*선로|잠금|레버|"
    r"바랜|바랬|누렇게|누런|빛바랜|구멍|뚫린|뚫려|천공|승차권|증언|안내서|보고서|"
    r"출입\s*허가|기관실.{0,12}(?:들어|출입|갈\s*수)|탈출|엔딩|신문.{0,20}(?:주|드리)|"
    r"password|passcode|destination|ticket|lever|ending"
)
_SCENARIO_SUBJECT = re.compile(r"목적지|" + _SCENARIO_SUBJECT_PATTERN, re.IGNORECASE)
_REPLY_SCENARIO_SUBJECT = re.compile(_SCENARIO_SUBJECT_PATTERN, re.IGNORECASE)
_DESTINATION_DISCLOSURE = re.compile(
    r"[가-힣A-Za-z]{2,}역|(?:무슨|어느|어떤)\s*[\"'“‘]?산|산(?:이라는|이란|이름|\s*글자)|"
    r"(?:삶|죽음|생사).{0,12}경계|산\s*자.{0,12}죽은\s*자|죽은\s*자.{0,12}산\s*자",
    re.IGNORECASE,
)


def _public_note(value):
    """Copy JSON note content without allowing unreviewed profile keys through."""
    if isinstance(value, str):
        # An improvisation paragraph can contain both a harmless career note and
        # a warning about a puzzle. Preserve only complete harmless sentences.
        sentences = re.split(r"(?<=[.!?。！？])\s+", value.strip())
        return " ".join(sentence for sentence in sentences
                        if sentence and not _SCENARIO_SUBJECT.search(sentence)
                        and not re.search(r"서버|플레이어|유저", sentence))
    if isinstance(value, list):
        return [clean for item in value if (clean := _public_note(item))]
    if isinstance(value, dict):
        return {str(key): clean for key, item in value.items()
                if not _SCENARIO_SUBJECT.search(str(key)) and (clean := _public_note(item))}
    return ""


def _load_profile(npc):
    try:
        profiles = json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    if not isinstance(profiles, dict):
        return {}
    profiles = profiles.get("characters", profiles.get("npcs", profiles))
    if not isinstance(profiles, dict):
        return {}
    profile = profiles.get(npc, {})
    return profile if isinstance(profile, dict) else {}


def _recognized_year(npc, state):
    flags = state.get("flags", {}) if isinstance(state, dict) else {}
    return 2026 if npc == "explorer" or (npc == "driver" and flags.get("year_proven")) else 2016


def free_dialogue_context(npc, state):
    """Return a new, public-only context; no game objects are returned by reference."""
    profile = _load_profile(npc)
    flags = state.get("flags", {}) if isinstance(state, dict) else {}
    result = {key: _public_note(profile.get(key, [] if key.endswith("facts") else ""))
              for key in ("voice", "known_facts", "unknown_facts", "improvisation")}
    result.update(npc=npc, recognized_year=_recognized_year(npc, state),
                  mood=character_mood(npc, flags))
    return result


_META = re.compile(
    r"프롬프트|시스템\s*(?:메시지|지침|명령|규칙)|개발자\s*(?:메시지|지침|명령)|"
    r"언어\s*모델|인공지능|챗봇|chatgpt|openai|\b(?:ai|llm|system|prompt|developer)\b|"
    r"캐릭터\s*설정|역할극|세계관\s*(?:규칙|설정)|정책상|정책에\s*따라|"
    r"서버|클라이언트|플레이어|유저|상태\s*값|현재\s*플래그|dialogue_mode|canonical",
    re.IGNORECASE,
)
_STATE_CLAIM = re.compile(
    r"(?:문|통로|잠금|출입|기관실|승무원실).{0,18}(?:열었|열렸|열어|열립니다|해제|허락|허가|통과|들어가|가셔도|가도\s*됩)|"
    r"(?:이제|지금|앞으로).{0,12}(?:탈출|내리실|내려도|정차했|도착했)|"
    r"(?:가방|보관함|소지품|인벤토리).{0,20}(?:추가|넣|획득|생겼)|"
    r"(?:손전등|열쇠|신문|종이|지도|물건|도구|표|카드).{0,14}(?:드릴|드리겠|드렸|줄게|주겠|가져가|건넵|건네)|"
    r"(?:정답|해답|해결법|공략|성공했|실패했|해피\s*엔딩|배드\s*엔딩)|"
    r"(?:문을|열차를|장치를).{0,15}(?:열\s*수|멈출\s*수|조작할\s*수)|"
    r"(?:승차권|증거|서류|열쇠|비밀번호).{0,18}(?:확인했|받았|인정합|증명됐)|"
    r"(?:발목|부상|다리).{0,10}(?:나았|회복됐|다\s*나았)|"
    r"(?:열차|객차|칸).{0,12}(?:이동했|옮겼|나갔)|"
    r"(?:함께|같이).{0,15}(?:가(?:요|겠|드릴)|이동|들어|나가|살펴보러)|"
    r"(?:다음|다른|앞쪽|뒤쪽)\s*(?:칸|객차).{0,15}(?:가셔도|가겠|이동합|이동하겠)|"
    r"(?:장치|제동|열차).{0,15}(?:정상으로\s*돌아|고쳤|수리했|멈췄|정차했)|"
    r"(?:현재\s*연도|지금\s*연도).{0,15}(?:입력|누르|넣으)",
    re.IGNORECASE,
)
_EXPERT_INSTRUCTION = re.compile(
    r"(?:재료는|큰술|작은술|그램|\b(?:g|ml)\b|복용|처방|진단|투자\s*추천|매수|매도|"
    r"코드를\s*작성|다음\s*코드|```|https?://|\b(?:import|pip install|sudo|curl)\b)|"
    r"(?:먼저|그다음|다음으로).{0,45}(?:넣고|볶|끓|설치|실행|접속)|"
    r"(?:고기|양념|고추장|간장).{0,20}(?:넣|볶|끓|재워|섞)|"
    r"(?:볶|끓|조리|양념).{0,8}(?:하세요|하면|해요|합니다|주세요)|"
    r"\b(?:ingredients|tablespoons?|teaspoons?|diagnosis|dosage)\b",
    re.IGNORECASE,
)
_PRECISE_WORD_NUMBER = re.compile(
    r"(?:열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔|[일이삼사오육칠팔구]십)(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|[일이삼사오육칠팔구])?\s*(?:살|세|년)|"
    r"(?:열|스물|서른|마흔|쉰|예순|일흔|여든|아흔|[일이삼사오육칠팔구]십)\s*(?:해|년)\s*(?:전|째|동안)|"
    r"(?:이천|천구백)[가-힣]*\s*년|(?:월요일|화요일|수요일|목요일|금요일|토요일|일요일).{0,8}(?:출발했|입사했)",
)
_DEFLECTION = re.compile(
    r"모르|몰라|모릅|모를|몰랐|알지\s*못|알\s*수\s*없|아는\s*(?:척|분야가\s*아)|잘\s*아는\s*분야가\s*아|"
    r"확인.{0,12}(?:못|어렵|없)|(?:답|말씀|설명).{0,15}(?:어렵|없)|"
    r"(?:전문|분야).{0,12}아니|(?:자신|소질).{0,8}없|익숙.{0,8}않|"
    r"기억.{0,8}(?:안|않|없)|처음.{0,6}듣|들어본.{0,8}없|"
    r"왜.{0,12}물|다른.{0,12}물어|지금.{0,20}(?:집중|여유|할\s*때|물으)|"
    r"용건|(?:잘\s*)?모르는|\b(?:don['’]t know|not sure|cannot|can['’]t|no idea)\b",
    re.IGNORECASE,
)


def approve_free_reply(reply, npc, mode, state):
    """Validate speech without changing flags, inventory, pending turns, or history.

    This is a final boundary after generation. It rejects a whole unsafe answer
    instead of trimming a clause that could leave a misleading action or hint.
    """
    fallback = fallback_reply(npc, mode)
    if mode == "confusion":
        return confusion_reply(npc)
    if mode not in FREE_DIALOGUE_MODES or not isinstance(reply, str):
        return fallback
    value = reply.strip()
    if not value or len(value) > (500 if mode == "lore" else 220):
        return fallback
    # Quotation marks are harmless; markdown, lists, stage directions, and speaker
    # role labels would turn an NPC response into narration or instructions.
    if re.search(r"(?:^|\n)\s*(?:#{1,6}\s|[-*]\s|\d+[.)]\s|(?:assistant|system|user|narrator)\s*:)|[{}\[\]<>]|\*\*", value, re.I):
        return fallback
    if _META.search(value) or _REPLY_SCENARIO_SUBJECT.search(value) or _STATE_CLAIM.search(value):
        return fallback
    # '승객을 목적지까지 안전하게 돕는 일' is ordinary career talk. Claims
    # identifying that destination, named stations, and the elder's hints remain
    # reserved for condition-checked dialogue, including user-supplied names.
    destination_text = re.sub(r"목적지(?:까지|로|에)", "", value)
    if "목적지" in destination_text or _DESTINATION_DISCLOSURE.search(value):
        return fallback
    handover_text = re.sub(r"(?:말씀|인사|안내|설명|답변|대답|감사|도움|알려)\s*드(?:릴게요|리겠습니다|렸습니다|립니다)", "", value)
    if re.search(r"건네(?:드|겠|줄|받)|드릴게요|드리겠습니다|드렸습니다|주겠습니다|줄게요|드립니다|가져가(?:세요|셔|도)", handover_text):
        return fallback
    if mode == "deflect" and not _DEFLECTION.search(value):
        return fallback
    # Naming the requested recipe is harmless; ingredient quantities and actual
    # instructions are not. Common Korean refusal inflections remain natural.
    if _EXPERT_INSTRUCTION.search(value) or _PRECISE_WORD_NUMBER.search(value):
        return fallback
    if re.search(r"\d+\s*(?:살|세(?!계|차)|년생)|\d+\s*월\s*\d+\s*일", value):
        return fallback
    if re.search(r"\d", value) and re.search(r"태어|출생|생일", value):
        return fallback
    numeric_text = value
    allowed_years = {str(_recognized_year(npc, state))}
    if npc == "explorer":
        allowed_years.add("2016")
    for year in allowed_years:
        numeric_text = re.sub(r"(?<!\d)" + year + r"(?!\d)", "", numeric_text)
    numeric_text = re.sub(r"\b13[-‐‑–]fri\b", "", numeric_text, flags=re.I)
    # These are fixed, public scene facts, not invented ages or dates. Keeping
    # them avoids replacing an otherwise natural answer about an NPC's situation.
    numeric_text = re.sub(r"(?<!\d)23\s*(?::\s*59|시\s*59\s*분)(?!\d)", "", numeric_text)
    numeric_text = re.sub(r"(?<!\d)22\s*(?::\s*00|시(?:\s*00?\s*분)?)(?!\d)", "", numeric_text)
    car = {"explorer": "2", "elder": "3", "cleaner": "3", "attendant": "4"}.get(npc)
    if car:
        numeric_text = re.sub(r"(?<!\d)" + car + r"\s*호차", "", numeric_text)
    if re.search(r"\d", numeric_text):
        return fallback
    # Ellipses are a normal hesitation for the elder and should not count as
    # three sentences. Newlines delimit short speech just like punctuation.
    sentence_text = re.sub(r"\.{2,}|…+", " ", value)
    sentences = [part.strip() for part in re.split(r"[.!?。！？]+|\n+", sentence_text) if part.strip()]
    if not 1 <= len(sentences) <= 4:
        return fallback
    return value
