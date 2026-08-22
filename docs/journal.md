# journal.md — 작업 일지

## 2026-08-22

- 사용자 요청으로 SQLite 기반 운영 앱을 PostgreSQL/Docker 기반으로 전환하는 작업을 시작했다.
- `kor-travel-map`의 `docs/tasks.md`, `resume.md`, `tasks-done.md`, `tasks-rule.md` 방식과
  `AGENTS.md`/`CLAUDE.md`/`SKILL.md`/AI agent·skill 구조를 기준으로 삼았다.
- 192.168.1.13은 Docker 소켓이 `root:docker`이고 `digitie`가 해당 그룹에 없어 Docker
  조작을 하지 않기로 했다. 192.168.1.14는 Docker Compose와 Docker 접근이 가능하다.
- `kor-travel-map` 방식의 AI 작업 문서와 docs backlog 구조를 이식했다. `AGENTS.md`,
  `CLAUDE.md`, `SKILL.md`, `.claude`, `.codex`, `.agents` 경로를 포함한다.
- PostgreSQL 16/Alembic clean upgrade와 14번 runtime을 확인했다. remote status는
  Alembic `0002_integrity_and_freshness (head)`, API `14000`, web `14001`, scheduler `300s`다.
- HTTP migration은 7일 prewarm `imported_snapshots=36878`, `source_lots=53`, `failures=0`으로
  완료했고, reconciliation 후 duplicate lot `0`을 확인했다. 2026-08-22 현재 DB query는
  `parking_snapshots=37890`, distinct lots `44`다.
- 14번 target collector run은 2026-08-22T03:15:01Z 시작, 03:15:02Z 종료, success,
  snapshot_count `44`였다. 6회 × 60초 HTTP-only cutover observation은 각 `failure_count=0`,
  final `failed_samples=0`이었다. verifier는 source 전파 tail 360초와 successful run gap
  360초를 검사한다.
- 로컬 WSL 검증은 backend `59 passed`, frontend `9 files / 43 tests passed`, TypeScript와
  production build 통과였다. GitHub Actions run `32547913806`에서도 backend, frontend,
  live-e2e가 모두 통과했다.
- exact live UI 검증은 `E2E_BASE_URL=https://pr.digitie.mywire.org npm run test:e2e`로
  5 passed였고, 14번 직접 origin에서도 5 passed였다. API `https://pr-api.digitie.mywire.org`
  health와 web same-origin backend health도 정상이다.
- 두 적대적 reviewer James(Frontend)와 Popper(Backend/Ops)의 P0/P1 지적을 반영했다.
  무인증 backup/restore는 사용자의 명시 요구라 유지하되 gateway/private network 보호를
  runbook에 남겼다.
- Draft PR [#2](https://github.com/digitie/airport-parking-radar/pull/2)의 최신 head는
  `4980485`이며 CI/live E2E green 후 merge 단계다. 13번에는 Docker 명령을 실행하지 않았다.
