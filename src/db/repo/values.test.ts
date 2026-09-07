import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { entityAttachments } from "../schema";
import { createTestDb, type TestDb } from "../test-utils";
import {
  attach,
  copySlots,
  detach,
  listAttached,
  readSlots,
  valuesImpactSource,
  writeSlot,
  type ValueOwner,
} from "./values";

describe("entity_values — 실체 × 구분자 값 자리 (공용 값 저장소)", () => {
  let t: TestDb;
  const cov: ValueOwner = { kind: "coverage", id: "11111111-1111-4111-8111-111111111111" };
  const pc: ValueOwner = { kind: "productCoverage", id: "22222222-2222-4222-8222-222222222222" };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("값 자리는 쓰기 전엔 비어 있다 — 미입력은 행 없음이다", async () => {
    const slots = await readSlots(t.db, cov);
    expect(slots.size).toBe(0);
  });

  it("명시 입력한 값은 경로(구분자.필드)로 읽힌다", async () => {
    await writeSlot(t.db, cov, "D0001", "F01", true);
    await writeSlot(t.db, cov, "D0002", undefined, 50);
    const slots = await readSlots(t.db, cov);
    expect(slots.get("D0001.F01")).toEqual({ entered: true, value: true });
    expect(slots.get("D0002")).toEqual({ entered: true, value: 50 });
  });

  it("같은 자리에 다시 쓰면 덮어쓴다 (행 1개 유지)", async () => {
    await writeSlot(t.db, cov, "D0001", "F01", false);
    const slots = await readSlots(t.db, cov);
    expect(slots.get("D0001.F01")).toEqual({ entered: true, value: false });
    expect(slots.size).toBe(2);
  });

  it("값 지우기 = 행 삭제 → 다시 미입력", async () => {
    await writeSlot(t.db, cov, "D0002", undefined, undefined);
    const slots = await readSlots(t.db, cov);
    expect(slots.has("D0002")).toBe(false);
  });

  it("탑재 스냅샷: 한 소유자의 값 자리를 다른 소유자로 복사한다 (미입력은 복사할 게 없다)", async () => {
    await writeSlot(t.db, cov, "D0002", undefined, 70);
    const copied = await copySlots(t.db, cov, pc);
    expect(copied).toBe(2);
    const slots = await readSlots(t.db, pc);
    expect(slots.get("D0001.F01")).toEqual({ entered: true, value: false });
    // 이후 마스터 변경은 스냅샷에 영향 없음
    await writeSlot(t.db, cov, "D0002", undefined, 99);
    expect((await readSlots(t.db, pc)).get("D0002")).toEqual({ entered: true, value: 70 });
  });

  it("영향 계산: 구분자·필드·enum 값 단위로 값 행을 세고 지운다", async () => {
    await writeSlot(t.db, cov, "D0009", undefined, "V02");
    await writeSlot(t.db, pc, "D0009", undefined, "V01");
    const src = valuesImpactSource(t.db);
    expect(await src.countValueRows({ kind: "discriminator", code: "D0001" })).toBe(2);
    expect(await src.countValueRows({ kind: "field", code: "D0001", fieldCode: "F01" })).toBe(2);
    expect(await src.countValueRows({ kind: "enumValue", enumCode: "E0001", valueCode: "V02" })).toBe(0); // enum 정의 없음
    await src.purgeValueRows({ kind: "discriminator", code: "D0001" });
    expect((await readSlots(t.db, cov)).has("D0001.F01")).toBe(false);
    expect((await readSlots(t.db, pc)).has("D0001.F01")).toBe(false);
    expect((await readSlots(t.db, pc)).has("D0002")).toBe(true);
  });

  it("선택적 노출 부착은 (실체, 구분자) 관계로 남는다 — 부착·해제·조회", async () => {
    await attach(t.db, cov, "D0005");
    await attach(t.db, cov, "D0005"); // 멱등
    await attach(t.db, cov, "D0006");
    expect(await listAttached(t.db, cov)).toEqual(["D0005", "D0006"]);
    await detach(t.db, cov, "D0005");
    expect(await listAttached(t.db, cov)).toEqual(["D0006"]);
  });

  it("부착 목록은 createdAt 이 같아도 구분자 코드 순으로 안정 정렬된다", async () => {
    // PGlite 는 인프로세스라 연속 삽입이 같은 createdAt 을 받는 일이 잦다(측정 82%).
    // 그때 tiebreaker 가 무작위 id 면 순서가 매번 뒤집힌다 — 코드 순으로 고정한다.
    const owner: ValueOwner = { kind: "coverage", id: "33333333-3333-4333-8333-333333333333" };
    const createdAt = new Date("2026-09-08T00:00:00.000Z");
    const codes = ["D0008", "D0003", "D0006", "D0001", "D0009", "D0004", "D0007", "D0002"];
    await t.db
      .insert(entityAttachments)
      .values(codes.map((discriminatorCode) => ({ ownerKind: owner.kind, ownerId: owner.id, discriminatorCode, createdAt })));
    expect(await listAttached(t.db, owner)).toEqual([...codes].sort());
  });

});
