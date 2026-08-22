# 아키텍처

## 구성

### 백엔드

- FastAPI API 서버
- SQLAlchemy 2 기반 비동기 데이터 접근
- PostgreSQL 16 저장, Alembic migration
- SQLite는 legacy import와 빠른 단위 테스트에만 사용
- 수집, 분석, 요금 계산, 비행편 마커 API 제공

### 프론트엔드

- Next.js App Router
- React + TypeScript
- 모바일 / 데스크톱 반응형 대시보드

### 실행 환경

- Docker Compose 기준
- 개발 검증: WSL2 + Docker
- 운영: `digitie@192.168.1.14`에서만 Docker/PostgreSQL 실행
  - public web `14001`, public API `14000`, container backend `8000`
- live E2E 기준 origin: `https://pr.digitie.mywire.org`
- `192.168.1.13`은 cutover 전까지 read-only source/rollback 기준으로 유지

## 수집 흐름

1. `CollectionService`가 공공데이터 API를 호출한다.
2. 원본 응답은 `raw_api_responses`에 저장한다.
3. 파싱 결과는 `airports`, `parking_lots`, `parking_snapshots`에 반영한다.
4. 분석 API는 `parking_snapshots`를 기반으로 계산한다.

수집 소스는 기관별로 분리한다.

- `kac_parking`: 한국공항공사 `15056803`
- `kac_fee`: 한국공항공사 `15038474`
- `incheon_parking`: 인천국제공항공사 `15095047`
- `incheon_fee`: 인천국제공항공사 `15095053`

한국공항공사 주차 API가 한도 초과 상태이면 한국공항공사 주차/요금 소스는 건너뛰지만, 인천공항 전용 소스가 활성화되어 있으면 같은 수집 실행에서 계속 호출한다.

비행편 운항 정보는 주차장 스냅샷 수집 흐름과 분리한다. `/flights/status` 호출 시 공항 코드에 따라 한국공항공사 `15113771` ODCloud JSON API 또는 인천국제공항공사 `15112968` 도착/출발 엔드포인트를 조회하고, 응답은 짧게 캐시한 뒤 하루 흐름 오버레이 차트의 마커용으로만 반환한다.

## 스케줄러

- `ENABLE_SCHEDULER=true`면 백엔드 시작 직후 스케줄러가 생성된다.
- 스케줄러는 시작하자마자 1회 수집하고, 이후 `COLLECT_INTERVAL_SECONDS`마다 반복된다.
- 기본 개발 간격은 `300초`, 즉 5분이다.
- 14번 운영 간격은 `300초`, 즉 5분이다.

주의:

- 저장 중복 기준은 `parking_lot_id + observed_at + source`다.
- 따라서 수집 호출은 정상이어도 원본 `observed_at`이 변하지 않으면 `snapshot_count=0`이 나올 수 있다.
- 이 경우는 실패가 아니라 중복 방지 동작이다.

## 시각 처리와 수동 수집

- DB 저장 기준은 UTC다.
- API 응답 시각도 UTC ISO 8601 문자열로 내려준다.
- 프론트엔드는 이를 KST로 변환해 표시한다.

화면에서 구분해 봐야 하는 시각:

- `데이터 기준 시각`
  - 원본 데이터가 실제로 관측된 시각(`observed_at`)
- `수집기 마지막 동기화`
  - 전체 시스템 기준 가장 최근 저장 시각(`latest_snapshot_collected_at`)

수동 수집 규칙:

- 웹 UI의 `지금 수집` 버튼은 `POST /admin/collect`를 호출한다.
- 수동 수집 제한은 `manual_collect_min_interval_seconds`를 따른다.
- 운영에서는 마지막 적재 후 `MANUAL_COLLECT_MIN_INTERVAL_SECONDS`가 지나지 않았으면
  프론트와 백엔드 모두 수동 수집을 막는다.
- 따라서 프론트 우회 호출을 하더라도 백엔드에서 다시 차단된다.

관련 문서:

- [collection.md](collection.md)
- [current-state.md](</F:/dev/parking-radar/docs/current-state.md>)

## 주요 백엔드 모듈

- `backend/app/main.py`
  - FastAPI 앱과 라우트
- `backend/app/services/collection.py`
  - 수집 실행과 저장
- `backend/app/services/parsers.py`
  - 원본 응답 파싱
  - 인천 주차 응답의 층 포함 주차장명과 `datetm` 관측 시각 정규화
  - 인천 요금 설명(`charid`, `chardesc`)을 단기/장기/예약 요금 규칙으로 변환
- `backend/app/services/analytics.py`
  - 시계열, 요일 x 시간, 임계치 집계
- `backend/app/services/fee_calculator.py`
  - 주차 요금 계산
- `backend/app/services/flight_status.py`
  - 한국공항공사 `15113771` / 인천공항공사 `15112968` 비행편 출도착 조회, 정규화, 캐시

## 분석 API

- `GET /parking/current`
  - 현재 주차 현황
- `GET /parking/analytics/timeseries`
  - 최근 N일, M분 단위 시계열
- `GET /parking/analytics/by-hour`
  - 시간대별 단순 평균
- `GET /parking/analytics/by-weekday`
  - 요일별 단순 평균
- `GET /parking/analytics/by-weekday-hour`
  - 요일 x 시간 상세 평균
- `GET /parking/analytics/threshold-events`
  - 10대 / 50대 임계치 진입 / 회복
- `GET /parking/analytics/threshold-insights`
  - 요일별 대표 임계 진입 시각 / 날짜별 진입 히스토리
- `GET /dashboard/bootstrap`
  - 공항·현재 현황·수집기·공휴일 요약을 초기 화면용으로 묶어 반환
- `GET /dashboard/analytics`
  - 주차 분석 응답을 한 번에 반환. 비행편은 별도 `/flights/status`로 유지
- `GET /admin/backups`, `POST /admin/backups`
  - 내부망 전제의 PostgreSQL custom-format 백업 목록/생성
- `GET /admin/backups/{filename}`, `POST /admin/backups/restore`
  - 백업 다운로드와 확인 후 복원
- `GET /flights/status`
  - 선택 공항의 당일 출도착 비행편 마커

## 프론트 화면 구조

- 간결한 상단 헤더
- 공항 / 세부 주차장 / 새로고침 / 수동 수집 제어 영역
- 현재 주차 현황 표 또는 카드
- 최근 7일 시계열 차트
- 하루 흐름과 비행편 오버레이 차트
- 하루 흐름 오버레이 차트의 선택 공항 비행편 출도착 마커
- 요일 x 시간 평균 잔여 주차면 히트맵
- 요일별 시간대 상세 패턴 카드
- 요일별 임계 달성 시간 표
- 날짜별 임계 달성 시간 히스토리
- 스크롤 가능한 임계치 이벤트 목록
- 주차 요금 계산기

## 프론트 데이터 흐름

1. 초기 진입 시 `GET /dashboard/bootstrap` 호출
2. 마지막으로 본 `공항 / 세부 주차장`을 localStorage와 cookie에서 복원
3. 현재 현황이 먼저 렌더링된 뒤 `GET /dashboard/analytics`를 지연 호출
4. 비행편은 별도 요청으로 유지해 주차 화면을 막지 않는다.
5. 선택 공항 변경 시 설정을 1년 만료 cookie와 localStorage에 함께 저장한다.

기존 개별 분석 경로는 API 호환성을 위해 유지한다.

legacy 병렬 요청 경로:
   - `GET /parking/current`
   - `GET /parking/analytics/timeseries`
   - `GET /parking/analytics/by-weekday-hour`
   - `GET /parking/analytics/threshold-insights`
   - `GET /parking/analytics/threshold-events`
   - `GET /flights/status`
   - `GET /admin/collector-status`
4. 세부 주차장 선택 시 같은 공항 코드에 `parking_lot_id`를 붙여 재호출

## 운영용 API 주소 처리

- 프론트는 `NEXT_PUBLIC_API_BASE_URL`이 설정되어 있으면 그 값을 사용한다.
- 값이 비어 있으면 같은 origin의 `/api/backend`를 호출한다.
- Next.js 서버는 `/api/backend/*` 라우트에서 허용된 백엔드 경로만 `BACKEND_INTERNAL_URL`로 프록시한다.
- Docker/14번 기본값은 `BACKEND_INTERNAL_URL=http://backend:8000`이다.
- 이 방식은 LAN IP와 `https://pr.digitie.mywire.org/` 외부 도메인을 같은 빌드로 처리하고, 외부 HTTPS 페이지가 HTTP API 포트를 직접 호출하는 문제를 피하기 위한 기본값이다.

## 운영상 주의할 점

- PostgreSQL 런타임 데이터는 `parking_radar_postgres_data` named volume을 사용한다.
- 백업 파일은 `./backups:/app/backups` bind mount로 별도 보존하며 git에 넣지 않는다.
- 실데이터 모드로 컨테이너를 띄울 때는 같은 환경 변수를 유지한 상태로 재기동해야 한다.
- 프론트 이미지를 새로 빌드한 뒤 컨테이너를 재생성하지 않으면 이전 UI가 계속 보일 수 있다.
- `client_mode=sample`이면 수집기 버튼과 시각 표시는 정상이어도 실데이터는 아니다.
