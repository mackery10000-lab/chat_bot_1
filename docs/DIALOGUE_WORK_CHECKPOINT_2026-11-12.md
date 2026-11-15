# 자유대화·선택지 작업 인수인계 — 2026-11-12

사용자의 시간 제약에 따라 추가 기능 구현을 멈추고 현재 변경을 보관했다.
이 문서를 기준으로 이어서 작업한다. 이미 적용한 변경을 처음부터 다시 구현하거나
세계관·진행 조건을 새로 설계하지 않는다.

## 기준과 현재 상태

- 작업 기준 커밋: `31a87be6b05de312affd4f983a3e63d41366be88`.
- 작업 시작 당시 Git 작업 트리는 깨끗했다. 현재 변경은 이 대화의 아키텍처 작업이다.
- 구현은 현재 작업 트리에 저장되어 있다. Git 이력과 브랜치는 변경하지 않았다.
- 원래 게임의 설정·세계관·인물 원문과 UI 자산은 수정하지 않았다.
- 기존 플레이 저장소와 `.env`를 편집하지 않았다. 검사는 임시 저장소를 사용했다.

## 적용한 변경

| 파일 | 역할 |
| --- | --- |
| `services/dialogue_routing.py` | 현재 선택지 의미, 직전 답변 기대 대상, 원문 근거, 실행·부정·가정·인용을 검증하는 공통 라우터와 내부 `DialogueRoute` |
| `services/chatbot_service.py` | 라우터 연결, 클릭과 자유 입력의 공통 선택지 실행, 비진행 응답과 대화 초점, 기존 보정 경로의 설정 변경 요구 차단 |
| `services/generator.py` | 같은 라우팅 계약 사용, 보고서 제시 의도 보존, 노인 증언 전달과 불확실한 표 특징 구별, 현재 선택지 맥락 안내 |
| `services/dialogue_policy.py` | 인물·서버 플래그별 공개 사실 투영, 질문에 맞는 대체 응답, 미공개 단서·허가·지급·엔딩 주장 차단 |
| `tests/test_mixed_input_sequences.py` | 200회 교차 대화, 저장 복구, 재전송, 무관한 현재 ID, 원문 근거, 설정 변경 요구, 청소원 선행 조건 회귀 검사 |
| `tests/test_dialogue_preservation.py`, `tests/fixtures/dialogue_preservation.json` | 기준 파일 11개와 핵심 실행 코드 16개 보존 검사 |
| 기존 대화 테스트 4개 파일 | 기존 테스트를 유지하고 원문 근거 fixture와 최신 증거·사건 공개 계약에 맞는 기대값 보완 |
| `tools/check_dialogue_ui.mjs`, `tools/dialogue_ui_server.py` | 무료 모의 모델을 사용한 실제 화면의 선택지·자유대화 교차 진행 검사 |
| `docs/ARCHITECTURE.md`, `docs/FREE_TEXT_PROGRESSION.md`, `docs/DIALOGUE_INTEROPERABILITY.md` | 실제 구현과 문서 계약 일치, 보존 범위·검증 방법 기록 |

실행 경로는 `입력 해석 → 현재 맥락·의미 검증 → 기존 choose/apply_intent → 기존 원자적 저장`이다.
라우터에 아이템·플래그·엔딩을 직접 변경하는 권한은 없다. UI, API 최상위 응답 형식,
SQLite 스키마와 확인 토큰 계약은 유지했다.

## 반드시 유지할 최근 수정

- 1호차 창문 상호작용과 관련 영상은 이미 제거된 상태를 유지한다.
- 청소원은 노인 증언 전에는 정상 응답·재확인 응답 모두 분실물 설명 분기를 제안하지 않는다.
- 청소원 승차권은 동일한 물건의 두 특징을 한 번의 유효한 설명에서 확인해야 한다.
- 승무원의 화장실 요청을 기관실 출입으로 연결하지 않는다. 삭제한 표정·걱정 선택지도 복구하지 않는다.
- 잡담·화장실·직업·연도 질문·문서 조사 뒤의 짧은 “네”로 이전 의뢰를 수락하지 않는다.
- 열람·원본 반환·보고서 전달·물리적 퍼즐·증거 및 제어 장치 최종 확인 조건을 완화하지 않는다.
- 설정 변경 요구가 노인의 행선지 답변, 승무원의 이상 관찰 보정, 기관사의 연도 주장 보정을 통해 진행되지 않는다.

## 실제 검증 결과

| 실행 | 결과 | 근거 |
| --- | --- | --- |
| 수정 전 전체 검사 | 256개 실행, 실패 41건·오류 3건 | `.local/dialogue-architecture-qa/baseline.json`, `baseline.log` |
| 통합 수정 후 전체 검사 | 292개 전부 통과, skip 없음 | `.local/dialogue-architecture-qa/accepted.json`, `accepted.log` |
| 마지막 보호 조건 추가 후 관련 검사 | 38개 전부 통과 | `test_mixed_input_sequences`, `test_characters`, `test_npc_interaction_feedback` |
| 코드·설정 보존 검사 | 2개 통과 | `test_dialogue_preservation` |
| 실제 브라우저 검사 | 90개 전부 통과 | `.local/dialogue-ui-qa/1794456150339/checks.json` |

전체 검사 292개가 통과한 뒤 설정 변경 요구 우회와 청소원 재확인 응답에 대한
보호 조건·테스트 2개를 추가했다. 이 변경을 포함한 관련 38개 검사는 통과했지만,
시간 제약으로 최신 상태의 전체 검사를 다시 실행하지는 않았다. 이를 숨기고 최신
전체 검사까지 완료됐다고 보고하지 않는다.

수정 전 통과하던 테스트 ID가 통합 전체 검사에서 빠진 항목은 없다. 삭제·skip한 테스트도 없다.
다만 사건 공개와 신문 지급의 원자성, 연도 주장 후 증거 보관함 노출, 실제 입력과
일치하는 모의 `quote`는 첨부 제안서와 기존 엔진 계약에 맞게 기대값을 보완했다.

보호 대상 전체 설정·지식·화면 자산 지문을 수정 전과 비교한 결과 차이는 0개다.
무료 모의 모델 검사만 실행했으며, 유료 API를 사용하는 실제 한국어 의미·자연스러움 검수는 실행하지 않았다.

## 백업과 충돌 방지

`.local/checkpoints/`의 최신 `dialogue-architecture-*` 폴더에 다음을 저장한다.

- 이번 변경 파일만 담은 `source-checkpoint.zip`.
- 추적 중인 파일의 변경분 `tracked-changes.patch`.
- 기준 커밋, 파일별 SHA-256, Git 상태와 검사 결과 위치를 담은 `checkpoint.json`.
- 전체·브라우저 검사 결과와 이 인수인계 문서.

`.local/checkpoints/LATEST_DIALOGUE_CHECKPOINT.txt`가 정확한 백업 폴더를 가리킨다.
백업에는 `.env`, 실제 게임 DB, 실행 환경 전체를 포함하지 않는다.

이후 다른 작업이 생겼다면 백업 ZIP을 작업 트리에 일괄 덮어쓰거나 패치를 바로 적용하지 않는다.
먼저 `checkpoint.json`의 기준 커밋과 파일 지문을 현재 상태와 비교하고 변경된 파일만 병합한다.
기존 작업 트리·브랜치·플레이 기록을 초기화할 필요는 없다.

## 재개 시 첫 작업

1. 현재 Git 상태와 위 백업의 파일 지문을 비교한다.
2. 추가 기능을 구현하기 전에 아래 전체 검사를 실행한다.

   ```powershell
   .\runtime\python.exe -B -X utf8 -m unittest discover -s tests -q
   ```

3. UI와 대화 경로를 더 바꿨다면 `node tools/check_dialogue_ui.mjs`를 재실행한다.
4. 실제 모델 검수는 API 사용을 명시적으로 결정한 별도 단계에서 임시 저장소로 진행한다.

`.local/check-dialogue-architecture.py`는 전체 검사 결과·보호 파일 지문을 다시 기록하는
로컬 보조 도구다. 다음 실행에는 기존 `baseline`·`accepted`를 덮어쓰지 않는 새 라벨을 사용한다.
