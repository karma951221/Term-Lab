import { redirect } from "next/navigation";

import { currentActorOrNull } from "@/lib/services";

export const dynamic = "force-dynamic";

/** 루트 — 로그인 여부로 갈라 보낸다. 화면 없음(항상 redirect). */
export default async function Home() {
  const actor = await currentActorOrNull();
  redirect(actor ? "/catalog" : "/login");
}
