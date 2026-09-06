/**
 * 문면 저작 화면 (L3) — 목차(조만) · 명조 본문 · 모드에 종속된 우측 패널 (디자인원칙 §2 L3 · 리뷰 #43).
 *
 * 모드는 쿼리(`?mode=edit`)로 나른다 — 전부 서버 렌더다. 클라이언트 상태를 두지 않는다.
 *   - 읽기 : 조작 없음. 우측은 사전평가/미리보기.
 *   - 편집 : 행 오른쪽 끝 아이콘 버튼 + 고른 자리(`?node=`)의 폼이 우측에.
 * 파괴적 조작(`?confirm=<노드 id>`)은 무엇이 함께 사라지는지 세어 보여준 뒤에만 실행된다 (§9.5 · 리뷰 #33).
 */
import Link from "next/link";

import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconCheck, IconClose, IconEdit } from "@/app/_components/icons";
import { DOC_KIND_LABEL } from "@/app/_lib/labels";
import { previewOutcome } from "@/app/_lib/rejection";
import { masterCatalog, masterEvalContext } from "@/domain/coverage";
import { indexTree, referenceTargetIndex, type BranchEvaluation, type ReferenceTarget, type SlotEvaluation } from "@/domain/document";
import type { Code, Coordinate, Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { removeDocumentAction, removeNodeAction } from "../actions";
import { DocBody } from "./_components/DocBody";
import type { DocCtx, DocMode } from "./_components/ctx";
import { cascadeOf, internalReferrers, subtreeIds } from "./_components/loss";
import { SidePanel, type PanelData } from "./_components/SidePanel";
import { Toc, articlesOf } from "./_components/Toc";

export const dynamic = "force-dynamic";

interface Query {
  error?: string;
  del?: string;
  view?: string;
  mode?: string;
  node?: string;
  art?: string;
  confirm?: string;
}

const NODE_WHAT: Record<string, string> = {
  article: "조",
  paragraph: "항",
  item: "호",
  subitem: "목",
  text: "문장",
  slot: "치환 슬롯",
  inlineCond: "문장 안 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항 참조",
  clauseInlineRef: "공용조항 참조",
  articleRef: "조 참조 슬롯",
  appendixRef: "별표 참조 슬롯",
};

export default async function DocumentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const doc = await services.document.get(id);
  if (!doc) {
    return (
      <div style={{ padding: 20 }}>
        <h1 className="ts-h1">문면</h1>
        <p className="ts-error-banner">찾을 수 없습니다.</p>
        <p>
          <Link href="/documents">← 목록으로</Link>
        </p>
      </div>
    );
  }
  const actor = await currentActor();
  const mode: DocMode = sp.mode === "edit" ? "edit" : "read";

  const linkTo = (patch: Record<string, string | undefined>): string => {
    const q = new URLSearchParams();
    const base: Record<string, string | undefined> = { mode: sp.mode, view: sp.view, node: sp.node, art: sp.art, ...patch };
    for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  const [appendices, clauses, discriminators, issues, generalSummaries] = await Promise.all([
    services.document.listAppendices(),
    services.clause.list(),
    services.catalog.list(),
    services.document.validate(id),
    services.document.list("general"),
  ]);

  const slotCandidates = discriminators.flatMap((def) => {
    if (def.kind === "const") return [{ path: def.code, label: def.label }];
    if (def.kind === "scalar" && (def.type.kind === "string" || def.type.kind === "enum")) return [{ path: def.code, label: def.label }];
    if (def.kind === "struct") {
      return def.fields
        .filter((field) => field.type.kind === "string" || field.type.kind === "enum")
        .map((field) => ({ path: `${def.code}.${field.code}`, label: `${def.label}.${field.label}` }));
    }
    return [];
  });

  // ── 사전평가 (읽기 모드의 「미리보기」) ────────────────────────────────────
  let branchEval: Map<Id, BranchEvaluation> | undefined;
  let slotEval: Map<Id, SlotEvaluation> | undefined;
  let evalNote: string | undefined;
  const evalAvailable = doc.kind === "special" && doc.ownerId !== undefined;
  if (!evalAvailable) evalNote = "보통약관은 담보 레벨 문맥이 없어 여기서 평가하지 않는다 (ADR-0011).";
  if (sp.view === "eval" && evalAvailable) {
    const mv = await services.coverage.masterValues(doc.ownerId!);
    if (mv.ok) {
      const ctxEval = masterEvalContext(mv.value.tree, mv.value.values, masterCatalog(discriminators));
      const pre = await services.document.preEvaluate(id, ctxEval);
      branchEval = pre.branches;
      slotEval = pre.slots;
    } else {
      evalNote = "담보 마스터 값을 읽지 못했다.";
    }
  }

  const numbers = await services.document.numbering(id, branchEval);
  const generalDocument = doc.kind === "special" && doc.generalDocumentId ? await services.document.get(doc.generalDocumentId) : undefined;
  const generalNumbers = generalDocument ? await services.document.numbering(generalDocument.id) : new Map();
  const references = {
    self: referenceTargetIndex(doc.tree, numbers),
    general: generalDocument ? referenceTargetIndex(generalDocument.tree, generalNumbers) : new Map<Id, ReferenceTarget>(),
  };

  // ── 표시명 해소 ──────────────────────────────────────────────────────────
  const appendixName = new Map(appendices.map((a) => [a.code, a.name] as const));
  const clauseLabel = new Map(clauses.map((c) => [c.code, c.label] as const));
  const optionText = (clauseCode: Code, options: Record<Code, Code>): string => {
    const clause = clauses.find((c) => c.code === clauseCode);
    const entries = Object.entries(options);
    if (!clause) return entries.length > 0 ? entries.map(([o, v]) => `${o}: ${v}`).join(" · ") : "옵션 선택 없음";
    const parts = clause.options.map((o) => {
      const chosen = options[o.code];
      const value = chosen !== undefined ? o.values.find((v) => v.code === chosen) : undefined;
      return `${o.label}: ${value?.label ?? (chosen !== undefined ? `${chosen}(없는 선택지)` : "미선택")}`;
    });
    return parts.length > 0 ? parts.join(" · ") : "옵션 없음";
  };

  // ── 대응 보통약관 제안 (#4) — 이 담보를 탑재한 상품이 실제로 쓰는 템플릿 ──
  let suggestedGeneralId: Id | undefined;
  if (doc.kind === "special" && doc.generalDocumentId === undefined && doc.ownerId) {
    const products = await services.product.listProducts();
    for (const p of products) {
      if (!p.generalDocumentId) continue;
      const pcs = await services.product.listProductCoverages(p.id);
      if (pcs.some((pc) => pc.coverageId === doc.ownerId)) {
        suggestedGeneralId = p.generalDocumentId;
        break;
      }
    }
  }

  const index = indexTree(doc.tree);
  const articles = articlesOf(doc.tree);
  const selectedEntry = sp.node ? index.nodes.get(sp.node) : undefined;
  const selectedBranch = sp.node ? index.branches.get(sp.node) : undefined;
  const currentArticleId = sp.art ?? selectedEntry?.articleId ?? selectedBranch?.articleId;

  const ctx: DocCtx = {
    documentId: id,
    docKind: doc.kind,
    mode,
    ...(sp.node ? { selectedId: sp.node } : {}),
    numbers,
    ...(branchEval ? { branchEval } : {}),
    ...(slotEval ? { slotEval } : {}),
    appendixName,
    clauseLabel,
    optionText,
    references,
    linkTo,
  };

  // ── 노드 삭제 확인 (#33) ─────────────────────────────────────────────────
  let confirmNode = null;
  if (sp.confirm) {
    const entry = index.nodes.get(sp.confirm);
    if (!entry) {
      confirmNode = <p className="ts-error-banner">지우려는 자리를 찾을 수 없다 — 이미 사라졌을 수 있다.</p>;
    } else {
      const num = numbers.get(entry.node.id);
      const ordinal = num && ["paragraph", "item", "subitem"].includes(entry.node.kind) ? `제${num.n}` : "";
      const what = entry.node.kind === "article" ? `${num?.label ?? "조"}(${(entry.node as { title: string }).title})` : `${ordinal}${NODE_WHAT[entry.node.kind] ?? entry.node.kind}`.trim();
      const targets = subtreeIds(entry.node);
      const brokenRefs: Coordinate[] = internalReferrers(doc.tree, targets).map((r) => ({
        document: doc.kind,
        ownerId: doc.ownerId ?? doc.id,
        ownerName: doc.title,
        ...(r.articleId ? { articleId: r.articleId, articleTitle: articles.find((a) => a.id === r.articleId)?.title } : {}),
        nodeKind: r.what === "조연결" ? "articleRef" : "articleRef",
      }));
      if (entry.node.kind === "article") {
        // 문서 밖에서 이 조를 가리키는 참조(조연결 · 보통약관 조 참조)까지 관계정보에서 센다.
        const outside = await services.refs.usages({ kind: "article", documentId: id, articleId: entry.node.id });
        for (const e of outside) if (e.at.ownerId !== (doc.ownerId ?? doc.id)) brokenRefs.push(e.at);
      }
      confirmNode = (
        <Confirm
          impact={{ valueRowsLost: 0, cascade: cascadeOf(entry.node), brokenRefs }}
          action={removeNodeAction.bind(null, id, entry.node.id)}
          targetLabel={what}
          actionLabel={`${what} 삭제`}
          cancelHref={linkTo({ confirm: undefined })}
        />
      );
    }
  }

  // ── 문서 삭제 확인 (기존 경로 유지) ──────────────────────────────────────
  let deleteDocNode = null;
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.document.remove(actor, id));
    deleteDocNode =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={removeDocumentAction.bind(null, id)}
          targetLabel={`문면 ${doc.title}`}
          actionLabel={`${doc.title} 삭제`}
          cancelHref={linkTo({ del: undefined })}
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  const panel: PanelData = {
    tree: doc.tree,
    index,
    appendices,
    clauses,
    slotCandidates,
    generals: generalSummaries.filter((g) => g.id !== id).map((g) => ({ id: g.id, title: g.title })),
    ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}),
    ...(suggestedGeneralId ? { suggestedGeneralId } : {}),
    issues,
    documentTitle: doc.title,
    ...(branchEval ? { branchEval } : {}),
    evalRan: branchEval !== undefined,
    evalAvailable,
    ...(evalNote ? { evalNote } : {}),
    ...(branchEval ? { rendered: <DocBody tree={doc.tree} ctx={{ ...ctx, mode: "read" }} /> } : {}),
  };

  return (
    // 바는 자기 높이만, 나머지 한 줄이 남는 높이를 먹는다 — 열·행 모두 globals.css 의 .ts-l3 가 정한다.
    // L3 는 전폭 화면이다 — `.ts-main:has(> .ts-l3)`(globals.css)가 공통 레이아웃의 최대폭·패딩을 여기서만 푼다.
    <div className="ts-l3">
      <div className="ts-l3-bar">
        <strong style={{ color: "var(--ts-ink)" }}>{doc.title}</strong>
        <span>{DOC_KIND_LABEL[doc.kind]}</span>
        <span className="ts-count" title="이 문면의 규모와, 저장 검증이 잡은 문제 수">
          조 <b>{articles.length}</b> · 검증 오류 <b>{issues.length}</b> / 노드 {index.nodes.size}
        </span>
        <Link href="/documents">← 문면 목록</Link>
        <span className="ts-l3-bar-actions">
          {mode === "edit" ? (
            <>
              <Link
                className="ts-iconbtn"
                href={linkTo({ mode: undefined, node: undefined, confirm: undefined })}
                title="편집 취소 — 아직 저장 버튼을 누르지 않은 입력은 버리고 읽기 모드로 돌아간다"
                aria-label="편집 취소"
              >
                <IconClose />
              </Link>
              <Link
                className="ts-iconbtn"
                href={linkTo({ mode: undefined, node: undefined, confirm: undefined })}
                title="편집 마치기 — 저장한 변경을 그대로 두고 읽기 모드로 돌아간다"
                aria-label="편집 마치기"
              >
                <IconCheck />
              </Link>
            </>
          ) : (
            <Link className="ts-iconbtn" href={linkTo({ mode: "edit", view: undefined })} title={`${doc.title} 편집 — 조·항 조작과 편집 폼이 나타난다`} aria-label="편집">
              <IconEdit />
            </Link>
          )}
        </span>
      </div>

      <Toc articles={articles} numbers={numbers} {...(currentArticleId ? { currentArticleId } : {})} linkTo={linkTo} />

      <div className="ts-l3-body">
        <ErrorBanner message={sp.error} />
        {sp.del === "1" && deleteDocNode}
        <datalist id="slot-candidates">
          {slotCandidates.map((candidate) => (
            <option key={candidate.path} value={candidate.path}>
              {candidate.label}
            </option>
          ))}
        </datalist>
        <DocBody tree={doc.tree} ctx={ctx} />
      </div>

      <SidePanel ctx={ctx} data={panel} {...(confirmNode ? { confirm: confirmNode } : {})} />
    </div>
  );
}
