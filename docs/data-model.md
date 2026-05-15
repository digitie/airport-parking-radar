# 데이터 모델

## 핵심 테이블

### `airports`

- 공항 기본 정보
- 예: `GMP`, `CJU`, `PUS`, `ICN`

### `parking_lots`

- 공항별 주차장 정보
- 터미널, 카테고리, 원본 소스 식별자 포함
- 가능한 한 공항의 실제 사용자용 구획 이름을 그대로 유지한다.
- 예:
  - 김해국제공항: `P1 여객주차장`, `P2 여객주차장`, `P3 여객(화물)주차장`
  - 김포국제공항: `국내선 제1주차장`, `국내선 제2주차장`, `국제선 지하주차장`, `국제선 주차빌딩`

### `parking_snapshots`

- 주차 현황 스냅샷 저장
- 주요 필드:
  - `airport_id`
  - `parking_lot_id`
  - `observed_at`
  - `collected_at`
  - `occupied_spaces`
  - `total_spaces`
  - `available_spaces`
  - `congestion_label`
  - `congestion_ratio`

### `parking_fee_rules`

- 공항별/주차장별 요금 규칙
- 소형/대형, 평일/휴일 요금 계산에 사용

### `collection_runs`

- 수집 실행 단위 기록

### `raw_api_responses`

- 외부 API 원본 응답 기록
- 파싱 오류 추적과 운영 디버깅에 사용

## 분석 데이터 처리 원칙

- 시계열 차트용 집계 결과는 현재 별도 테이블에 저장하지 않는다.
- 최근 7일 30분 시계열은 `parking_snapshots`에서 조회 시점에 계산한다.
- 같은 30분 구간 안에서 주차장별 최신 상태를 사용해 공항 합산 값을 만든다.

## Query indexes

Startup creates missing SQLite indexes with `CREATE INDEX IF NOT EXISTS` so existing ODROID databases are tuned without a manual migration.

- `parking_snapshots (airport_id, parking_lot_id, observed_at)` supports airport-scoped history and analytics scans.
- `parking_snapshots (airport_id, parking_lot_id, observed_at DESC, id DESC)` supports latest snapshot ranking for `/parking/current`.
- `parking_snapshots (collected_at)` supports collector status metadata.
- `parking_snapshots (collection_run_id)` and `raw_api_responses (collection_run_id)` support recent collector run summaries.
