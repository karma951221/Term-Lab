import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { countEnumValueRows, listAllAttachments, purgeEnumValueRows } from "./refs";
import { attach, readSlots, writeSlot } from "./values";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("repo/refs — 부착 전체 목록 · enum 값 행 집계/삭제", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await attach(t.db, { kind: "coverage", id: P1 }, "D0002");
    await attach(t.db, { kind: "product", id: P2 }, "D0007");
    // D0002 (scalar enum) · D0003.F01 (list<enum>) · D0009 (enum 아님 — 같은 코드가 우연히 있어도 자리 밖)
    await writeSlot(t.db, { kind: "product", id: P1 }, "D0002", undefined, "V02");
    await writeSlot(t.db, { kind: "product", id: P2 }, "D0002", undefined, "V01");
    await writeSlot(t.db, { kind: "benefit", id: P1 }, "D0003", "F01", ["V01", "V02"]);
    await writeSlot(t.db, { kind: "benefit", id: P2 }, "D0003", "F01", ["V02"]);
    await writeSlot(t.db, { kind: "product", id: P1 }, "D0009", undefined, "V02");
  });
  afterAll(async () => {
    await t.close();
  });

  it("부착 관계 전부 — 소유자 종류·id·코드", async () => {
    expect(await listAllAttachments(t.db)).toEqual([
      { owner: { kind: "coverage", id: P1 }, discriminatorCode: "D0002" },
      { owner: { kind: "product", id: P2 }, discriminatorCode: "D0007" },
    ]);
  });

  it("그 값을 고른 행만 센다 — scalar 는 값 일치, list<enum> 은 원소 포함, 자리 밖 행은 제외", async () => {
    const slots = [
      { discriminatorCode: "D0002", fieldCode: "", list: false },
      { discriminatorCode: "D0003", fieldCode: "F01", list: true },
    ];
    expect(await countEnumValueRows(t.db, slots, "V02")).toBe(3);
    expect(await countEnumValueRows(t.db, slots, "V01")).toBe(2);
    expect(await countEnumValueRows(t.db, [], "V02")).toBe(0);
  });

  it("연쇄 삭제 — scalar 행 삭제 · 배열에서 원소 제거 · 빈 배열이 되면 행 삭제(미입력)", async () => {
    const slots = [
      { discriminatorCode: "D0002", fieldCode: "", list: false },
      { discriminatorCode: "D0003", fieldCode: "F01", list: true },
    ];
    await purgeEnumValueRows(t.db, slots, "V02");
    expect(await countEnumValueRows(t.db, slots, "V02")).toBe(0);
    expect((await readSlots(t.db, { kind: "product", id: P1 })).get("D0002")).toBeUndefined();
    expect((await readSlots(t.db, { kind: "product", id: P2 })).get("D0002")).toEqual({ entered: true, value: "V01" });
    expect((await readSlots(t.db, { kind: "benefit", id: P1 })).get("D0003.F01")).toEqual({ entered: true, value: ["V01"] });
    expect((await readSlots(t.db, { kind: "benefit", id: P2 })).get("D0003.F01")).toBeUndefined();
    // 자리 밖 행은 건드리지 않는다
    expect((await readSlots(t.db, { kind: "product", id: P1 })).get("D0009")).toEqual({ entered: true, value: "V02" });
  });
});
