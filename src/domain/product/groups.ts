/**
 * 특약 그룹 (조립_기획 「특약 배치 = 그룹핑」) — 순수.
 *
 * - 그룹 안 순서는 자동: **담보 → 담보속성 종류(order) → 유효값(order) 오름차순.**
 *   담보가 1차 키라 같은 담보의 탑재분 뭉침은 정렬의 귀결. 미사용 속성은 사용한 것보다 앞.
 * - 한 그룹 = 한 보통약관 템플릿. MVP 는 상품 템플릿과 같아야 한다 (검증).
 */
import type { Id, Issue } from "../types";
import type { AttributeKind, ProductCoverage } from "./types";

/** 담보의 정렬 순서 — B1 담보 마스터의 순서(또는 이름순 등)를 주입. 없으면 담보 id 문자열 순. */
export type CoverageOrder = (coverageId: Id) => number;

export function sortInGroup<T extends ProductCoverage>(
  members: readonly T[],
  kinds: readonly AttributeKind[],
  coverageOrder?: CoverageOrder,
): T[] {
  const orderedKinds = [...kinds].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const valueOrder = (m: ProductCoverage, kind: AttributeKind): number => {
    const sel = m.attributes.find((s) => s.kindCode === kind.code);
    if (!sel) return -1; // 미사용 속성이 앞
    const v = kind.values.find((x) => x.code === sel.valueCode);
    return v ? v.order : Number.MAX_SAFE_INTEGER; // 깨진 값은 뒤
  };
  return [...members].sort((a, b) => {
    if (a.coverageId !== b.coverageId) {
      if (coverageOrder) {
        const d = coverageOrder(a.coverageId) - coverageOrder(b.coverageId);
        if (d !== 0) return d;
      }
      return a.coverageId.localeCompare(b.coverageId);
    }
    for (const kind of orderedKinds) {
      const d = valueOrder(a, kind) - valueOrder(b, kind);
      if (d !== 0) return d;
    }
    return a.id.localeCompare(b.id);
  });
}

/** 그룹 템플릿은 비우거나(상품 것을 따름) 상품 것과 같아야 한다. */
export function validateGroupTemplate(groupTemplateId: Id | undefined, productTemplateId: Id | undefined): Issue[] {
  if (groupTemplateId === undefined) return [];
  if (groupTemplateId === productTemplateId) return [];
  return [
    {
      kind: "typeMismatch",
      message: "한 그룹 = 한 보통약관 템플릿 — MVP 는 그룹의 템플릿이 상품의 템플릿과 같아야 합니다",
      at: { document: "product", refPath: groupTemplateId },
    },
  ];
}
