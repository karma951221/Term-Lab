/**
 * 헬스체크 — DB 배선이 실제로 살아있는지 확인한다.
 * PGlite 에 `SELECT 1` 을 날려 왕복이 되는지 본다.
 */
import { sql } from "drizzle-orm";

import { getDb, resolveDriver } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const driver = resolveDriver();

  try {
    const db = getDb();
    const result = await db.execute(sql`select 1 as ok`);
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? result;

    return Response.json({
      status: "ok",
      driver,
      db: rows,
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        driver,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
