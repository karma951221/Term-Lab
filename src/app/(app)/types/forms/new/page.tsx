import Link from "next/link";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { StructCreateForm } from "@/app/_components/StructCreateForm";
import { ATTACH_LEVELS, type AttachLevel } from "@/domain/types";

import { createTypeFormAction } from "../../actions";

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; level?: string }> }) {
  const sp = await searchParams;
  const level = ATTACH_LEVELS.includes(sp.level as AttachLevel) ? sp.level as AttachLevel : "coverage";
  return <div>
    <p className="ts-back"><Link href="/types/forms">← 폼 목록</Link></p>
    <h2 className="ts-h1">새 폼</h2>
    <ErrorBanner message={sp.error} />
    <StructCreateForm action={createTypeFormAction} initialLabel={(sp.q ?? "").trim()} initialLevel={level} />
  </div>;
}
