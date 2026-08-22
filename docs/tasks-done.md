# tasks-done.md — 완료 작업 아카이브

완료한 task의 식별자, 핵심 변경, 검증 명령과 시각을 역시간순으로 보관한다.

## 2026-08-22

### `T-023` — 192.168.1.14 배포·데이터 이전·운영 검증

- `192.168.1.14`에만 Docker Compose/PostgreSQL/backend/frontend를 배포했다.
- 포트는 API `14000`, web `14001`이며, PostgreSQL은 loopback `5432`로 제한했다. configured
  collection interval은 `300s`, effective scheduler tick은 `240s`(`60s` safety buffer)다.
- HTTP migration 결과: `imported_snapshots=36878`, `source_lots=53`, `failures=0`.
- delta import 후 현재 PostgreSQL `parking_snapshots=38946`, distinct snapshot lots `44`,
  parking lots `53`, legacy IDs `53`, duplicate legacy IDs `0`이며 Alembic head는
  `0003_legacy_source_identity`다.
- 7회 × 50초(총 300초) strict cutover observation: 각 `failure_count=0`, 최종 `failed_samples=0`.
- 13번에는 Docker 명령을 실행하지 않고 HTTP GET만 수행했다.

### `T-022` — exact live E2E·운영 smoke

- `E2E_BASE_URL=https://pr.digitie.mywire.org npm run test:e2e`: 5 passed.
- 14번 직접 origin `http://192.168.1.14:14001`에서도 5 passed.
- `https://pr-api.digitie.mywire.org/health`, web same-origin `/api/backend/health`, 14번 API
  health가 모두 `{"status":"ok","database":"ready","seeded":true}`를 반환했다.
- 외부 live E2E는 최종 수정 후 `5 passed (9.4s)`, 14번 직접 origin은 `5 passed (5.9s)`였다.
- 320/375/414/768px overflow와 backup/restore controls를 브라우저에서 확인했다.

### `T-021` — 적대적 전문 리뷰 에이전트 2명

- James(frontend/live UI)와 Popper(backend/PostgreSQL/ops)를 각각 독립 read-only reviewer로
  운용했다.
- Alembic lineage, source lag verifier, proxy timeout, backup pre-restore receipt, accessibility,
  stable legacy lot identity, explicit reconciliation mapping, PostgreSQL tests, 13번 Docker 금지
  guard 등 P0/P1 지적을 반영했다.
- 인증 없는 admin backup/restore는 사용자의 명시 요구라 유지하되, UI·runbook에 외부 공개 금지와
  gateway/private ACL 필요성을 명시했다.

### `T-020` — 단계별 원격 커밋·Draft PR·CI

- 원격 branch: `codex/parking-radar-postgres-migration`.
- Draft PR: [#2](https://github.com/digitie/airport-parking-radar/pull/2).
- 주요 원격 커밋: `2b33a26`, `6b7ac89`, `2a88c09`, `c5e5b03`, `8d8a45a`, `f367db9`, `4980485`.
- workflow run `32547913806`의 backend, frontend, live-e2e job이 모두 통과했다.

### `T-014` — 인증 없는 내부망용 백업/복원 UI와 API

- PostgreSQL `.dump` 생성·목록·다운로드·복원 API와 responsive UI를 구현했다.
- 복원 전 자동 backup을 응답에 포함하고, UI에 destructive operation 경고를 제공한다.
- 별도 app auth는 추가하지 않고 gateway/private network 보호를 문서화했다.

### `T-013` — 의존 라이브러리 최신화

- Python/Node lockfile과 Docker runtime을 갱신하고 CI에서 locked install, PostgreSQL Alembic,
  frontend build를 통과시켰다.

### `T-012` — 쿠키 기반 설정 기억

- 공항/주차장 선택을 `parking-radar-selection` cookie와 localStorage fallback으로 기억하고
  브라우저 테스트로 복원·변경을 검증했다.

### `T-011` — 초기 로딩·분석 API·쿼리 성능 개선

- `/dashboard/bootstrap` 단일 초기 요청, analytics viewport 지연 로딩, N+1 제거, response
  cache-control과 backend proxy connect/body timeout을 적용했다.

### `T-010` — Hallmark audit/redesign

- Hallmark 기준 audit/redesign을 반영해 dashboard hierarchy, responsive disclosure, status
  cards, charts, backup panel과 접근성 상태를 정리했다.
- live E2E에서 320/375/414/768px overflow 및 주요 control을 확인했다.

### `T-003` — 데이터 이전·5분 무손실 컷오버

- 7일 HTTP prewarm과 1일 delta import를 모두 실패 시 rollback하는 방식으로 수행했다.
- target scheduler는 configured `300s`와 effective `240s` safety-buffer tick으로, source는
  read-only 유지 상태에서 strict 5분 연속성 gate를 통과했다.
- source/target lot은 stable legacy ID로 대조하고, 양쪽 무관측 lot은 명시 allowlist 없이는
  통과하지 않는다. lot freshness, source lag, successful run gap 모두 `300s` 한도로 검사한다.

### `T-002` — Docker Compose + PostgreSQL + Alembic

- PostgreSQL 16 Compose, async SQLAlchemy, Alembic `0001_initial` → `0002_integrity_and_freshness`
  → `0003_legacy_source_identity` lineage, Postgres schema-head guard와 model/schema drift CI를
  구현했다.
- clean PostgreSQL `alembic upgrade head`, GitHub PostgreSQL CI, 14번 runtime health를 통과했다.

### `T-001` — kor-travel-map식 저장소·문서·AI 작업 구조

- `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `.claude/agents`, `.claude/skills`, `.codex/agents`,
  `.agents/skills`를 kor-travel-map 방식으로 이식했다.
- architecture/runbooks/reports와 tasks/resume/journal 구조를 정리하고 운영 IP·도메인·포트
  규칙을 문서화했다.
