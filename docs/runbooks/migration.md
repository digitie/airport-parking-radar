# 192.168.1.13 → 192.168.1.14 migration runbook

## 불변 조건

- 13번에는 Docker 명령을 실행하지 않는다. 기존 서비스와 DB volume은 변경하지 않고 HTTP API만 읽는다.
- Docker Compose와 PostgreSQL은 14번에서만 실행한다.
- 13번 수집기는 cutover 검증이 끝날 때까지 유지해 source of truth와 rollback 경로로 둔다.
- 14번 scheduler는 `COLLECT_INTERVAL_SECONDS=300`으로 시작하며, 최초 수집은 scheduler 시작 직후 실행된다.

## 데이터 경로 선택

1. 가장 정확한 경로: 운영자가 13번 SQLite 파일의 authorized copy 또는 PostgreSQL dump를 14번의 보호된 경로로 제공하고 `scripts/migrate_sqlite_to_postgres.py` 또는 `pg_restore`를 실행한다. 이 경로는 raw response, collection run, fee rule, analytics cache까지 보존한다.
2. 현재 SSH 권한에서 가능한 fallback: `scripts/migrate_http_history.py`가 13번의 `/airports`와 parking history API를 읽어 공항·주차장·관측 시계열을 PostgreSQL에 upsert한다. 이 경로는 raw API body와 collection run ID를 복원할 수 없으므로 migration source로 명시한다.

## 단계

### 1. 14번 사전 점검

```bash
ssh digitie@192.168.1.14 'ss -lntp | grep -E ":(14000|14001|5432) " || true'
ssh digitie@192.168.1.14 'docker compose version && docker ps --format "{{.Names}}" | head'
```

현재 확인 결과 3000/8000/5432는 비어 있고 Compose v5.2.0 및 Docker socket 접근이 가능했다. 다른 Compose project의 컨테이너는 중지하거나 재생성하지 않는다.

14번에 `/home/digitie/apps/parking-radar/.env.server14`를 만들고 `.env.server14.example`을 기준으로 실제 운영 키만 입력한다. `ENABLE_SCHEDULER=false`, `SEED_SAMPLE_DATA=false`로 시작한다.

### 2. 14번 PostgreSQL 준비

```bash
docker compose --project-name parking-radar --env-file .env.server14 up -d postgres
docker compose --project-name parking-radar --env-file .env.server14 run --rm --no-deps backend alembic upgrade head
```

위 명령은 모두 14번에서 실행한다. 13번에는 Docker 명령을 보내지 않는다.

### 3. prewarm import

```bash
docker compose --project-name parking-radar --env-file .env.server14 run --rm --no-deps \
  backend python /app/scripts/migrate_http_history.py \
  --source-base-url http://192.168.1.13:8000 \
  --days 7
```

프론트 proxy만 접근 가능하면 `http://192.168.1.13:3000/api/backend`를 사용한다. 출력의 `failures=0`, imported count, source lot 수를 기록한다.

### 4. final delta와 5분 cutover

cutover 시작 전에 13번 API에서 `/admin/collector-status`의 `latest_snapshot_observed_at`, `latest_snapshot_collected_at`, `last_run.id`를 기록한다. 그 다음 다음을 즉시 실행한다.

```bash
date -Is
docker compose --project-name parking-radar --env-file .env.server14 run --rm --no-deps \
  backend python /app/scripts/migrate_http_history.py \
  --source-base-url http://192.168.1.13:8000 --days 1
docker compose --project-name parking-radar --env-file .env.server14 up -d backend frontend
until curl -fsS http://127.0.0.1:14000/health >/dev/null; do sleep 2; done
curl -fsS http://127.0.0.1:14000/admin/collector-status
```

14번 backend는 기동 직후 collector를 한 번 실행한다. `date -Is`부터 14번의 `last_run.finished_at`까지 240초 이내인지 측정하고, 14번 latest observed/collected가 13번 cutover marker보다 늦거나 같은지 확인한다. 5분 기준을 넘거나 latest marker가 후퇴하면 14번 scheduler를 끄고 13번을 유지한 채 원인을 조사한다.

HTTP fallback의 경우 13번은 계속 실행 중이므로 source update가 중단되지 않는다. 14번이 live 수집을 시작한 뒤 두 시스템의 latest marker를 5분 동안 1분 간격으로 비교해 공백이 없는 것을 확인한다. 확인이 끝나기 전에는 13번을 중지하지 않는다.

### 5. 검증·보존

```bash
curl -fsS http://192.168.1.14:14000/health
curl -fsS 'http://192.168.1.14:14000/dashboard/bootstrap' >/dev/null
curl -fsS 'http://192.168.1.14:14000/dashboard/analytics?airport_code=GMP' >/dev/null
```

검증 항목은 `docs/tasks.md`와 `docs/journal.md`에 source/target row count, latest observed, latest collected, last run ID, 실제 elapsed seconds를 남긴다. exact dump가 없었으면 raw/run/fee 보존 불가를 숨기지 않고 기록한다.

## rollback

14번 컨테이너만 `docker compose --project-name parking-radar ... stop`으로 중지할 수 있다. 13번은 이 runbook과 사용자 제약에 따라 Docker를 조작하지 않는다. 14번 PostgreSQL을 되돌릴 때는 복원 UI/API의 pre-restore backup 또는 `pg_restore`를 사용한다.
