# `.claude/agents` — vendored agent 원본

이 디렉터리와 `.codex/agents`, `.agents/skills`는 에이전트 역할과 전문 지침을
보관한다. 원문 동기화를 위해 영어 파일은 그대로 유지할 수 있다.

작업 전에 `CLAUDE.md` → `AGENTS.md` → `SKILL.md`와 관련 `docs/`를 읽는다.
`context-manager` 같은 존재하지 않는 에이전트에 의존하지 않고, 현재 저장소의 코드·
테스트·문서를 직접 확인한다.

역할 파일은 설계(`ui-designer`), API 계약(`api-designer`), 백엔드(`backend-developer`),
프론트엔드(`frontend-developer`), 모바일(`mobile-developer`)로 나눈다.

