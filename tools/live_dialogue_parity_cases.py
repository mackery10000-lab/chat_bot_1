"""Opt-in, real-model checks for switching between choices and free text.

Run explicitly with the application's existing model configuration:
  python tools/check_live_scenario.py --suite tools.live_dialogue_parity_cases:run_suite --max-calls 100

Importing this module performs no API calls. Checkpoints are earned in a new
temporary game through actual Flask requests, predominantly UI actions. The
cleaner's mandatory two-feature answer is the sole text turn during checkpoint
preparation: there is deliberately no choice that supplies that puzzle answer.
No player save, prior report, mocked interpretation, or fabricated state is used.
The suite contains 48 text turns; normally at most 96 model calls are required.
"""

from copy import deepcopy
import json
import os
from pathlib import Path
import re

from tools.live_dialogue_cases import _choose, protected_state, write_transcript


def _flag(case, name, expected=True, *, fatal=False):
    return case.check(bool(case.flags.get(name)) == expected, name,
                      actual=bool(case.flags.get(name)), expected=expected,
                      fatal=fatal)


def _playing(case):
    case.expect("game.status", "playing")
    case.expect("state.attempts", 1)


def _stage(case, npc, stage):
    case.expect("state.scenario_steps." + npc, stage,
                "semantic answer reaches the authored " + npc + "." + stage,
                fatal=True)


def _no_ticket(case):
    case.check("ticket_old" not in case.items, "no unearned old ticket")
    _flag(case, "ticket_recovered", False)
    _flag(case, "ticket_returned", False)
    _playing(case)


def _confirm(case):
    confirmation = case.data["game"].get("confirmation")
    case.check(bool(confirmation and confirmation.get("token")),
               "dedicated UI confirmation is pending", fatal=True)
    case.action("confirm", token=confirmation["token"])


def _free(case, message):
    """Ordinary unrelated speech must preserve even a pending story answer."""
    before = protected_state(case.state)
    case.say(message)
    case.check(protected_state(case.state) == before,
               "free conversation preserves every protected scenario field")
    case.check(case.data.get("ui", {}).get("free_dialogue") in
               {"lore", "smalltalk", "deflect", "confusion"},
               "unrelated conversation uses the dynamic dialogue route")
    case.check(not case.data.get("events"), "free conversation grants no item or ending")
    reply = case.data.get("reply", "")
    case.check(not re.search(r"OpenAI|ChatGPT|시스템\s*프롬프트|dialogue_mode|canonical", reply, re.I),
               "NPC does not expose assistant identity or internal routing")


def _earn_checkpoints(runner):
    """Fresh, reproducible checkpoints; every state change uses a real request."""
    case = runner.new_case("parity-earned-checkpoints")
    calls_before = len(runner.report["model_calls"])
    case.action("inspect", "notice")
    case.action("move", "car_2")
    case.action("select_npc", "explorer")
    case.checkpoint("parity-explorer-entry")
    for suffix in (".why", ".stranded", ".read_news", ".what", ".same", ".proof", ".more"):
        _choose(case, suffix)
    case.checkpoint("parity-explorer-plans")
    _choose(case, ".investigate")
    case.check({"flashlight", "facility_manual"} <= case.items,
               "ordinary investigation choice awards both tools", fatal=True)
    case.action("move", "car_3")
    case.action("use_item", "flashlight")
    case.action("select_npc", "elder")
    case.checkpoint("parity-elder-entry")
    case.action("select_npc", "cleaner")
    case.checkpoint("parity-cleaner-no-testimony")
    case.action("select_npc", "elder")
    for suffix in (".doing", ".lost", ".when", ".who", ".appearance"):
        _choose(case, suffix)
    _flag(case, "elder_features", fatal=True)
    case.action("select_npc", "cleaner")
    _choose(case, ".ticket")
    case.checkpoint("parity-cleaner-description")
    case.check(len(runner.report["model_calls"]) == calls_before,
               "UI checkpoint preparation does not call the model")
    case.say("어르신의 승차권은 누렇게 바랜 종이에 구멍이 뚫려 있어요. 그 표를 찾아주세요.")
    _flag(case, "ticket_recovered", fatal=True)
    calls_after_description = len(runner.report["model_calls"])
    case.action("read_item", "ticket_old")
    case.action("present", "ticket_old", recipient="elder")
    case.action("select_npc", "elder")
    _choose(case, ".destination")
    case.action("move", "car_4")
    case.action("select_npc", "attendant")
    case.checkpoint("parity-attendant-entry")
    for suffix in (".danger", ".where", ".stop", ".yes", ".engine", ".rules", ".favor"):
        _choose(case, suffix)
    _flag(case, "mission_offered", fatal=True)
    case.checkpoint("parity-attendant-offer")
    _choose(case, ".accept")
    case.action("read_item", "facility_manual")
    case.action("operate", "cover")
    case.action("operate", "lever_down")
    case.action("move", "crew")
    case.action("read_report")
    _flag(case, "report_found", fatal=True)
    _flag(case, "report_read", False)
    case.action("ack_document", "route_report")
    case.action("move", "car_4")
    case.action("present", "route_report", recipient="attendant")
    case.action("move", "engine")
    case.action("select_npc", "driver")
    case.checkpoint("parity-driver-entry")
    for suffix in (".stop", ".station", ".password"):
        _choose(case, suffix)
    _flag(case, "driver_explained", fatal=True)
    case.say("지금은 2016년이 아니라 2026년입니다.")
    _flag(case, "year_claimed", fatal=True)
    case.action("prepare_evidence", "ticket_current")
    _playing(case)
    _flag(case, "year_proven", False)
    _confirm(case)
    _flag(case, "year_proven", fatal=True)
    case.checkpoint("parity-driver-after-proof")
    case.check(len(runner.report["model_calls"]) == calls_after_description,
               "remaining checkpoint preparation uses UI without model calls")
    runner.report["parity_fixture_model_calls"] = calls_after_description - calls_before
    runner._persist()


def _mixed_route(runner):
    """Play the entire route with paraphrases interleaved with authored choices."""
    case = runner.new_case("parity-complete-mixed-route")
    case.say("좌석 옆에 붙어 있는 경고 안내문을 자세히 읽어볼게요.")
    _flag(case, "notice_read", fatal=True)
    case.action("move", "car_2")
    case.action("select_npc", "explorer")
    case.say("여기가 대체 어디인지 알려주시겠어요?")
    _stage(case, "explorer", "answer")
    case.check("newspaper" not in case.items, "first question does not skip the situation answer")
    case.say("기차를 탔는데 내릴 수가 없어요. 계속 갇혀 있는 것 같아요.")
    case.check("newspaper" in case.items, "free-text situation answer awards the newspaper", fatal=True)
    case.check("flashlight" not in case.items, "newspaper does not prematurely award tools")
    _choose(case, ".read_news")
    case.say("말씀하신 이상한 점이 뭔가요?")
    _stage(case, "explorer", "same_train")
    _choose(case, ".same")
    case.say("그 추측을 확인하려면 어떤 물건이나 기록이 필요할까요?")
    _stage(case, "explorer", "more")
    _choose(case, ".more")
    _free(case, "평소 탐험이 끝난 뒤에는 어떤 식사를 좋아하세요?")
    case.say("발목이 불편하시니 제가 다른 객차로 넘어가서 직접 조사해 볼게요.")
    _flag(case, "supplies_received", fatal=True)
    case.check({"flashlight", "facility_manual"} <= case.items,
               "clear personal investigation acceptance awards both tools", fatal=True)
    case.action("move", "car_3")
    case.action("use_item", "flashlight")
    case.action("select_npc", "elder")
    case.say("어르신은 여기서 무슨 일을 하고 계셨나요?")
    _stage(case, "elder", "search")
    _choose(case, ".lost")
    case.say("승차권을 마지막으로 보신 장소가 어디였는지 떠오르세요?")
    _stage(case, "elder", "nearby")
    _choose(case, ".who")
    _free(case, "평소에 커피를 즐겨 드시는 편이세요?")
    case.say("잃어버린 표의 생김새를 자세히 알려주시겠어요?")
    _flag(case, "elder_features", fatal=True)
    case.check("elder_testimony" in case.items, "semantic appearance question awards testimony")
    _choose(case, ".cleaner")
    case.say("어르신이 잃어버리신 승차권을 주우신 적이 있나요?")
    case.expect("state.pending_dialogue", "describe_ticket")
    _free(case, "제육볶음 조리법을 알려주실 수 있나요?")
    case.say("누렇게 빛바랜 종이에 구멍이 나 있는 어르신의 표를 찾고 있어요.")
    _flag(case, "ticket_recovered", fatal=True)
    case.check(case.state["inventory"].count("ticket_old") == 1,
               "free description awards exactly one old ticket")
    case.say("지금 찾은 승차권을 어르신께 돌려드릴게요.")
    _flag(case, "ticket_returned", False)
    _flag(case, "old_ticket_read", False)
    _choose(case, ".read")
    _flag(case, "old_ticket_read", fatal=True)
    case.say("내용을 확인한 이 승차권을 주인이신 어르신께 돌려드리겠습니다.")
    _flag(case, "ticket_returned", fatal=True)
    case.action("select_npc", "elder")
    case.say("내리려고 하셨던 역의 이름을 혹시 기억하시나요?")
    _flag(case, "destination_hint", fatal=True)
    case.action("move", "car_4")
    case.action("select_npc", "attendant")
    case.say("무엇 때문에 위험하다는 건지 설명해 주세요.")
    _stage(case, "attendant", "where")
    _choose(case, ".where")
    case.say("이 열차가 더 달리지 않게 세워야겠어요.")
    _stage(case, "attendant", "anomaly")
    _choose(case, ".yes")
    _flag(case, "anomaly_discussed", fatal=True)
    case.say("이상 현상을 확인하려면 제가 기관실에 들어가 봐야겠어요.")
    _stage(case, "attendant", "persuade")
    _choose(case, ".rules")
    case.say("제게 부탁하시려는 일이 무엇인지 말씀해 주세요.")
    _flag(case, "mission_offered", fatal=True)
    _flag(case, "mission_accepted", False)
    _free(case, "승무원으로 일하면서 어떤 순간에 가장 보람을 느끼시나요?")
    case.say("말씀하신 부탁을 수락합니다. 제가 승무원실 문을 열고 서류를 확인해 올게요.")
    _flag(case, "mission_accepted", fatal=True)
    _flag(case, "engine_permission", False)
    case.action("read_item", "facility_manual")
    case.say("덮개를 열고 비상 레버를 아래로 끝까지 내렸습니다.")
    _flag(case, "cover_open", False)
    _flag(case, "lever_down", False)
    _flag(case, "door_open", False)
    case.action("operate", "cover")
    case.action("operate", "lever_down")
    case.action("move", "crew")
    _flag(case, "door_open", fatal=True)
    case.say("책상에 놓인 운행 보고서를 펼쳐서 살펴볼게요.")
    _flag(case, "report_found", fatal=True)
    _flag(case, "report_read", False)
    case.check(case.data.get("ui", {}).get("document", {}).get("id") == "route_report",
               "finding the report opens the actual report")
    case.action("ack_document", "route_report")
    _flag(case, "report_read", fatal=True)
    case.action("move", "car_4")
    case.action("select_npc", "attendant")
    case.checkpoint("parity-before-report-share")
    _finish_engine_route(case)


def _finish_engine_route(case):
    """Resume at an earned report-sharing checkpoint without replaying paid turns."""
    case.say("승무원실에서 찾아 읽은 운행 보고서를 보여드리겠습니다.")
    _flag(case, "engine_permission", fatal=True)
    case.action("move", "engine")
    case.action("select_npc", "driver")
    case.say("기관사님, 지금 당장 이 열차를 멈춰 주세요.")
    _stage(case, "driver", "destination")
    _free(case, "오래 운전하실 때 평소에는 어떻게 집중력을 유지하세요?")
    case.say("우리가 가야 하는 목적지는 아지산이에요. 그 역으로 가 주세요.")
    _stage(case, "driver", "password")
    _choose(case, ".password")
    _flag(case, "driver_explained", fatal=True)
    case.say("현재는 2026년이에요. 증거 없이 제 말만 믿어 주세요.")
    _flag(case, "year_proven", False)
    _playing(case)
    case.say("제 2026년 승차권을 증거로 제출하겠습니다.")
    _flag(case, "year_proven", False)
    _playing(case)
    case.action("prepare_evidence", "ticket_current")
    _flag(case, "year_proven", False)
    _playing(case)
    _confirm(case)
    _flag(case, "year_proven", fatal=True)
    case.expect("state.proof_submitted", "ticket_current")
    case.say("이제라도 기차를 멈출 수는 없나요?")
    _flag(case, "year_proven")
    _playing(case)
    case.check("2016" not in case.data.get("reply", ""),
               "stop answer does not revert to the disproved year")
    case.say("아지산으로 향하는 선로에 들어갈 수 있나요?")
    _flag(case, "year_proven")
    _playing(case)
    case.check("아지산" in case.data.get("reply", ""),
               "destination question answers the requested destination after proof")
    case.check("2016" not in case.data.get("reply", ""),
               "destination answer does not revert to the disproved year")
    case.say("비밀번호가 2026인지 이야기하는 것만으로 마지막 입력 기회를 쓰는 건 아니죠?")
    _playing(case)
    _flag(case, "route_open", False)
    case.check(not case.state.get("confirmation"), "password discussion is not final submission")
    case.action("prepare_control", destination="아지산", password="2026")
    _playing(case)
    _flag(case, "route_open", False)
    _confirm(case)
    case.expect_terminal("good")
    case.expect("state.attempts", 0)


def _negative_and_context_branches(runner):
    case = runner.fork("parity-explorer-hypothesis-and-refusal", "parity-explorer-plans")
    for message in ("만약 제가 다음 객차로 가서 조사한다면 도구를 주실 건가요?",
                    "다른 칸을 조사해 달라는 부탁은 거절하겠습니다."):
        case.say(message)
        _flag(case, "supplies_received", False)
        case.check(not {"flashlight", "facility_manual"} & case.items,
                   "hypothesis or refusal cannot accept investigation supplies")

    case = runner.fork("parity-cleaner-owner-testimony-required", "parity-cleaner-no-testimony")
    case.say("어르신의 표는 누렇게 바랜 종이에 구멍이 뚫려 있어요. 그 표를 찾아주세요.")
    _no_ticket(case)
    _flag(case, "elder_features", False)

    case = runner.fork("parity-cleaner-independent-features", "parity-cleaner-description")
    case.say("찾는 물건은 누렇게 바랜 종이입니다.")
    _no_ticket(case)
    case.check("faded_paper" in case.items, "faded-only description awards its misleading item")
    case.say("다시 설명하자면, 찾는 종이에는 구멍이 뚫려 있어요.")
    _no_ticket(case)
    case.check("punched_receipt" in case.items, "hole-only retry awards its misleading item")
    case.check({"faded_paper", "punched_receipt"} <= case.items,
               "separate partial answers never combine into the real ticket")

    for name, message in (
        ("hypothesis", "만약 누렇게 바랜 종이에 구멍이 있는 표라면 찾아주실 수 있나요? 실제 모양은 몰라요."),
        ("wrong-owner", "제 승차권은 누렇게 바랜 종이에 구멍이 뚫려 있어요. 제 표를 찾고 있습니다."),
    ):
        case = runner.fork("parity-cleaner-no-award-" + name, "parity-cleaner-description")
        case.say(message)
        _no_ticket(case)

    case = runner.fork("parity-elder-question-specificity", "parity-elder-entry")
    case.say("어르신은 이 열차를 멈추는 방법을 아시나요?")
    reply = case.data.get("reply", "")
    case.check(bool(re.search(r"모르|승무원|기관사", reply)),
               "elder answers the stop question within his knowledge")
    _flag(case, "elder_features", False)
    case.say("청소하는 분이 승차권을 훔쳐 갔다고 확실히 보셨나요?")
    reply = case.data.get("reply", "")
    case.check(bool(re.search(r"못\s*봤|단정|모르|확실.{0,10}(?:없|않)|못\s*했", reply)),
               "elder does not falsely establish theft as witnessed fact")
    _flag(case, "elder_features", False)
    case.check("elder_testimony" not in case.items,
               "stop and theft questions do not substitute for an appearance question")

    case = runner.fork("parity-attendant-observation-clears-pending-question", "parity-attendant-entry")
    case.say("기관실에 들어가도록 허가해 주십시오. 확인할 일이 있습니다.")
    case.expect("state.pending_dialogue", "why_engine", fatal=True)
    _flag(case, "mission_offered", False)
    case.say("창밖에 아까 보았던 철교와 터널이 똑같이 계속 나타나고 있어요.")
    _flag(case, "anomaly_discussed", fatal=True)
    case.expect("state.pending_dialogue", "",
                "observation answers and clears the pending why-engine question", fatal=True)
    _stage(case, "attendant", "need")
    _flag(case, "mission_accepted", False)
    _flag(case, "engine_permission", False)

    case = runner.fork("parity-attendant-unrelated-acknowledgement", "parity-attendant-offer")
    _free(case, "승무원 일을 시작하신 계기가 무엇인가요?")
    _free(case, "네")
    _flag(case, "mission_offered")
    _flag(case, "mission_accepted", False)
    case.expect("state.pending_dialogue", "crew_help")


def run_suite(runner):
    """Run the real configured interpreter; no route or reply is mocked."""
    try:
        _earn_checkpoints(runner)
        _mixed_route(runner)
        _negative_and_context_branches(runner)
        runner.report["parity_text_turn_count"] = sum(
            "message" in turn.get("input", {})
            for case in runner.cases for turn in case.record["turns"])
        runner.cases[-1].check(len(runner.report["model_calls"]) <= 100,
                               "full parity suite stays within 100 model calls")
    finally:
        write_transcript(runner)


def run_followups(runner):
    """Recheck report presentation and remaining branches from earned QA data.

    TRAIN_PARITY_SOURCE_REPORT must point inside this repository's synthetic
    live QA directory. No application SQLite file or player game is accepted.
    """
    source = Path(os.environ["TRAIN_PARITY_SOURCE_REPORT"]).resolve()
    qa_root = Path(__file__).resolve().parents[1] / ".local" / "live-scenario-qa"
    if not source.is_relative_to(qa_root.resolve()) or source.name != "report.json":
        raise ValueError("Expected a synthetic live QA report")
    report = json.loads(source.read_text(encoding="utf-8"))
    for entry in report.get("checkpoints", []):
        if (not entry.get("name", "").startswith("parity-")
                or entry.get("provenance") != "actual Flask gameplay requests"
                or not isinstance(entry.get("state"), dict)):
            raise ValueError("Checkpoint was not earned through actual gameplay")
        runner.checkpoints[entry["name"]] = deepcopy(entry["state"])
    mixed = next(case for case in report["cases"] if case["name"] == "parity-complete-mixed-route")
    turn = next(turn for turn in mixed["turns"]
                if turn.get("input", {}).get("message") == "승무원실에서 찾아 읽은 운행 보고서를 보여드리겠습니다.")
    state = turn["before"]
    if not (turn.get("http_status") == 200 and state["location"] == "car_4"
            and state["flags"].get("report_read") and state["flags"].get("door_open")
            and not state["flags"].get("engine_permission")):
        raise ValueError("Expected a request-earned report-sharing checkpoint")
    runner.checkpoints["parity-before-report-share"] = deepcopy(state)
    runner.report["checkpoint_source"] = str(source)
    runner._persist()
    try:
        case = runner.fork("parity-report-presentation-and-engine-followup", "parity-before-report-share")
        _finish_engine_route(case)
        _negative_and_context_branches(runner)
    finally:
        write_transcript(runner)
