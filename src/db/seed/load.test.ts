import { describe, expect, it } from "vitest";

import { alphaAppendices, alphaAttributeKinds, alphaBaseDocument, alphaCatalog, alphaClauses, alphaDeathDocument, alphaEnums, alphaGeneralDocument } from "@/domain/assembly/fixture";

import appendices from "./data/appendices.json";
import attributes from "./data/attributes.json";
import clauses from "./data/clauses.json";
import discriminators from "./data/discriminators.json";
import documents from "./data/documents.json";
import enums from "./data/enums.json";
import generals from "./data/generals.json";
import { loadAlphaPlus } from "./load";

describe("JSON 시드 정본", () => {
  it("도메인 관통 픽스처와 공통 데이터가 일치한다", () => {
    expect(enums.slice(0, alphaEnums.length)).toEqual(alphaEnums);
    expect(discriminators.slice(0, alphaCatalog.length)).toEqual(alphaCatalog);
    expect(attributes).toEqual(alphaAttributeKinds);
    expect(clauses).toEqual(alphaClauses);
    expect(appendices).toEqual(alphaAppendices);
    expect(generals[0]?.tree).toEqual(alphaGeneralDocument());
    expect(documents[0]?.tree).toEqual(alphaBaseDocument());
    expect(documents[1]?.tree).toEqual(alphaDeathDocument());
  });

  it("서비스 기반 로더를 공개한다", () => {
    expect(loadAlphaPlus).toBeTypeOf("function");
  });
});
