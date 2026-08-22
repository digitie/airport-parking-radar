# CLAUDE.md — parking-radar 진입 요약

이 파일은 Claude Code와 Claude Agent가 가장 먼저 읽는 요약이다. 정식 정책은
`AGENTS.md`, 상세 실행 규칙은 `SKILL.md`, 진행 상태는 `docs/resume.md`와
`docs/tasks.md`가 갖는다.

## 1. 이 저장소가 하는 일

`parking-radar`는 국내 공항 주차장의 현재 잔여면과 최근 7일 흐름을 제공하는
FastAPI + Next.js 앱이다. 주차 관측(`parking_snapshots`), 공항/주차장 기준정보,
요금 규칙, 분석 캐시는 역할을 분리한다. 공휴일·비행편은 주차 수집과 분리된 조회
데이터이며, 비행편은 하루 흐름 오버레이 차트에만 표시한다.

## 2. 운영 기준

- 백엔드: FastAPI, SQLAlchemy 2, PostgreSQL 16, Alembic
- 프론트엔드: Next.js App Router, React, TypeScript
- 실행: Docker Compose
- 타임존: 저장·API는 UTC aware timestamp, 화면 표시는 `Asia/Seoul`
- 수집: 운영 기본 5분. 외부 API rate limit과 실제 관측 시각을 함께 확인한다.
- 새 운영 호스트: `digitie@192.168.1.14`
- 기존 호스트: `digitie@192.168.1.13` — 데이터 확인 외 Docker 조작 금지

## 3. 표준 작업 흐름

1. `docs/tasks.md`에서 task를 선택하고 `docs/resume.md`를 갱신한다.
2. `codex/` 브랜치에서 작고 검토 가능한 커밋을 만든다.
3. WSL 로컬 테스트 → Docker Compose 테스트 → Draft PR → CI 순서로 검증한다.
4. 적대적 리뷰 에이전트 2명의 지적을 재현하고 수정한다.
5. 14번 운영 환경에서 live E2E UI와 수집/백업 smoke를 통과시킨다.
6. 모든 필수 검증 후 PR을 머지하고 `docs/journal.md`, `docs/tasks-done.md`를 갱신한다.

## 4. 먼저 읽을 문서

- 구조·의존 경계: `docs/architecture/architecture.md`
- PostgreSQL 모델·마이그레이션: `docs/architecture/data-model.md`, `docs/runbooks/migration.md`
- 성능: `docs/architecture/performance.md`
- 테스트·배포: `docs/runbooks/testing.md`, `docs/runbooks/deployment.md`
- 운영 안전성: `docs/remote-command-safety.md`, `docs/runbooks/remote-command-safety.md`

