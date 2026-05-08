# 테스트 전략

## 목표

- 백엔드와 프론트엔드 변경을 함께 검증한다.
- Windows 로컬 테스트는 지양하고, WSL2를 기준으로 검증한다.
- 1차 테스트는 WSL2 셸에서 로컬 런타임으로 실행한다.
- 2차 테스트는 WSL2 Docker 컨테이너 안에서 실제로 실행한다.
- 반응형 UI와 실데이터 수집 흐름을 함께 확인한다.

## 기본 검증 순서

변경 후 검증 순서는 아래를 기본값으로 한다.

1. `WSL2` 셸에서 1차 테스트
2. `WSL2 + Docker`에서 2차 테스트
3. ODROID 배포
4. ODROID 스모크 체크

Windows PowerShell에서 실행한 테스트는 참고용으로만 본다. 배포 스크립트 실행, 압축, SSH 상태 확인처럼 Windows 도구가 필요한 작업에는 PowerShell을 사용할 수 있지만, 테스트 통과 기준으로 삼지 않는다.

## WSL 1차 테스트

백엔드:

```bash
python -m pytest backend/tests -q
```

프론트엔드:

```bash
cd frontend
npm run test -- --run
npm run build
```

1차 테스트는 빠른 피드백을 위한 단계다. 여기서 실패하면 Docker 테스트나 ODROID 배포로 넘어가지 않는다.

## 백엔드 테스트

주요 범위:

- 파서
- 수집 서비스
- 분석 로직
- 요금 계산
- FastAPI API

주요 확인 항목:

- `timeseries` 7일 x 30분 버킷 계산
- `threshold-events` 임계치 진입 / 회복 계산
- `by-weekday-hour` 요일 x 시간 상세 집계
- `admin/collector-status` 응답
- `sample` / `live` 클라이언트 선택 규칙
- 인천 주차 응답의 실시간 `datetm` 파싱
- 인천 요금 API 응답의 단기/장기/예약 규칙 변환
- 한국공항공사 한도 초과 상태에서도 인천 주차/요금 수집을 계속하는지 확인
- `/flights/status` 샘플 응답과 접근 오류 정규화
- 한국공항공사 `15113771` ODCloud 비행편 응답 정규화
- 인천공항 도착/출발 비행편 응답 정규화

2차 Docker 실행:

```bash
docker compose run --rm --no-deps backend pytest -q
```

## 프론트엔드 테스트

주요 범위:

- API 클라이언트 URL 생성
- 대시보드 렌더링
- 모바일 / 데스크톱 분기
- 마지막으로 본 공항 / 주차장 복원
- 시계열 툴팁
- 시계열 계단형 라인과 X축 라벨 레이아웃
- 비행편 마커와 편명/출도착 정보 표시
- 요일 x 시간 히트맵
- 요일별 시간대 상세 카드
- 요일별 임계 달성 시간 / 날짜별 임계 달성 시간
- 요금 계산기

2차 Docker 실행:

```bash
docker compose run --rm --no-deps frontend npm run test -- --run
```

## 반응형 검증

데스크톱:

- 현재 주차 현황 표 렌더링
- 시계열 차트 렌더링
- 요일 x 시간 히트맵 렌더링
- 요일별 시간대 상세 카드 렌더링
- 임계 달성 시간 표 렌더링

모바일:

- 현재 주차 현황 카드 렌더링
- 패널이 세로 흐름으로 배치되는지 확인
- 차트 툴팁이 터치로 동작하는지 확인

## 시각과 수동 수집 검증

API 확인:

- `GET /parking/current`
- `GET /admin/collector-status`

확인 포인트:

- `observed_at`이 UTC ISO 8601인지 확인
- `collected_at`이 UTC ISO 8601인지 확인
- `latest_snapshot_collected_at`이 UTC ISO 8601인지 확인
- 브라우저에서는 같은 값이 KST로 보이는지 확인

UI 확인:

- `데이터 기준 시각`
- `수집기 마지막 동기화`
- `지금 수집` 버튼

동작 확인:

1. `지금 수집` 1회 실행
2. 성공 메시지 확인
3. 즉시 다시 실행
4. 수동 수집 제한 에러 메시지 확인

## 실데이터 수집 검증

권장 절차:

1. 실데이터용 백엔드를 별도 포트로 띄운다.
2. `ENABLE_SCHEDULER=true`
3. `USE_SAMPLE_CLIENT_WHEN_NO_KEY=false`
4. `DATA_GO_KR_SERVICE_KEY` 설정
5. 빠른 검증이 필요하면 임시로 `COLLECT_INTERVAL_SECONDS=15`로 줄인다.
6. `GET /admin/collector-status`에서 최근 실행 이력을 본다.
7. 검증이 끝나면 live 검증 스택을 즉시 내린다.

정상 신호:

- `scheduler_enabled=true`
- `client_mode=live`
- `status=success`
- `raw_response_count=1`
- 인천 수집을 검증할 때는 `enabled_sources`에 `incheon_parking` 또는 `incheon_fee`가 포함되는지 확인
- 인천공항까지 운영 대상이면 `AIRPORT_CODES_CSV`에 `ICN`이 포함되는지 확인

추가 해석:

- 첫 실행에서 `snapshot_count>0`
- 이후 실행에서 `snapshot_count=0`일 수 있음
  - 원본 `observed_at`이 그대로면 중복 저장을 건너뛰기 때문
- `upstream_rate_limited=true`이면 이미 외부 API 쿼터를 소진한 상태다.
- 단, 한국공항공사 `15056803`의 한도 초과는 인천공항 전용 `15095047`, `15095053` 수집을 막지 않아야 한다.
- 같은 인증키를 쓰는 live 수집기는 한 번에 하나만 유지한다.

종료 명령:

```bash
docker compose -f docker-compose.live.yml --project-name parking-radar-live down
```

## 브라우저 검증

in-app browser 또는 브라우저에서 다음을 확인한다.

- [http://localhost:3000](http://localhost:3000) 접속 가능
- [http://localhost:8000/docs](http://localhost:8000/docs) 접속 가능
- KST 기준 시각 표시
- 시계열 툴팁 표시
- 시계열 X축 라벨이 겹치지 않고 6시간 단위로 표시되는지 확인
- 비행편 마커가 X축 시간 위치에 표시되고, 편명과 출발/도착 공항 정보가 보이는지 확인
- 인천공항을 선택했을 때 `15112968` 기준 도착/출발편이 같은 차트에 표시되는지 확인
- 6시간 단위 X축 라벨 표시
- 요일 x 시간 히트맵 표시
- 요일별 시간대 상세 카드 표시
- 요일별 임계 달성 시간 / 날짜별 임계 달성 시간 표시
- `지금 수집` 성공 / 쿨다운 메시지 표시
- 브라우저 콘솔 `error` / `warn` 없음

## ODROID 배포 스모크 체크

배포 후에는 최소한 아래를 확인한다.

- `http://192.168.1.13:3000` 응답
- `http://192.168.1.13:18000/health` 응답
- `http://192.168.1.13:18000/admin/collector-status`에서
  - `client_mode=live`
  - `scheduler_enabled=true`
  - `upstream_rate_limited=false`
- 웹 UI에서
  - 현재 시각 표시가 KST 기준인지 확인
  - `지금 수집` 버튼이 노출되는지 확인

관련 문서:

- [current-state.md](</F:/dev/parking-radar/docs/current-state.md>)
- [time-and-collector.md](</F:/dev/parking-radar/docs/time-and-collector.md>)

## Docker 프론트 테스트 메모

- Docker 안의 `Vitest`는 `testTimeout=15000` 기준으로 실행한다.
- 반응형 대시보드와 폼 상호작용 테스트가 컨테이너 환경에서 느려질 수 있어 기본 5초 제한 대신 여유를 둔다.

## WSL 테스트 기준

- 모든 테스트의 기준 환경은 `WSL2`이다.
- Windows 로컬 테스트는 지양한다.
- 1차 기준은 `WSL2` 셸에서 실행한 로컬 테스트 결과다.
- 2차 최종 기준은 `WSL2` 안에서 실행한 Docker 테스트 결과다.
- ODROID 배포는 1차/2차 테스트가 모두 통과한 뒤 진행한다.
- Windows PowerShell은 배포, 압축, 원격 실행 보조 용도로 사용할 수 있지만 테스트 기준 환경으로 보지 않는다.
