# resume.md — 현재 인수인계

## 현재 상태

- 기준일: 2026-08-22
- 작업 브랜치: `codex/parking-radar-postgres-migration`
- 현재 단계: 기준선 조사 및 구조 전환 설계
- 운영 원본: `digitie@192.168.1.13:/home/digitie/apps/parking-radar`
- 새 운영 대상: `digitie@192.168.1.14`
- 14번 공개 포트: API `14000`, web `14001`; live E2E 기준 URL:
  `https://pr.digitie.mywire.org`
- 14번 외부 API URL: `https://pr-api.digitie.mywire.org`

## 다음 한 작업

`docs/tasks.md`의 `T-001`을 구현하고 단계별 커밋으로 원격 Draft PR에 올린다.

## 확인된 사실

- 13번의 현재 서비스는 프론트 `:3000`, 백엔드 `:8000`에서 응답한다.
- 13번 `digitie` 계정은 Docker 그룹에 속하지 않아 Docker API를 읽을 수 없다.
- 13번 최신 확인 시 수집기는 10분 주기이며 마지막 관측 시각은 운영 API에서 조회한다.
- 14번은 Docker Compose v5와 Docker 접근 권한이 확인됐다.

## 남은 운영 확인

- exact SQLite dump를 얻을 수 있는지와 13번 수집기를 언제 중지할지 운영 cutover 때 확정한다.
- 14번의 실제 외부 API 키·도메인·포트·백업 보존 위치를 `.env`에 주입하고 값 자체는
  문서나 커밋에 남기지 않는다.
