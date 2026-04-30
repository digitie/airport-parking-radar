# 배포 및 실행

## 기본 개발 실행

```bash
docker compose build
docker compose up -d
```

접속:

- 프론트엔드: [http://localhost:3000](http://localhost:3000)
- 백엔드 문서: [http://localhost:8000/docs](http://localhost:8000/docs)

## 실데이터 실행

`.env` 또는 셸 환경 변수에 다음 값을 넣는다.

```env
ENABLE_SCHEDULER=true
SEED_SAMPLE_DATA=false
USE_SAMPLE_CLIENT_WHEN_NO_KEY=false
COLLECT_INTERVAL_SECONDS=1200
MANUAL_COLLECT_MIN_INTERVAL_SECONDS=1200
UPSTREAM_RATE_LIMIT_BACKOFF_SECONDS=3600
DATA_GO_KR_SERVICE_KEY=...
```

설명:

- `ENABLE_SCHEDULER=true`
  - 20분 주기 자동 수집
- `SEED_SAMPLE_DATA=false`
  - live 운영에서는 샘플 시계열을 다시 넣지 않도록 유지
- `USE_SAMPLE_CLIENT_WHEN_NO_KEY=false`
  - 인증키가 없을 때 샘플로 조용히 떨어지지 않도록 강제
- `COLLECT_INTERVAL_SECONDS=1200`
  - 20분
- `MANUAL_COLLECT_MIN_INTERVAL_SECONDS=1200`
  - 수동 수집도 20분 제한

- `client_mode=live` 상태에서는 `SEED_SAMPLE_DATA=false`를 기본값으로 사용한다.
- 샘플 시드가 필요하면 `client_mode=sample`에서만 켠다.
- `15056803` 카탈로그의 개발계정 트래픽 표기와 별개로, ODROID 실측에서는 100회 성공 후 101번째부터 제한 에러가 재현됐다.
- 그래서 ODROID live와 local live 검증 스택은 10분이 아니라 20분 주기를 기본값으로 둔다.
- 같은 인증키를 쓰는 live 수집기는 동시에 하나만 유지한다.
- live 수집기가 한도 초과를 감지하면 `UPSTREAM_RATE_LIMIT_BACKOFF_SECONDS` 동안 API 호출을 건너뛴다.
- `15056803` 공식 문서상 개발계정 트래픽은 `5,000/일`이지만, 실제 운영에서는 더 이르게 `LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.`가 발생할 수 있다.
- 그래서 ODROID live는 하루 단위로 멈추지 않고, 짧은 backoff 뒤 다시 시도해 회복 시점을 놓치지 않도록 한다.
- ODROID live 저장 대상 공항은 `CJJ,CJU,GMP,HIN,KUV,KWJ,MWX,PUS,RSU,TAE,USN,WJU,YNY`다.
- ODROID에는 `parking-radar` 외 별도 수집기(`airport-parking-monitor`)를 동시에 띄우지 않는다.
- 특히 `parking-collector.timer`가 살아 있으면 10분마다 `GMP,PUS,CJU,TAE`를 추가 호출해 같은 인증키를 소모한다.

## ODROID M1S 배포 파일

- 운영용 compose: [docker-compose.odroid.yml](</C:/Users/digit/OneDrive/문서/New project/docker-compose.odroid.yml>)
- 운영용 환경 파일: [/.env.odroid](</C:/Users/digit/OneDrive/문서/New project/.env.odroid>)
- 로컬 배포 스크립트: [scripts/deploy-odroid.ps1](</C:/Users/digit/OneDrive/문서/New project/scripts/deploy-odroid.ps1>)
- 상태 확인 스크립트: [scripts/odroid-status.ps1](</C:/Users/digit/OneDrive/문서/New project/scripts/odroid-status.ps1>)
- 원격 실행 스크립트: [deploy/odroid/remote-deploy.sh](</C:/Users/digit/OneDrive/문서/New project/deploy/odroid/remote-deploy.sh>)

기본 저장 정보:

- `ODROID_HOST=192.168.1.204`
- `ODROID_USER=digitie`
- `ODROID_APP_DIR=/home/digitie/apps/parking-radar`
- `PUBLIC_WEB_PORT=3000`
- `PUBLIC_API_PORT=18000`

포트 메모:

- 현재 ODROID에서는 `8000` 포트를 Portainer가 사용 중이다.
- 따라서 `parking-radar` 백엔드는 `18000` 포트를 기본값으로 사용한다.
- 프론트는 같은 호스트의 `:18000`을 API 대상으로 계산하도록 맞춘다.

비밀번호는 저장하지 않으며, 배포 시에만 입력한다.

## ODROID 배포 절차

```powershell
.\scripts\deploy-odroid.ps1
```

스크립트 흐름:

1. 프로젝트를 tar.gz로 압축
2. 원격 앱 디렉터리로 업로드
3. 원격에서 압축 해제
4. `docker-compose.odroid.yml` 기준 빌드 및 재기동
5. 로컬에서 웹 / API 헬스 체크

호환성 메모:

- 원격 서버는 `docker compose` 플러그인만 있는 경우도 있고, `docker-compose` 바이너리만 있는 경우도 있다.
- 배포 스크립트는 두 방식을 모두 지원해야 한다.
- `.env.odroid`는 원격 셸에서 먼저 로드하므로 `--env-file` 지원 여부에 배포가 의존하지 않도록 유지한다.
- Compose 구현에 따라 `sudo` 실행 시 셸 환경 변수가 사라질 수 있으므로, 원격 스크립트는 `.env.odroid`를 `.env`로도 연결해 Compose가 직접 읽게 한다.
- `docker-compose 1.29` 계열에서는 컨테이너 재생성 중 `ContainerConfig` 오류가 날 수 있다.
- 이 경우 `up` 전에 `down --remove-orphans`를 거쳐 새로 올리는 방식이 더 안정적이다.
- 백엔드 healthcheck가 안정되기 전에는 프론트가 `depends_on`에서 실패할 수 있으므로, 원격 배포는 `backend -> health 확인 -> frontend` 순서로 올린다.

## 프론트 API 주소 결정 방식

- `NEXT_PUBLIC_API_BASE_URL`이 비어 있으면
- 프론트는 브라우저가 접속한 현재 호스트를 기준으로
- `http://현재호스트:8000`을 기본 API 주소로 사용한다.

이 덕분에 ODROID의 LAN IP로 접속할 때 프론트가 사용자 PC의 `localhost:8000`로 잘못 붙는 문제를 피할 수 있다.

## 빠른 라이브 검증용 스택

별도 포트에서 짧은 주기로 수집을 시험하고 싶다면 `docker-compose.live.yml`을 사용한다.

예:

```bash
BACKEND_LIVE_PORT=8010 \
ENABLE_SCHEDULER=true \
SEED_SAMPLE_DATA=false \
USE_SAMPLE_CLIENT_WHEN_NO_KEY=false \
COLLECT_INTERVAL_SECONDS=15 \
DATA_GO_KR_SERVICE_KEY=... \
docker compose -f docker-compose.live.yml --project-name parking-radar-live up -d
```

이 스택은 빠른 검증이 끝나면 반드시 바로 내린다.

종료:

```bash
docker compose -f docker-compose.live.yml --project-name parking-radar-live down
```

주의:

- `COLLECT_INTERVAL_SECONDS=15` 같은 짧은 주기는 검증용으로만 잠깐 사용한다.
- 검증용 스택을 켠 채 방치하면 ODROID와 같은 인증키 쿼터를 같이 소모한다.

## 수집 상태 확인

```bash
curl http://localhost:8000/admin/collector-status
```

중요 필드:

- `scheduler_enabled`
- `collect_interval_seconds`
- `client_mode`
- `enabled_sources`
- `upstream_rate_limited`
- `upstream_rate_limited_until`
- `last_run`
- `recent_runs`

운영 판별에 특히 중요한 항목:

- `client_mode=live`인지
- `scheduler_enabled=true`인지
- `data_go_kr_service_key_configured=true`인지
- `upstream_rate_limited=false`인지

## 현재 데이터 즉시 갱신

```bash
curl -X POST http://localhost:8000/admin/collect
```

다만 원본 관측 시각이 직전 수집과 같으면 `snapshot_count=0`이 나올 수 있다.  
이 경우는 실패가 아니라 중복 저장 방지다.

웹 UI에서도 같은 수동 수집을 실행할 수 있다.

주의:

- 마지막 적재 후 제한 시간이 지나지 않았으면 UI와 백엔드 모두 실행을 막는다.
- 외부 API 요청 한도에 걸렸으면 백엔드는 `429`와 함께 다음 재시도 가능 시각을 반환한다.
- 배포 후에는 버튼 노출 여부와 에러 메시지 표기를 한 번 확인하는 것이 좋다.

## 운영 권장 사항

- SQLite 런타임 파일은 Docker named volume에 둔다.
- 실데이터 환경 변수는 `.env`로 고정해 두고 재기동 시 일관되게 사용한다.
- 프론트 빌드 후에는 `docker compose up -d frontend`로 컨테이너를 재생성한다.

관련 문서:

- [current-state.md](</C:/Users/digit/OneDrive/문서/New project/docs/current-state.md>)
- [time-and-collector.md](</C:/Users/digit/OneDrive/문서/New project/docs/time-and-collector.md>)

## WSL 테스트 기준

- 로컬 개발과 테스트의 기준 환경은 `WSL2 + Docker`이다.
- Windows PowerShell은 `deploy-odroid.ps1` 같은 배포 스크립트 실행과 상태 확인에 사용한다.
- 테스트 합격 기준은 `WSL2`에서 실행한 컨테이너 테스트 결과를 따른다.
