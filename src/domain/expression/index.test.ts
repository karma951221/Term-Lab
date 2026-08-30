import { describe, expect, it } from "vitest";

import { isExpressionModuleReady } from "./index";

describe("expression 모듈 배선", () => {
  it("모듈을 import 하고 호출할 수 있다", () => {
    expect(isExpressionModuleReady()).toBe(true);
  });
});
