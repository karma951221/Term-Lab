import { expect, type Locator, type Page, test } from "@playwright/test";

import { actualArticle, expectedArticles, type ArticleText } from "./_lib/terms";

/**
 * ★ 실물 재현 E2E (하이브리드) — 마스터 재료(구분자·담보·별표·보통약관·담보약관 문면)는 시드가 넣고,
 * 상품모델링은 화면으로 수행한 뒤 조립 미리보기를 원문과 조 단위로 대조한다.
 * 전제: `npm run db:seed` 로 실물 시드가 들어간 개발 DB. 시드 상품과 이름이 다른 상품을 새로 만든다.
 * 근거: docs/05_QA/시나리오/실물재현_E2E_시나리오.md · docs/superpowers/specs/2026-09-07-알파플러스-실물재현-design.md
 */

const PRODUCT_NAME = `알파Plus보장보험 E2E ${Date.now()}`;

/** 시드 상품 별표 목록과 같은 순서 (products.json 의 appendices). */
const APPENDIX_CODES = [
  "APX01_INTEREST",
  "APX02_DISABILITY",
  "APX03_SURGERY_1_7",
  "APX04_CANCER",
  "APX05",
  "APX06",
  "APX07_STROKE",
  "APX08_AMI",
  "APX09",
  "APX10_LUNG",
  "APX11_LIVER",
  "APX12_DIABETES",
  "APX13_BURN",
  "APX14_FRACTURE_2",
  "APX15_MAJOR_INJURY",
  "APX16",
  "APX17",
  "APX18",
  "APX19",
  "APX20_BENIGN_BRAIN",
  "APX21_FRACTURE_TABLE_2",
];

const SPECIALS: [title: string, file: string][] = [
  ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
  ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
  ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
  ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
];

/**
 * 같은 URL 로 돌아오는 서버 액션 제출 — `waitForURL` 은 즉시 풀리므로 POST 응답과 네트워크 정지를 기다린다.
 * 폼이 다시 그려진 뒤에 다음 조작을 해야 이전 제출과 겹치지 않는다.
 */
async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 미리보기 문서(article.ts-doc) 안의 조들을 (제목, 정규화 본문)으로. */
async function articlesOf(doc: Locator): Promise<ArticleText[]> {
  const sections = doc.locator("section.ts-doc-article");
  const n = await sections.count();
  const out: ArticleText[] = [];
  for (let i = 0; i < n; i++) {
    const heading = await sections.nth(i).locator("h3").first().innerText();
    const text = await sections.nth(i).innerText();
    out.push(actualArticle(heading, text));
  }
  return out;
}

function firstMismatch(expected: ArticleText[], actual: ArticleText[]): string {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e || !a || e.title !== a.title || e.text !== a.text) {
      const et = e?.text ?? "";
      const at = a?.text ?? "";
      let k = 0;
      while (k < et.length && k < at.length && et[k] === at[k]) k++;
      return `조 #${i + 1} (${e?.title} / ${a?.title}) — ${k}번째 글자부터 다름\n  기대: …${et.slice(Math.max(0, k - 40), k + 80)}\n  실제: …${at.slice(Math.max(0, k - 40), k + 80)}`;
    }
  }
  return "";
}

test.describe.serial("★ 실물 재현 — 상품모델링을 화면으로 수행하고 조립 결과를 원문과 대조한다", () => {
  test("상품 생성 → 보통약관 → 세목 → 별표 → 탑재(기본계약 1 + 특약 4) → 그룹 → 미리보기 대조", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);

    // 상품 생성
    await page.goto("/products/new");
    await page.getByLabel("상품명").fill(PRODUCT_NAME);
    await page.getByRole("button", { name: "생성" }).click();
    await page.waitForURL(/\/products\/[0-9a-f-]+$/);
    const productUrl = page.url();

    // 보통약관 템플릿
    await page.getByLabel("보통약관 템플릿").selectOption({ label: "무배당 알파Plus보장보험2604 보통약관" });
    await submit(page, page.getByRole("button", { name: "템플릿 저장" }));

    // 세목 선택지 2 (종 축) + 유효 조합 2
    for (const [number, name] of [
      [1, "보험료 납입면제 미적용형"],
      [2, "보험료 납입면제형"],
    ] as const) {
      const form = page.locator("form", { has: page.getByRole("heading", { name: "선택지 추가" }) });
      await form.getByLabel("축").selectOption("type");
      await form.getByLabel("번호").fill(String(number));
      await form.getByLabel("이름").fill(name);
      await form.getByLabel("세목유형").selectOption("D0002"); // 납입면제 유형 구조체
      await submit(page, form.getByRole("button", { name: "선택지 추가" }));
    }
    for (const label of [/제1종/, /제2종/]) {
      const form = page.locator("form", { has: page.getByRole("heading", { name: "조합 등록" }) });
      await form.getByLabel(label).check();
      await submit(page, form.getByRole("button", { name: "조합 등록" }));
    }
    await expect(page.getByRole("heading", { name: /^세목/ })).toContainText(/선택지 2/);
    await expect(page.getByRole("heading", { name: /^세목/ })).toContainText(/유효 조합 2/);

    // 별표 목록 — 순서가 곧 번호 (ADR-0030)
    await page.locator("#appendices textarea[name=codes]").fill(APPENDIX_CODES.join("\n"));
    await submit(page, page.locator("#appendices").getByRole("button", { name: "별표 목록 저장" }));
    await expect(page.locator("#appendices").getByRole("heading", { name: /별표 목록 21건/ })).toBeVisible();

    // 탑재 — 기본계약 섹션 1 + 특약 섹션 4 (같은 담보 2벌은 부가유형으로 구별)
    const mount = async (section: "기본계약 담보" | "특약 담보", coverage: string, addon?: "기본" | "추가") => {
      const form = page.locator("form", { has: page.getByRole("button", { name: `${section}에 탑재` }) });
      await form.getByLabel("담보").selectOption({ label: coverage });
      if (addon) await form.getByLabel("부가유형").selectOption({ label: addon });
      await submit(page, form.getByRole("button", { name: `${section}에 탑재` }));
      // 탑재는 새 상품담보의 값 화면으로 간다 — 다음 탑재를 위해 상품으로 돌아온다
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      await page.goto(productUrl);
    };
    await mount("기본계약 담보", "일반상해80%이상후유장해");
    await mount("특약 담보", "일반상해사망보장", "기본");
    await mount("특약 담보", "일반상해사망보장", "추가");
    await mount("특약 담보", "일반상해80%이상후유장해 생활자금보장");
    await mount("특약 담보", "골절(치아파절 제외)진단비Ⅱ보장");
    await expect(page.getByRole("heading", { name: /^탑재 \(상품담보\)/ })).toContainText("5건");
    // 기본계약 섹션에 탑재하면 곧 기본계약 지정이다 — 담보명 값은 스냅샷으로 복사돼 있다
    await expect(page.getByRole("heading", { name: "기본계약 담보 1건" })).toBeVisible();

    // 특약 그룹 + 배치 4 — 그룹 제목은 입력칸 값이라 hasText 로는 못 찾는다: 배치 버튼의 접근성 이름으로 폼을 잡는다
    await page.getByLabel("새 그룹 제목").fill("상해 관련 특별약관");
    await submit(page, page.getByRole("button", { name: "그룹 추가" }));
    for (const name of ["일반상해사망보장", "일반상해사망보장 추가", "일반상해80%이상후유장해 생활자금보장", "골절(치아파절 제외)진단비Ⅱ보장"]) {
      const place = page.getByRole("button", { name: "배치 · 상해 관련 특별약관 에" });
      await page.locator("form", { has: place }).locator("select[name=productCoverageId]").selectOption({ label: name });
      await submit(page, place);
    }
    // 기본계약은 특약 벌로 찍히지 않으므로 배치하지 않는다 — 미배치에 기본계약 하나만 남는다
    await expect(page.getByText(/^미배치 상품담보: 일반상해80%이상후유장해$/)).toBeVisible();

    // 조립 미리보기 — 완성본
    await page.getByRole("link", { name: /조립 미리보기/ }).first().click();
    await expect(page).toHaveURL(/\/products\/.+\/preview/);
    await expect(page.getByRole("heading", { name: /^오류 0 \/ 조 \d+$/ })).toBeVisible();
    await expect(page.getByText(/완성본 아님/)).toHaveCount(0);

    // 대조 — 보통약관 (관 7 · 조 52) + 특약 4벌
    const general = page.locator("article.ts-doc").first();
    await expect(general.locator(".ts-doc-section")).toHaveCount(7);
    const generalActual = await articlesOf(general);
    const generalExpected = expectedArticles("보통약관.md");
    expect(generalActual.length, "보통약관 조 수").toBe(generalExpected.length);
    expect(firstMismatch(generalExpected, generalActual), "보통약관 첫 불일치").toBe("");

    for (const [title, file] of SPECIALS) {
      const doc = page.locator("article.ts-doc", { has: page.getByRole("heading", { name: title, exact: true }) });
      await expect(doc, title).toHaveCount(1);
      const actual = await articlesOf(doc);
      const expected = expectedArticles(file);
      expect(actual.length, `${title} 조 수`).toBe(expected.length);
      expect(firstMismatch(expected, actual), `${title} 첫 불일치`).toBe("");
    }
  });

  test("문면 편집기 — 관 안에 제1조(목적)를 화면으로 작성하면 원문 제1조와 같게 렌더된다", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const title = `E2E 보통약관 ${Date.now()}`;

    await page.goto("/documents");
    await page.getByLabel("제목").fill(title);
    await page.getByRole("button", { name: "생성" }).first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
    const docUrl = page.url();

    // 편집 모드 — 문서 수준 「여기에 추가」로 관을 넣는다
    await page.goto(`${docUrl}?mode=edit`);
    const add = async (kind: string, fields: Record<string, string>) => {
      const menu = page.locator("aside.ts-l3-side details.ts-insert-menu").first();
      await menu.locator("summary").click();
      await menu.locator("select[name=kind]").selectOption(kind);
      for (const [name, value] of Object.entries(fields)) await menu.locator(`[name=${name}]`).fill(value);
      await submit(page, menu.getByRole("button", { name: "고른 종류로 노드 추가" }));
    };
    /** 본문의 「… 고치기」 링크를 눌러 그 노드를 우측 패널에 싣는다 — 클라이언트 내비게이션이라 node= 가 바뀔 때까지 기다린다. */
    const openNode = async (name: RegExp) => {
      const link = page.getByRole("link", { name }).first();
      const href = (await link.getAttribute("href")) ?? "";
      const nodeId = href.split("node=")[1] ?? "";
      await link.click();
      await page.waitForURL((url) => url.searchParams.get("node") === nodeId);
    };
    await add("section", { title: "목적 및 용어의 정의" });
    await openNode(/^제1관 목적 및 용어의 정의 고치기/);
    await add("article", { title: "목적" });
    await openNode(/^제1조\(목적\) 고치기/);
    await add("paragraph", {});
    await openNode(/^제1항 고치기|^항 고치기/);
    await add("text", { text: "이 보험계약(이하 「계약」이라 합니다)은 보험계약자(이하 「계약자」라 합니다)와 보험회사(이하 「회사」라 합니다) 사이에 피보험자의 상해에 대한 위험을 보장하기 위하여 체결됩니다." });

    // 읽기 모드 — 관 제목 · 조 제목 · 단항이라 마커 없음 · 본문이 원문 제1조와 같다
    await page.goto(docUrl);
    await expect(page.getByRole("heading", { name: "제1관 목적 및 용어의 정의" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "제1조(목적)" })).toBeVisible();
    const article = page.locator("section.ts-doc-article").first();
    await expect(article.locator(".ts-doc-num")).toHaveCount(0);
    const actual = actualArticle(await article.locator("h3").innerText(), await article.innerText());
    const expected = expectedArticles("보통약관.md")[0];
    expect(actual).toEqual(expected);
  });
});
