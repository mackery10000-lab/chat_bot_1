# 청소원의 부분 외형 설명과 소지품

노인의 외형 증언을 듣고 밝아진 3호차에서 청소원에게 분실물을 설명한다. 기존 진행 규칙을 유지하며, 단일 특징으로는 승차권 대신 서로 다른 종이를 받는다.

| 이번 설명 | 받는 소지품 | 원본 이미지 |
| --- | --- | --- |
| “누렇게 바랜 종이입니다.” | 바랜 종이 (`faded_paper`) | `public/assets/images/inventory/faded-paper.png` — 장식 테두리와 Invitation 글자의 초대장 |
| “구멍이 뚫린 종이입니다.” | 구멍 난 영수증 (`punched_receipt`) | `public/assets/images/inventory/punched-receipt.png` — 가운데와 아래쪽이 찢어진 영수증 |
| 같은 승차권에 바랜 종이·구멍을 함께 설명 | 기존 오래된 승차권 (`ticket_old`) | 기존 승차권 이미지 |

각 종이는 한 번만 지급한다. 같은 설명을 반복하면 앞서 준 종이를 언급하고 추가 특징을 물으며, 획득 알림이나 복제 아이템을 만들지 않는다. 다른 차례의 부분 특징은 합산하지 않는다. 두 종이를 가진 상태에서라도 한 발언 안에 실제 승차권의 두 특징을 설명하면 승차권을 정상적으로 받을 수 있다.

정전·노인 증언의 선행 조건은 유지한다. 가정·부정·다른 물건의 특징·자유 대화로는 지급하지 않는다. 이미 실제 승차권을 회수한 뒤에는 부분 설명으로 새 종이를 지급하지 않는다. 받은 초대장이나 영수증의 특징을 설명해도 노인의 표로 처리하지 않는다.

종이를 읽어도 실제 승차권 열람·반환이나 목적지 증언은 완료되지 않는다. 최종 연도 증거로 제출하면 다른 오답 물품과 같은 확인 및 BAD 분기를 따른다. 영수증 그림에 인쇄된 날짜는 새로운 단서나 정답 증거로 등록하지 않는다.

## 이미지와 기록장

사용자가 보낸 두 PNG는 원본 바이트와 투명도를 유지한다. 보관함 목록·상세 목록·획득 알림·상세 원본 이미지에 같은 그림을 사용한다. 기존 책과 사진 틀, 페이지 레이아웃을 따르고 휴대전화에서도 페이지를 나누어 표시한다.

설명은 기존 나눔명조 인쇄 도구로 별도 투명 PNG를 만든다. `records/faded-paper.png`와 `records/punched-receipt.png`는 900×1120 캔버스이며, 내용은 730px 안에 들어가게 한다. 현재 두 기록은 410px에서 끝나며 원본 그림의 외형과 실제 승차권이 아니라는 설명을 포함한다.

재생성:

```powershell
.\runtime\python.exe -I -B -X utf8 tools/export_inventory_records.py
& ./tools/print_inventory_records.ps1 -DocumentIds @('faded_paper','punched_receipt')
```

선택 생성은 기존 기록 PNG를 다시 쓰지 않는다. 전체 생성에서도 증언 기본 문서는 위치 인덱스 대신 문서 ID와 상태 이미지로 찾아, 아이템 개수가 늘어도 올바른 증언을 유지한다.

## 검증

`tests/test_cleaner_items.py`와 기존 언어 회귀 검사는 획득·재시도·중복·부정·다른 물건·정답 회수·진행 조건·최종 오답을 확인한다. `node tools/check_gameplay_ui.mjs --cleaner-items-only --screenshots`는 입력창부터 획득 알림·상세 열람까지 실행한다. `--inventory-only`에는 두 종이의 이미지와 페이지 배치 검사도 포함된다.

실제 API에서는 자연어 12회·API 19회 호출·146개 검사가 통과했다. [대화 기록](../.local/live-scenario-qa/cleaner-items-20261108/transcript.md), [검사 결과](../.local/live-scenario-qa/cleaner-items-20261108/report.json)를 보관했다. 기존 모델 설정과 API 키를 그대로 사용했고 실제 플레이 저장은 수정하지 않았다.

전체 Python 회귀 검사 186개가 통과했다. 원본 두 PNG의 SHA-256 일치와 기존 책·기록·배경 등 60개 자산의 바이트 유지도 확인했다. [보관함 배치 검사](../.local/gameplay-ui-qa/1794130720797/result.json) 545개, [입력부터 획득·상세 열람까지의 검사](../.local/gameplay-ui-qa/1794130930857/result.json) 71개가 통과했다. 1440·390·320px 화면에서 새 이미지와 설명을 직접 검토했으며 JavaScript 예외나 자산 요청 실패는 없었다. 구문·실행기·`git diff --check`도 통과했다.
