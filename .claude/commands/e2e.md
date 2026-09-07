---
description: E2E 를 실행하고, 깨지면 진단서를 읽어 원인을 판정하고 복구한다
---

E2E 를 실행하고, 실패하면 `docs/05_QA/E2E_복구절차.md` 를 따라 복구한다.

인자: `$ARGUMENTS` — 좌표(`그룹핑별표#5`), 문서 슬러그(`그룹핑별표`), 또는 비움(전체).

## 하는 일

1. **먼저 `docs/05_QA/E2E_복구절차.md` 를 읽는다.** 판정 기준·금지 목록·정지 조건이 거기 있다.
2. 실행한다.
   - 인자가 있으면 `npm run test:e2e -- --grep "$ARGUMENTS"`
   - 없으면 `npm run test:e2e`
3. 녹색이면 끝. 결과를 한 줄로 보고한다.
4. 실패하면 `test-results/failures/INDEX.md` 와 각 `FAILURE.md` 를 읽는다.
5. 진단서의 「판정」 절대로 ①②③ 중 하나를 고른다 — **정본 문장 인용 필수.**
6. ③(문서가 낡음)이면 **고치지 말고 멈춘다.** 무엇이 어긋났는지 사람에게 보고한다.
7. ①②면 고치고, `npm test && npm run typecheck && npm run lint` 확인 후 2로. **최대 3회.**

## 절대 하지 않는 것

- 금지 목록을 고쳐서 통과시키기 — `src/domain/**/__snapshots__/**` · `tests/fixtures/terms/*.md` · `docs/05_QA/시나리오/*.md`
- 근거 인용 없는 수정
- 초록불 자체를 목표로 삼기 — 목표는 「문서대로 맞는가」다

## 곁들여 쓰는 것

- `npm run e2e:coverage` — 시나리오 문서 ↔ E2E 대조표 (무엇이 안 덮였나)
- `E2E_DUMP_DB=1` — 실패한 실행의 DB 를 통째로 남긴다 (결정론적인데도 재현이 안 될 때)
- `npx playwright show-trace test-results/failures/<슬러그>/trace.zip` — 되감기
