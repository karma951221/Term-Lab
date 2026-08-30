@AGENTS.md

# terms-studio 작업 규칙

## 문서

- 문서 진입점은 `docs/README.md` — 폴더 구성·문서 규칙(상태 배너·위키링크·절대 날짜)이 거기 있다.
- **결정은 결론만 본문에 적지 않는다** — 대안이 갈렸던 결정은 `docs/06_결정/` ADR 로
  맥락·버린 대안·감수 비용까지 남기고 본문에서 링크한다.
- `docs/_archive/`(옛 terms-lab 기획)와 `docs/_자료/`(실약관 텍스트)는 gitignore — 리포에 올리지 않는다.

## 세션 기록

- **커밋 전에 그 세션에서 나눈 논의를 `docs/_archive/세션기록/YYYY-MM-DD_<주제>.md` 로
  간단히 정리해 저장한다.** 문서에는 결론이, ADR 에는 근거가 남지만 대화의 흐름·경위는
  세션 기록에만 남는다. gitignore 대상이라 로컬 보관용이다.

## 커밋

- 커밋 메시지에 Co-Authored-By 등 서명·트레일러 문구를 넣지 않는다.
- 아이템(논리 단위)별로 커밋을 나눈다.

## 코드

- `src/domain/` 은 순수층 — DB·React import 금지 (ESLint 로 강제됨).
- `package.json` 의 `overrides.typescript` 를 지우지 말 것 (npm install 행 회피).
  TS 버전 업은 devDependencies 와 overrides 두 곳을 같이 올린다.
