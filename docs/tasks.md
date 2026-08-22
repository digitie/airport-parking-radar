# tasks.md — parking-radar 백로그

진행 중/예정(`[ ]`) task만 두는 백로그다. 완료 항목은
[`docs/tasks-done.md`](tasks-done.md)에 이동하고, 현재 진척과 다음 작업은
[`docs/resume.md`](resume.md)에 기록한다. 작성 규칙은 [`docs/tasks-rule.md`](tasks-rule.md)를
따른다. 2026-08-22 기준 아래 기능·문서·검증 task는 모두 완료되어 미완료 백로그가 없다.

## 진행 중인 작업 인덱스

- 현재 미완료 task 없음. 완료 이력은 [`docs/tasks-done.md`](tasks-done.md)를 참조한다.

## 완료 조건

이 백로그는 코드·문서·테스트·운영 검증이 모두 끝난 뒤 각 항목을 완료 처리한다.

- [x] PostgreSQL 컨테이너가 healthcheck를 통과하고 애플리케이션이 기동된다.
- [x] 기존 SQLite 테스트와 PostgreSQL Docker 테스트가 모두 통과한다.
- [x] 최근 주차 관측 구간과 마지막 수집 시각이 이전 시스템보다 늦지 않다.
- [x] 14번에서 연속 수집이 시작되고 5분 간격의 관측 공백이 발생하지 않는다.
- [x] 14번 공개 포트는 API `14000`, web `14001`이며 live E2E는
  `https://pr.digitie.mywire.org`에서 실행한다.
- [x] API 외부 주소는 `https://pr-api.digitie.mywire.org`로 smoke 검증한다.
- [x] 백업 생성·다운로드·복원 UI를 실제 브라우저에서 확인한다. 실제 운영 DB를 덮어쓰는 복원 실행은
  pre-restore backup 보호를 확인한 뒤 별도 운영 승인으로 남긴다.
- [x] 모바일 320/375/414px와 데스크톱 768px 이상에서 가로 스크롤·접근성 회귀가 없다.
- [x] 두 리뷰 에이전트의 critical/major 지적이 해소되거나 근거와 함께 기록된다.
- [x] Draft PR이 CI와 live E2E를 통과한 뒤에만 머지한다.

## 운영 제약 및 미해결 위험

- 192.168.1.13에서는 Docker를 조작하지 않는다. 원본은 `http://192.168.1.13:3000/api/backend`
  HTTP GET으로만 읽었고, 외부 원본 주소 `https://pr2.digitie.mywire.org`는 cutover 당시
  parking-radar가 아닌 Home Assistant 응답을 보여 원본 검증에 사용하지 않았다.
- HTTP fallback은 공항·주차장·관측 시계열을 보존했지만 raw response와 기존 collection run ID를
  복원하지 않는다. exact SQLite dump가 필요하면 운영자 권한으로 별도 파일을 제공해야 한다.
- 13번의 현재 수집기는 10분 주기로 동작 중이다. 14번은 configured 5분 계약과 60초 safety
  buffer(실제 tick 240초)로 운영하며, 공공데이터 API rate limit과 실제 응답 시각은
  `docs/architecture/collection.md`에 기록한다.
- 백업/복원 API에는 별도 인증이 없다. 인터넷에 직접 노출하지 않고 내부망 또는 외부
  게이트웨이에서 접근을 제한해야 한다.
