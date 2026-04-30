# 아키텍처

## 구성

### 백엔드

- FastAPI API 서버
- SQLAlchemy 2 기반 비동기 데이터 접근
- SQLite 저장
- 수집, 분석, 요금 계산 API 제공

### 프론트엔드

- Next.js App Router
- React + TypeScript
- 모바일 / 데스크톱 반응형 대시보드

### 실행 환경

- Docker Compose 기준
- 개발 환경: WSL2 + Docker
- 운영 환경 목표: Ubuntu 24.04 on Odroid M1S

## 수집 흐름

1. `CollectionService`가 공공데이터 API를 호출한다.
2. 원본 응답은 `raw_api_responses`에 저장한다.
3. 파싱 결과는 `airports`, `parking_lots`, `parking_snapshots`에 반영한다.
4. 분석 API는 `parking_snapshots`를 기반으로 계산한다.

## 스케줄러

- `ENABLE_SCHEDULER=true`면 백엔드 시작 직후 스케줄러가 생성된다.
- 스케줄러는 시작하자마자 1회 수집하고, 이후 `COLLECT_INTERVAL_SECONDS`마다 반복된다.
- 기본 개발 간격은 `300초`, 즉 5분이다.
- ODROID live 운영 간격은 현재 `600초`, 즉 10분이다.

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
- ODROID live에서는 마지막 적재 후 10분이 지나지 않았으면 프론트와 백엔드 모두 실행을 막는다.
- 따라서 프론트 우회 호출을 하더라도 백엔드에서 다시 차단된다.

관련 문서:

- [time-and-collector.md](</C:/Users/digit/OneDrive/문서/New project/docs/time-and-collector.md>)
- [current-state.md](</C:/Users/digit/OneDrive/문서/New project/docs/current-state.md>)

## 주요 백엔드 모듈

- `backend/app/main.py`
  - FastAPI 앱과 라우트
- `backend/app/services/collection.py`
  - 수집 실행과 저장
- `backend/app/services/parsers.py`
  - 원본 응답 파싱
- `backend/app/services/analytics.py`
  - 시계열, 요일 x 시간, 임계치 집계
- `backend/app/services/fee_calculator.py`
  - 주차 요금 계산

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

## 프론트 화면 구조

- 간결한 상단 헤더
- 공항 / 세부 주차장 / 새로고침 / 수동 수집 제어 영역
- 현재 주차 현황 표 또는 카드
- 최근 7일 시계열 차트
- 요일 x 시간 평균 잔여 주차면 히트맵
- 요일별 시간대 상세 패턴 카드
- 요일별 임계 달성 시간 표
- 날짜별 임계 달성 시간 히스토리
- 스크롤 가능한 임계치 이벤트 목록
- 주차 요금 계산기

## 프론트 데이터 흐름

1. 초기 진입 시 `GET /airports` 호출
2. 마지막으로 본 `공항 / 세부 주차장`을 localStorage에서 복원
3. 선택 공항 기준으로 다음 API를 병렬 호출
   - `GET /parking/current`
   - `GET /parking/analytics/timeseries`
   - `GET /parking/analytics/by-weekday-hour`
   - `GET /parking/analytics/threshold-insights`
   - `GET /parking/analytics/threshold-events`
   - `GET /admin/collector-status`
4. 세부 주차장 선택 시 같은 공항 코드에 `parking_lot_id`를 붙여 재호출

## 운영용 API 주소 처리

- 프론트는 `NEXT_PUBLIC_API_BASE_URL`이 설정되어 있으면 그 값을 사용한다.
- 값이 비어 있으면 브라우저가 접속한 현재 호스트를 기준으로 `:8000` 포트를 붙여 API 주소를 계산한다.
- 이 방식은 LAN IP로 접속하는 ODROID 배포에서 `localhost` 오동작을 피하기 위한 기본값이다.

## 운영상 주의할 점

- Docker 개발 환경에서는 SQLite 파일을 OneDrive bind mount에 직접 두지 않는다.
- 런타임 DB는 Docker named volume을 사용한다.
- 실데이터 모드로 컨테이너를 띄울 때는 같은 환경 변수를 유지한 상태로 재기동해야 한다.
- 프론트 이미지를 새로 빌드한 뒤 컨테이너를 재생성하지 않으면 이전 UI가 계속 보일 수 있다.
- `client_mode=sample`이면 수집기 버튼과 시각 표시는 정상이어도 실데이터는 아니다.
