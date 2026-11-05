# 팀 협업과 실행 환경

화면·API·자료가 만나는 곳을 초기에 정하고, 기능을 작은 단위로 자주 연결해 보세요. 함께 개발할 때는 실행 방법, API 요청·응답 형식, 담당 파일을 서로 공유하는 것부터 시작하면 됩니다.

## 먼저 합의할 것

- 사용자가 실제로 하게 될 핵심 행동과 캐릭터 경험
- 꼭 필요한 기능, 여유가 있으면 추가할 기능, 실패했을 때의 화면
- 프런트와 서버가 같은 앱인지 나뉘는지, 요청·응답 형식은 무엇인지
- 자료를 쓴다면 자료의 출처와 검색이 필요한 질문은 무엇인지
- 모두가 사용할 로컬 실행 방법과 공개 배포 방식

화면 시안과 API 응답 예시를 같이 보면 화면에 필요한 데이터와 서버가 돌려줄 데이터를 맞추기 쉽습니다. 기능을 나누어 작업하더라도 API 계약과 파일 경계를 먼저 정하고, 자주 합쳐서 전체 흐름을 확인하세요.

## Git으로 함께 작업하기

처음에는 아래 흐름으로 시작하면 됩니다. GitHub 저장소에 팀원이 직접 참여하는 방식과, 각자 Fork한 뒤 Pull Request를 보내는 방식 모두 사용할 수 있습니다. 팀이 정한 하나의 기준 저장소와 `main` 브랜치에 작업을 모으세요.

저장소 소유자는 GitHub 저장소에서 **Settings → Collaborators**를 열어 팀원의 GitHub 아이디를 초대합니다. 초대받은 사람은 GitHub 알림이나 이메일에서 초대를 수락한 뒤 같은 저장소를 Clone합니다. 조직 저장소에서는 **Settings → Collaborators & teams**에 해당하는 메뉴를 사용합니다. [GitHub의 협업자 초대 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

저장소에 직접 push할 권한이 없다면 Fork한 저장소에서 작업하고 원본 저장소로 Pull Request를 보냅니다.

### 1. 저장소를 받고 작업 브랜치 만들기

저장소를 처음 받을 때:

```bash
git clone 저장소주소
cd 저장소폴더
git switch main
git pull --ff-only
git switch -c 브랜치명
```

이미 로컬에 저장소가 있다면 작업을 시작할 때 `main`을 최신화한 뒤 새 브랜치를 만듭니다.

```bash
git switch main
git pull --ff-only
git switch -c 브랜치명
```

`저장소주소`, `저장소폴더`, `브랜치명`은 각 팀의 실제 값으로 바꾸세요. 브랜치 이름 규칙은 팀에서 정하면 됩니다. 작업 중인 내용을 바로 `main`에 커밋하지 않는 방식을 권장합니다.

### 2. 작은 단위로 커밋하기

```bash
git status
git add services/generator.py
git commit -m "feat: 캐릭터 답변 생성 연결"
git push -u origin 브랜치명
```

커밋 메시지는 무엇을 바꿨는지 짧게 적고, 앞에 변경 종류를 붙입니다.

| 접두어 | 쓰는 경우 | 예시 |
| --- | --- | --- |
| `feat` | 새 기능 | `feat: 답변별 이미지 선택 추가` |
| `fix` | 오류 수정 | `fix: 빈 메시지 오류 처리` |
| `docs` | 문서 수정 | `docs: 배포 안내 보완` |
| `test` | 테스트 추가·수정 | `test: API 오류 응답 확인` |
| `refactor` | 동작은 유지하며 코드 정리 | `refactor: 검색 결과 조립 분리` |
| `style` | 코드 서식·이름 정리 | `style: Python 코드 포맷 정리` |
| `chore` | 빌드·개발 도구 설정 | `chore: 개발 의존성 추가` |

`.env`와 API 키가 들어간 파일은 커밋하지 않습니다. 커밋 전에 `git status --short`를 확인하고, 의심되는 파일은 `git check-ignore .env`로 제외 여부를 점검하세요.

### 3. Pull Request로 검토하고 합치기

브랜치를 푸시한 뒤 GitHub에서 `main`을 대상으로 Pull Request를 엽니다. 제목은 작업 내용이 보이게 쓰고, 설명에는 아래 내용을 적습니다.

```markdown
## 변경 내용
- 답변 생성기를 모델 호출로 연결

## 확인 방법
- `python -m unittest discover -s tests -v`
- 브라우저에서 캐릭터 대화와 오류 응답 확인

## 참고할 점
- 새 환경 변수 이름: `OPENAI_MODEL`
```

팀원이 변경 목적과 확인 방법을 읽고 코드를 검토합니다. 문제가 있으면 브랜치에서 수정하고 다시 푸시합니다. 검토가 끝나면 Pull Request를 `main`에 합치고, 다음 작업을 시작하기 전에 `main`을 다시 받아옵니다.

`main`에 다른 변경이 먼저 합쳐져 충돌이 나면, 작업 브랜치에서 최신 `main`을 합친 뒤 충돌 파일을 열어 의도에 맞게 정리합니다. 해결 후 테스트하고 커밋·푸시하세요. 두 사람이 같은 파일을 고칠 때는 먼저 변경 범위를 짧게 맞추면 충돌을 줄일 수 있습니다.

## 제공된 테스트는 무엇을 확인하나요?

`tests/test_smoke.py`는 **현재 Flask 데모가 기본적으로 실행되는지** 확인하는 코드입니다. 화면과 정적 파일이 열리는지, 채팅 API가 데모 응답과 입력 오류를 돌려주는지, 검색 결과가 답변 생성기로 전달되는지를 검사합니다. 실제 모델 답변이나 RAG 품질을 검사하지는 않습니다.

팀이 화면·API·서버 구조를 바꾸면 기존 테스트도 그 구조에 맞게 고치거나 새 테스트로 바꾸세요. 현재 데모의 경로와 응답을 그대로 유지하기 위해 프로젝트 구현을 제한할 필요는 없습니다.

로컬에서는 다음 명령으로 실행합니다.

```bash
python -m unittest discover -s tests -v
```

개발용 Docker Compose에서는 컨테이너에 `tests/`를 마운트하므로 다음 명령도 사용할 수 있습니다.

```bash
docker compose exec chatbot python -m unittest discover -s tests -v
```

테스트 파일은 Git 저장소에 함께 커밋됩니다. `.dockerignore`와 배포용 `Dockerfile`은 테스트·문서를 서비스 이미지에 복사하지 않도록 되어 있습니다. Compose에서 테스트를 실행할 수 있는 것은 개발 중에만 폴더를 컨테이너로 연결하기 때문입니다.

검색 품질이나 모델 답변의 사실성을 자동으로 보증하지 않으므로, 그런 부분은 질문 세트와 직접 확인한 결과도 함께 기록하세요.

## Conda와 Docker

Conda 또는 venv는 Python 가상환경을 관리하고, Docker는 OS 수준의 실행 환경과 의존성을 이미지로 묶습니다. 같은 작업에서 둘 다 중첩해 사용할 필요는 없습니다. 개인 개발은 익숙한 Conda로 하고, 팀 통합 과정에서 Compose로 앱을 빌드해 보는 조합은 가능합니다.

Docker Compose는 팀원 사이에 Python 버전·의존성·실행 명령을 맞추고 문제를 재현하는 데 유용합니다. 이 저장소의 Compose는 개발 서버를 띄우고 소스 파일을 읽기 전용으로 연결합니다.

컨테이너에 어떤 파일이 연결되는지, 새 패키지나 폴더를 추가할 때 무엇을 바꿔야 하는지는 [Docker 개발 가이드](DOCKER-GUIDE.md)에 정리했습니다.

```bash
docker compose up --build
docker compose ps
docker compose logs -f chatbot
docker compose exec chatbot python -m unittest discover -s tests -v
docker compose down
```

새 패키지를 추가하면 `requirements.txt`도 고치고 이미지를 다시 빌드합니다. 오류를 공유할 때는 실행 명령, 기대한 결과, 실제 결과, 비밀 값을 지운 로그를 함께 전달하세요. Compose는 개발에 쓸 수 있는 방법이며, 배포 플랫폼이나 배포 구조는 프로젝트에 맞게 선택하면 됩니다. [Conda 환경 관리](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html)

## 통합할 때 확인할 것

1. 작은 기능 단위로 구현하고 화면과 API가 만나는 지점을 일찍 연결합니다.
2. 변경할 때마다 관련 테스트를 실행하고, 기대 결과와 실제 결과를 확인합니다.
3. 변경 설명에는 무엇을 바꿨는지, 어떻게 확인했는지, 남은 문제가 무엇인지 적습니다.
4. 배포 뒤에는 공개 URL에서 사용자처럼 사용해 오류·응답 속도·자료 정확성을 확인합니다.
