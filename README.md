# parking-radar

`parking-radar`는 국내 공항 주차장의 현재 잔여 주차면과 과거 패턴을 빠르게 확인하기 위한 반응형 웹앱이다.  
공항 전체 기준과 세부 주차장 기준을 같은 화면에서 오가며, 여행 출발 전에 “지금 어디가 얼마나 남았는지”와 “보통 언제 빠르게 줄어드는지”를 함께 볼 수 있게 만드는 것이 목표다.

## 핵심 기능

- 공항별 현재 주차 현황 조회
- 세부 주차장 단위 조회
  - 예: 김해 `P1 / P2 / P3`
- 최근 7일 30분 단위 시계열
- 시계열 차트 hover / touch 툴팁
- 시계열 X축 6시간 단위 라벨
- 시계열 보간 없는 계단형 표시
- 시계열 기본 커서가 최신 값에 고정되고 오른쪽 끝부터 바로 표시
- 요일 x 시간 기준 평균 잔여 주차면 히트맵
- 평균으로 가장 빠듯한 시간 / 가장 여유 있는 시간 요약
- 요일별 시간대 상세 패턴 카드
- 요일별 임계 달성 시간 / 날짜별 임계 달성 시간 히스토리
- 10대 / 50대 임계치 진입 및 회복 이벤트
- 마지막으로 본 공항 / 세부 주차장 자동 복원
- 주차 요금 계산
  - 인천공항은 현재 가격 정보 미지원

## 기술 스택

- 백엔드: FastAPI, SQLAlchemy 2, SQLite
- 프론트엔드: Next.js App Router, React, TypeScript
- 테스트: pytest, Vitest
- 실행: Docker Compose
- 개발 환경: WSL2 + Docker
- 운영 목표 환경: Ubuntu 24.04 on Odroid M1S

## 데이터 소스

- 한국공항공사 공항 주차장 정보  
  [https://www.data.go.kr/data/15056803/openapi.do](https://www.data.go.kr/data/15056803/openapi.do)
- 한국공항공사 전국공항 주차장 혼잡도  
  [https://www.data.go.kr/data/15063437/openapi.do](https://www.data.go.kr/data/15063437/openapi.do)
- 한국공항공사 전국공항 주차요금  
  [https://www.data.go.kr/data/15038474/openapi.do](https://www.data.go.kr/data/15038474/openapi.do)
- 인천국제공항공사 주차 정보  
  [https://www.data.go.kr/data/15095047/openapi.do](https://www.data.go.kr/data/15095047/openapi.do)

현재 실시간 기본 수집원은 `15056803`이며, 인천과 요금 API는 별도 플래그로 분리되어 있다.

## 빠른 시작

```bash
docker compose build
docker compose up -d
```

- 프론트엔드: [http://localhost:3000](http://localhost:3000)
- 백엔드 문서: [http://localhost:8000/docs](http://localhost:8000/docs)

## ODROID M1S 배포

배포 기준 정보는 루트의 [.env.odroid](</C:/Users/digit/OneDrive/문서/New project/.env.odroid>)에 저장한다.

- 대상 IP: `192.168.1.204`
- 사용자: `digitie`
- 앱 디렉터리: `/home/digitie/apps/parking-radar`

배포 명령:

```powershell
.\scripts\deploy-odroid.ps1
```

이 스크립트는 다음을 자동으로 수행한다.

1. 현재 프로젝트를 압축
2. ODROID로 업로드
3. 원격에서 `docker compose build`
4. 원격에서 `docker compose up -d`
5. 웹 / API 헬스 체크

비밀번호는 저장하지 않으며, 실행 시점에만 입력한다.

배포 후 상태 확인:

```powershell
.\scripts\odroid-status.ps1
```

## 실데이터 수집

기본 개발 모드는 샘플 데이터 기준이다.  
실데이터 수집으로 전환하려면 `.env` 또는 실행 환경 변수에 아래 값을 넣는다.

```env
ENABLE_SCHEDULER=true
SEED_SAMPLE_DATA=false
USE_SAMPLE_CLIENT_WHEN_NO_KEY=false
COLLECT_INTERVAL_SECONDS=1200
MANUAL_COLLECT_MIN_INTERVAL_SECONDS=1200
UPSTREAM_RATE_LIMIT_BACKOFF_SECONDS=3600
DATA_GO_KR_SERVICE_KEY=...
```

- `client_mode=live`로 운영할 때는 `SEED_SAMPLE_DATA=false`를 유지한다.
- 샘플 시계열은 `client_mode=sample`에서만 시드한다.
- `15056803` 카탈로그에는 개발계정 `5,000` 트래픽이 보이지만, ODROID 실측에서는 `2026-04-28`에 100회 성공 후 101번째부터 `LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.`가 발생했다.
- 그래서 ODROID live 프로파일은 10분이 아니라 20분(`1200초`) 주기와 20분 수동 수집 제한으로 운영한다.
- ODROID live는 `CJJ,CJU,GMP,HIN,KUV,KWJ,MWX,PUS,RSU,TAE,USN,WJU,YNY`를 같은 20분 주기 응답에서 함께 처리한다.
- 같은 인증키를 쓰는 live 수집기는 동시에 하나만 유지한다.
- 빠른 검증용 live 스택을 잠깐 띄웠다면 검증 직후 반드시 내려야 한다.
- 수집기가 한도 초과를 감지하면 `UPSTREAM_RATE_LIMIT_BACKOFF_SECONDS` 동안 API 호출을 잠시 건너뛰고, `collector-status`에 `upstream_rate_limited=true`와 `upstream_rate_limited_until`을 남긴다.
- `15056803` 공식 문서상 개발계정 트래픽은 `5,000/일`이지만, 실제 운영에서는 더 이르게 `LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.`가 발생할 수 있으므로 하루 단위 정지 대신 짧은 backoff 후 재시도한다.

동작 방식:

1. 백엔드 기동 직후 스케줄러가 1회 즉시 수집한다.
2. 이후 `COLLECT_INTERVAL_SECONDS` 기준으로 반복 수집한다.
3. 기본 실시간 소스는 `kac_parking`이다.
4. 동일한 `parking_lot_id + observed_at + source` 조합은 중복 저장하지 않는다.

중요:

- `snapshot_count=0`은 항상 실패가 아니다.
- 공공데이터 원본의 `observed_at`이 이전 수집과 같으면 중복 방지로 저장 건수가 0이 될 수 있다.
- 이 경우에도 `raw_response_count=1`, `status=success`이면 수집 호출 자체는 정상이다.

현재 데이터 즉시 갱신:

```bash
curl -X POST http://localhost:8000/admin/collect
```

상태 확인:

```bash
curl http://localhost:8000/admin/collector-status
```

확인 포인트:

- `scheduler_enabled=true`
- `client_mode=live`
- `enabled_sources=["kac_parking"]`
- `data_go_kr_service_key_configured=true`
- `upstream_rate_limited=false`

## 분석 화면 기준

- `공항 선택` 변경 시 현재 현황과 모든 분석 패널이 해당 공항 기준으로 바뀐다.
- `세부 주차장` 선택 시 아래 패널이 모두 같은 주차장 기준으로 바뀐다.
- 마지막으로 선택한 `공항 / 세부 주차장`은 브라우저에 저장되어 다음 접속 시 자동 복원된다.
  - 현재 잔여 주차면
  - 최근 7일 시계열
  - 요일 x 시간 평균 잔여 주차면
  - 요일별 시간대 상세 패턴
  - 요일별 임계 달성 시간
  - 날짜별 임계 달성 시간 히스토리
  - 임계치 이벤트
- `전체 주차장`이면 공항 내 활성 주차장을 합산해서 보여준다.
- 시계열의 마지막 값은 항상 화면 상단 `지금 주차 여유`와 같은 기준으로 맞춘다.

## 테스트

백엔드:

```bash
docker compose run --rm --no-deps backend pytest -q
```

프론트엔드:

```bash
docker compose run --rm --no-deps frontend npm run test -- --run
```

반영 시 확인해야 할 항목:

- Docker 컨테이너 내부 테스트 통과
- 모바일 / 데스크톱 반응형 화면
- 시계열 툴팁 동작
- 시계열 계단형 라인과 X축 라벨 레이아웃
- 요일 x 시간 분석 패널 렌더링
- `GET /admin/collector-status`로 수집 모드 확인

## 주요 API

- `GET /airports`
- `GET /parking/current`
- `GET /parking/history`
- `GET /parking/analytics/timeseries`
- `GET /parking/analytics/by-hour`
- `GET /parking/analytics/by-weekday`
- `GET /parking/analytics/by-weekday-hour`
- `GET /parking/analytics/threshold-events`
- `GET /parking/analytics/threshold-insights`
- `POST /fees/calculate`
- `POST /admin/collect`
- `GET /admin/collector-status`

## 문서

- [docs/current-state.md](</C:/Users/digit/OneDrive/문서/New project/docs/current-state.md>)
- [docs/data-sources.md](</C:/Users/digit/OneDrive/문서/New project/docs/data-sources.md>)
- [AGENTS.md](</C:/Users/digit/OneDrive/문서/New project/AGENTS.md>)
- [deploy/odroid/README.md](</C:/Users/digit/OneDrive/문서/New project/deploy/odroid/README.md>)
- [docs/architecture.md](</C:/Users/digit/OneDrive/문서/New project/docs/architecture.md>)
- [docs/analytics.md](</C:/Users/digit/OneDrive/문서/New project/docs/analytics.md>)
- [docs/testing.md](</C:/Users/digit/OneDrive/문서/New project/docs/testing.md>)
- [docs/deployment.md](</C:/Users/digit/OneDrive/문서/New project/docs/deployment.md>)
- [docs/time-and-collector.md](</C:/Users/digit/OneDrive/문서/New project/docs/time-and-collector.md>)
- [docs/troubleshooting.md](</C:/Users/digit/OneDrive/문서/New project/docs/troubleshooting.md>)
- [docs/remote-command-safety.md](</C:/Users/digit/OneDrive/문서/New project/docs/remote-command-safety.md>)

## WSL 테스트 기준

- 모든 테스트와 기본 검증 기준 환경은 `WSL2 + Docker`이다.
- `docker compose run --rm --no-deps ...` 형태의 테스트 명령은 `WSL2` 셸에서 실행하는 것을 기준으로 유지한다.
- Windows PowerShell은 배포 스크립트와 상태 확인 용도로 사용하되, 테스트 합격 기준은 `WSL2` 결과를 따른다.
