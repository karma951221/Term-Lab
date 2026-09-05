/** 관계정보 화면의 쿼리스트링 → RefNodeKey 파싱 — 순수 함수. `*.test.ts` 로 검증. */
import type { RefNodeKey } from "@/domain/refs";
import type { CoverageNodeLevel } from "@/domain/coverage";

export interface RelationQuery {
  kind?: string;
  code?: string;
  id?: string;
  level?: string;
  fieldCode?: string;
  valueCode?: string;
}

const COVERAGE_LEVELS: readonly string[] = ["coverage", "subCoverage", "benefit"];

/** 화면이 지원하는 실체 종류만 (구분자·필드·enum·enum값·공용조항·별표·담보 노드·담보속성(값)·상품·상품담보). */
export function parseRefTarget(q: RelationQuery): RefNodeKey | undefined {
  switch (q.kind) {
    case "discriminator":
      return q.code ? { kind: "discriminator", code: q.code } : undefined;
    case "field":
      return q.code && q.fieldCode ? { kind: "field", code: q.code, fieldCode: q.fieldCode } : undefined;
    case "enum":
      return q.code ? { kind: "enum", enumCode: q.code } : undefined;
    case "enumValue":
      return q.code && q.valueCode ? { kind: "enumValue", enumCode: q.code, valueCode: q.valueCode } : undefined;
    case "clause":
      return q.code ? { kind: "clause", code: q.code } : undefined;
    case "appendix":
      return q.code ? { kind: "appendix", code: q.code } : undefined;
    case "coverageNode":
      return q.level && COVERAGE_LEVELS.includes(q.level) && q.id ? { kind: "coverageNode", level: q.level as CoverageNodeLevel, id: q.id } : undefined;
    case "attribute":
      return q.code ? { kind: "attribute", code: q.code } : undefined;
    case "attributeValue":
      return q.code && q.valueCode ? { kind: "attributeValue", code: q.code, valueCode: q.valueCode } : undefined;
    case "product":
      return q.id ? { kind: "product", id: q.id } : undefined;
    case "productCoverage":
      return q.id ? { kind: "productCoverage", id: q.id } : undefined;
    case "document":
      return q.id ? { kind: "document", id: q.id } : undefined;
    default:
      return undefined;
  }
}
