"""Run opt-in, paid dialogue QA with temporary saves and safe local reports.

Usage: python tools/check_live_dialogue.py --max-calls 160
Reuse earned fixtures: python tools/check_live_dialogue.py --source-report report.json --npcs explorer,elder
Configuration and credentials use the application's existing .env unchanged.
"""

import argparse
import json
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from tools.check_live_scenario import LiveScenarioRunner, main as scenario_main, safe_exception
from tools.live_dialogue_cases import NPC_QUESTIONS, load_earned_checkpoints, run_free_dialogue, write_transcript


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # Preserve the established full-suite CLI and its smoke/configuration modes.
    if "--source-report" not in argv and not any(arg.startswith("--source-report=") for arg in argv):
        return scenario_main(["--suite", "tools.live_dialogue_cases:run_suite", *argv])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-report", type=Path, required=True)
    parser.add_argument("--npcs", default=",".join(NPC_QUESTIONS), help="Comma-separated NPC IDs")
    parser.add_argument("--max-calls", type=int, default=160)
    parser.add_argument("--run-id")
    parser.add_argument("--export-checkpoints", action="store_true")
    args = parser.parse_args(argv)
    npcs = [npc.strip() for npc in args.npcs.split(",") if npc.strip()]
    if not npcs or len(set(npcs)) != len(npcs) or any(npc not in NPC_QUESTIONS for npc in npcs):
        parser.error("--npcs must contain unique IDs from explorer,elder,cleaner,attendant,driver")
    runner = None
    try:
        runner = LiveScenarioRunner(max_calls=args.max_calls, run_id=args.run_id,
                                    export_checkpoints=args.export_checkpoints)
        with runner:
            load_earned_checkpoints(runner, args.source_report, npcs=npcs)
            try:
                run_free_dialogue(runner, npcs=npcs)
            finally:
                write_transcript(runner)
        print(json.dumps({"status": runner.report["status"], "report": str(runner.report_path),
                          "model_calls": len(runner.report["model_calls"]),
                          "checks": runner.report["checks"]}, ensure_ascii=False))
        return int(runner.has_failed or runner.report["status"] != "passed")
    except KeyboardInterrupt:
        print(json.dumps({"status": "interrupted", "report": str(runner.report_path) if runner else None}))
        return 130
    except Exception as error:
        print(json.dumps({"status": "failed", "diagnostic": safe_exception(error),
                          "report": str(runner.report_path) if runner else None}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
