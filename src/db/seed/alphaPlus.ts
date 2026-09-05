/**
 * 관통 1 축약 시드 — `seedAlphaPlus(services, actor)`.
 *
 * 2차구현_계획 §5 의 축약 픽스처(도메인 `src/domain/assembly/fixture.ts` `alphaPlusFixture` 와 같은 모양)를
 * **실제 서비스 호출**로 DB 에 만든다 (SQL 직접 삽입 금지 — 규칙이 서비스에 있다).
 * 정확한 구성은 `src/services/assembly.test.ts` 의 관통 1 통합 테스트 `beforeAll` 을 그대로 따른다.
 *
 * 만드는 것:
 * - 구분자 6개: D0001 갱신여부(담보 boolean 무조건노출) · D0002 고지유형(상품 enum E0001) ·
 *   D0003 보험금지급(급부 구조체 F01 면책여부·F02 지급률) · D0004 평균공시이율(const '2.5%') ·
 *   D0005 면책여부합(담보 파생 any(D0003.F01)) · D0006 감액기간(담보 number 선택 노출)
 * - enum E0001 고지유형 {일반심사, 간편심사}
 * - 담보 마스터 「일반상해사망」(세부보장 1 · 급부 「사망보험금」 1) + 값(D0001·D0006·D0003.F01·F02)
 * - 별표 마스터 2건(장해분류표 · 화상 분류표 — 문면이 참조하는 것은 장해분류표뿐)
 * - 공용조항 2건: C0001 「특별약관의 소멸」(block · 옵션 O01{일반/사망}) · C0002 「준용 문구」(inline · 보통약관 조 참조)
 * - 보통약관 마스터 1벌 「알파Plus 보통약관」(4개 조 — 그중 하나가 별표 참조 슬롯)
 * - 담보약관 1벌 「일반상해사망 특별약관」(대응 보통약관 지정 → 조연결 · 조건·인라인조건·공용조항 참조 포함)
 * - 담보속성 2종: A0001 갱신유형{비갱신형/갱신형} · A0002 부가유형{기본/추가}
 * - 상품 「알파Plus(축약)」 + 상품담보 2(기본/추가) + 기본계약(기본) + 그룹 「상해 관련 특별약관」
 *
 * 멱등: 상품명 「알파Plus(축약)」이 이미 있으면 생성을 건너뛴다 (재실행 안전 — `npm run db:seed` 반복 호출).
 * 어느 경로든 마지막에 `assembly.preview` 로 `complete === true` 를 확인하고, 아니면 issues 를 로그로
 * 남기고 예외를 던진다 (스크립트 실패 종료는 호출자 `index.ts` 몫).
 */
import type { Command, DocumentNode } from "@/domain/document";
import type { Actor, Id, Result } from "@/domain/types";

import type { Services } from "@/services/container";

/** 멱등 판단 기준 — 이 상품명이 있으면 이미 시드된 것으로 본다. */
export const ALPHA_PLUS_PRODUCT_NAME = "알파Plus(축약)";

export interface SeedResult {
  /** true = 이번 호출에서 실제로 만들었다. false = 이미 있어 건너뛰었다(멱등). */
  created: boolean;
  productId: Id;
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`[seed:alphaPlus] 기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

/** 문서 트리 루트 아래에 자식 노드들을 일괄 삽입하는 Command 목록. */
function insertAll(root: Id, nodes: DocumentNode["children"]): Command[] {
  return nodes.map((node) => ({ type: "insert", node, at: { parentId: root } }));
}

/** 마지막 확인 — 조립 미리보기가 issues 없이 complete 인지. 아니면 로그 남기고 던진다. */
async function assertAssembles(services: Services, productId: Id): Promise<void> {
  const r = await services.assembly.preview(productId);
  if (!r.ok) throw new Error(`[seed:alphaPlus] 조립 미리보기 실패: ${JSON.stringify(r.rejection)}`);
  if (!r.value.complete) {
    console.error("[seed:alphaPlus] 조립이 complete=true 가 아닙니다. issues:");
    console.error(JSON.stringify(r.value.issues, null, 2));
    throw new Error("[seed:alphaPlus] 관통 1 조립 검증 실패 (complete=false)");
  }
}

export async function seedAlphaPlus(services: Services, actor: Actor): Promise<SeedResult> {
  const existing = (await services.product.listProducts()).find((p) => p.name === ALPHA_PLUS_PRODUCT_NAME);
  if (existing) {
    console.log(`[seed:alphaPlus] 이미 있음 — 건너뜀 (상품 ${existing.id})`);
    await assertAssembles(services, existing.id);
    return { created: false, productId: existing.id };
  }

  const { catalog, coverage, clause, document, product } = services;

  // ── 카탈로그 — D0001 갱신여부 · E0001/D0002 고지유형 · D0003 보험금지급 · D0004 평균공시이율 · D0005 면책여부합 · D0006 감액기간(선택 노출)
  unwrap(await catalog.create(actor, { kind: "scalar", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, alwaysExposed: true }));
  unwrap(await catalog.createEnum(actor, { label: "고지유형", values: [{ label: "일반심사" }, { label: "간편심사" }] }));
  unwrap(await catalog.create(actor, { kind: "scalar", label: "고지유형", level: "product", type: { kind: "enum", enumCode: "E0001" }, alwaysExposed: true }));
  unwrap(
    await catalog.create(actor, {
      kind: "struct",
      label: "보험금지급",
      level: "benefit",
      alwaysExposed: true,
      fields: [
        { label: "면책여부", type: { kind: "boolean" } },
        { label: "지급률", type: { kind: "number" } },
      ],
    }),
  );
  unwrap(await catalog.create(actor, { kind: "const", label: "평균공시이율", value: "2.5%" }));
  unwrap(await catalog.create(actor, { kind: "derived", label: "면책여부합", level: "coverage", expression: "any(D0003.F01)" }));
  unwrap(await catalog.create(actor, { kind: "scalar", label: "감액기간", level: "coverage", type: { kind: "number" } }));

  // ── 담보 마스터 — 일반상해사망 (세부보장 1 · 급부 1) + 값 + 감액기간 부착
  const tree = unwrap(await coverage.create(actor, { name: "일반상해사망", benefitName: "사망보험금" }));
  const covDeath = tree.id;
  const ben = tree.subCoverages[0].benefits[0];
  unwrap(await coverage.writeValue(actor, { level: "coverage", id: covDeath }, "D0001", false));
  unwrap(await coverage.attach(actor, { level: "coverage", id: covDeath }, "D0006"));
  unwrap(await coverage.writeValue(actor, { level: "coverage", id: covDeath }, "D0006", 24));
  unwrap(await coverage.writeValue(actor, { level: "benefit", id: ben.id }, "D0003.F01", true));
  unwrap(await coverage.writeValue(actor, { level: "benefit", id: ben.id }, "D0003.F02", 100));

  // ── 별표 · 공용조항 (C0001 소멸 block + 옵션 O01{V01 일반, V02 사망} · C0002 준용 inline)
  unwrap(await document.createAppendix(actor, { code: "APX_DISABILITY", name: "장해분류표" }));
  unwrap(await document.createAppendix(actor, { code: "APX_BURN", name: "화상 분류표" }));
  unwrap(
    await clause.create(actor, {
      label: "특별약관의 소멸",
      mode: "block",
      body: [
        {
          id: "c1-par",
          kind: "paragraph",
          children: [
            { id: "c1-t1", kind: "text", text: "이 특별약관은 " },
            { id: "c1-opt", kind: "optionSlot", optionCode: "O01" },
            { id: "c1-t2", kind: "text", text: " 소멸합니다." },
          ],
        },
      ],
      options: [
        {
          label: "소멸 사유",
          values: [
            { label: "일반", body: [{ id: "c1-o-gen", kind: "text", text: "보험기간이 끝난 때" }] },
            { label: "사망", body: [{ id: "c1-o-death", kind: "text", text: "피보험자가 사망한 때" }] },
          ],
        },
      ],
    }),
  );

  // ── 보통약관 — 4개 조 (제2조 갱신여부 인라인 조건 + 고지유형 슬롯 · 제3조 별표 · 제4조 준용 = 공용조항)
  const g = unwrap(await document.createGeneral(actor, "알파Plus 보통약관"));
  unwrap(
    await clause.create(actor, {
      label: "준용 문구",
      mode: "inline",
      body: [
        { id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관 " },
        { id: "c2-ref", kind: "articleRef", articleId: "g-art-def" },
        { id: "c2-t2", kind: "text", text: " 및 관계 법령을 따릅니다." },
      ],
    }),
  );
  unwrap(
    await document.apply(
      actor,
      g.id,
      insertAll(g.tree.id, [
        { id: "g-art-def", kind: "article", title: "용어의 정의", children: [{ id: "g-par-def", kind: "paragraph", children: [{ id: "g-txt-def", kind: "text", text: "이 계약에서 사용하는 용어의 정의는 다음과 같습니다." }] }] },
        {
          id: "g-art-pay",
          kind: "article",
          title: "보험금의 지급사유",
          children: [
            {
              id: "g-par-pay-1",
              kind: "paragraph",
              children: [
                { id: "g-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                {
                  id: "g-inl-renew",
                  kind: "inlineCond",
                  branches: [
                    { id: "g-inl-renew-if", when: "D0001 = true", children: [{ id: "g-txt-pay-2", kind: "text", text: "최초계약일" }] },
                    { id: "g-inl-renew-else", children: [{ id: "g-txt-pay-3", kind: "text", text: "계약일" }] },
                  ],
                },
                { id: "g-txt-pay-4", kind: "text", text: " 이후 기본계약의 보험금 지급사유가 발생한 때 보험금을 지급합니다." },
              ],
            },
            { id: "g-par-pay-2", kind: "paragraph", children: [{ id: "g-txt-pay-5", kind: "text", text: "이 계약은 " }, { id: "g-slot-notice", kind: "slot", ref: "D0002" }, { id: "g-txt-pay-6", kind: "text", text: " 계약입니다." }] },
          ],
        },
        { id: "g-art-disability", kind: "article", title: "장해의 분류", children: [{ id: "g-par-dis", kind: "paragraph", children: [{ id: "g-txt-dis-1", kind: "text", text: "장해의 분류는 " }, { id: "g-apx-disability", kind: "appendixRef", appendixCode: "APX_DISABILITY" }, { id: "g-txt-dis-2", kind: "text", text: " 에 따릅니다." }] }] },
        { id: "g-art-apply", kind: "article", title: "준용규정", children: [{ id: "g-par-apply", kind: "paragraph", children: [{ id: "g-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
      ]),
    ),
  );

  // ── 담보속성 카탈로그 — 담보약관 문면이 attr.A0001 을 참조하므로 문면 작성보다 먼저 채번한다
  //   (container 의 typeResolver 는 담보속성 카탈로그로 attr.X 유효성을 실제로 검사한다 — 도메인
  //    픽스처의 순서가 아니라 서비스 통합 순서를 따른다).
  unwrap(await product.createAttributeKind(actor, { label: "갱신유형" })); // A0001
  unwrap(await product.addAttributeValue(actor, "A0001", { label: "비갱신형" }));
  unwrap(await product.addAttributeValue(actor, "A0001", { label: "갱신형", naming: { prefix: "갱신형" } }));
  unwrap(await product.createAttributeKind(actor, { label: "부가유형" })); // A0002
  unwrap(await product.addAttributeValue(actor, "A0002", { label: "기본" }));
  unwrap(await product.addAttributeValue(actor, "A0002", { label: "추가", naming: { suffix: "추가" } }));

  // ── 담보약관 — 일반상해사망 (대응 보통약관 지정 → 조연결 · 보통약관 조 참조 가능)
  const s = unwrap(await document.createSpecial(actor, covDeath, "일반상해사망 특별약관"));
  unwrap(await document.setGeneralDocument(actor, s.id, g.id));
  unwrap(
    await document.apply(
      actor,
      s.id,
      insertAll(s.tree.id, [
        {
          id: "s-art-pay",
          kind: "article",
          title: "보험금의 지급사유",
          children: [
            {
              id: "s-par-pay-1",
              kind: "paragraph",
              children: [
                { id: "s-txt-pay-1", kind: "text", text: "회사는 피보험자가 " },
                {
                  id: "s-inl-renew",
                  kind: "inlineCond",
                  branches: [
                    { id: "s-inl-renew-if", when: "exist(attr.A0001) and attr.A0001 = 'V02'", children: [{ id: "s-txt-pay-2", kind: "text", text: "최초계약일" }] },
                    { id: "s-inl-renew-else", children: [{ id: "s-txt-pay-3", kind: "text", text: "계약일" }] },
                  ],
                },
                { id: "s-txt-pay-4", kind: "text", text: " 이후 상해로 사망한 경우 사망보험금을 지급합니다." },
              ],
            },
            { id: "s-par-pay-2", kind: "paragraph", children: [{ id: "s-txt-pay-5", kind: "text", text: "사망보험금은 보험가입금액에 평균공시이율 " }, { id: "s-slot-rate", kind: "slot", ref: "D0004" }, { id: "s-txt-pay-6", kind: "text", text: " 을 적용하여 계산합니다." }] },
          ],
        },
        {
          id: "s-cond-exempt",
          kind: "condBlock",
          branches: [{ id: "s-cond-exempt-if", when: "D0005 = true", children: [{ id: "s-art-exempt", kind: "article", title: "보험금을 지급하지 않는 사유", children: [{ id: "s-par-exempt", kind: "paragraph", children: [{ id: "s-txt-exempt", kind: "text", text: "고의 사고에는 지급하지 않습니다." }] }] }] }],
        },
        { id: "s-art-reduce", kind: "article", title: "보험금의 감액지급", children: [{ id: "s-par-reduce", kind: "paragraph", children: [{ id: "s-txt-reduce-1", kind: "text", text: "계약일부터 " }, { id: "s-slot-reduce", kind: "slot", ref: "D0006" }, { id: "s-txt-reduce-2", kind: "text", text: "개월 이내의 사망은 감액 지급합니다." }] }] },
        { id: "s-art-lapse", kind: "article", title: "특별약관의 소멸", children: [{ id: "s-par-lapse", kind: "paragraph", children: [{ id: "s-txt-lapse", kind: "text", text: "이 특별약관은 다음의 경우 소멸합니다." }] }, { id: "s-clause-lapse", kind: "clauseBlockRef", clauseCode: "C0001", options: { O01: "V02" } }] },
        { id: "s-art-apply", kind: "article", title: "준용규정", linkedArticleId: "g-art-apply", children: [{ id: "s-par-apply", kind: "paragraph", children: [{ id: "s-clause-apply", kind: "clauseInlineRef", clauseCode: "C0002", options: {} }] }] },
      ]),
    ),
  );

  // ── 상품 — 값 · 탑재 ×2 · 기본계약 · 그룹 (담보속성 카탈로그는 앞서 채번했다)
  const productId = unwrap(await product.createProduct(actor, { name: ALPHA_PLUS_PRODUCT_NAME, generalDocumentId: g.id })).id;
  unwrap(await product.setProductValue(actor, productId, "D0002", undefined, "V02"));
  const pcBasic = unwrap(await product.mount(actor, productId, covDeath, [{ kindCode: "A0002", valueCode: "V01" }])).id;
  const pcAddon = unwrap(await product.mount(actor, productId, covDeath, [{ kindCode: "A0002", valueCode: "V02" }])).id;
  unwrap(await product.designateBaseContract(actor, productId, pcBasic));
  const group = unwrap(await product.createGroup(actor, productId, { title: "상해 관련 특별약관" }));
  unwrap(await product.placeInGroup(actor, group.id, pcBasic));
  unwrap(await product.placeInGroup(actor, group.id, pcAddon));

  await assertAssembles(services, productId);
  console.log(`[seed:alphaPlus] 생성 완료 — 상품 ${productId} (기본계약 ${pcBasic} · 추가 ${pcAddon})`);
  return { created: true, productId };
}
