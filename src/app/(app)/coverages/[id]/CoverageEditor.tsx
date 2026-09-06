"use client";

/**
 * 담보 상세 — 헤더(편집 흐름) + 탭 넷 (담보_화면기획 §1).
 *
 * - 탭은 **객체(층) 단위**로 가른다. 한 객체의 필드를 탭으로 쪼개지 않는다.
 * - **탭을 옮겨도 편집 모드와 변경분이 유지**된다 — 그래서 탭은 링크가 아니라 클라이언트 상태다.
 *   URL `?tab=` 은 history.replaceState 로 따라만 간다 (내비게이션이 나면 초안이 날아간다).
 * - 저장 하나가 네 탭의 변경을 다 담는다. 변경이 있는 탭 이름에 점(•).
 * - **구조(세부보장 · 급부의 추가 · 삭제 · 순서)는 여기 없다** — 담보를 만들 때 정한다 (2026-09-06 확정).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { IconButton, IconTrash } from "@/app/_components/icons";
import type { CoverageNodeLevel, CoverageNodeRef } from "@/domain/coverage";
import type { NodeCompleteness } from "@/services/coverage";
import { StructForm, type FormModel, type Submission } from "@/forms";

import { createSpecialDocumentAction } from "../actions";
import { attachEditAction, detachEditAction, removeCoverageEditAction, saveCoverageEditAction } from "../edit-actions";
import type { CoverageEditData } from "../edit-types";
import { encodeNodeKey } from "../lib";

export interface EditorNode {
  key: string;
  level: CoverageNodeLevel;
  id: string;
  name: string;
  /** 세부보장이면 급부 수. 트리에 「급부 N」으로 선다. */
  benefitCount?: number;
  /** 형제 중 순번 (1부터). 담보 자신은 없다. */
  order?: number;
  /** 급부의 소속 세부보장 이름 — 급부 탭 왼쪽 목록을 「세부보장 › 급부」로 묶는다. */
  parentName?: string;
}

export interface EditorForm {
  code: string;
  label: string;
  alwaysExposed: boolean;
  model: FormModel;
}

export interface CoverageEditorProps {
  id: string;
  initial: CoverageEditData;
  nodes: EditorNode[];
  byNode: NodeCompleteness[];
  formsByNode: Record<string, EditorForm[]>;
  attachableByNode: Record<string, { code: string; label: string }[]>;
  usageCount: number;
  documentId?: string;
  /** 담보속성 유효값 표시명 — 담보명에 섞이면 경고한다 (Q-C: 경고까지, 거부 아님). */
  attributeValueLabels: string[];
  /** 처음 열 탭 — 서버가 `?tab=` 을 읽어 넘긴다. 이후 전환은 클라이언트 상태다. */
  initialTab?: string;
}

type Tab = "basic" | CoverageNodeLevel;

const TAB_LABEL: Record<Tab, string> = { basic: "기본", coverage: "담보", subCoverage: "세부보장", benefit: "급부" };
const TABS: Tab[] = ["basic", "coverage", "subCoverage", "benefit"];

function isTab(value: string | undefined): value is Tab {
  return value === "basic" || value === "coverage" || value === "subCoverage" || value === "benefit";
}

// ───────────────────────────── 기본 탭 ─────────────────────────────

/** 구조 트리 — 들여쓰기 + 순번. 읽기 전용이고, 편집 모드에서 이름만 인라인 입력이 된다. */
function StructureTree({ nodes, onPick }: { nodes: EditorNode[]; onPick: (node: EditorNode) => void }) {
  const label = useEditField<string>("label");
  const names = useEditField<Record<string, string>>("names");
  const subs = nodes.filter((n) => n.level === "subCoverage");
  const nameOf = (node: EditorNode) => names.value[node.key] ?? node.name;
  const setName = (node: EditorNode, value: string) => names.setValue({ ...names.value, [node.key]: value });

  return (
    <section className="ts-tree-block">
      <h2 className="ts-h2">
        구조
        <InfoTip text="구조(세부보장 · 급부의 추가 · 삭제 · 순서)는 담보를 만들 때 정한다." />
      </h2>
      <ul className="ts-tree">
        <li>
          <div className="ts-tree-row">
            {label.mode === "read" ? <span className="ts-tree-name">{label.value}</span> : <input value={label.value} onChange={(e) => label.setValue(e.target.value)} className="ts-field-direct ts-tree-input" aria-label="담보명" />}
          </div>
          <ul className="ts-tree">
            {subs.map((sub) => {
              const benefits = nodes.filter((n) => n.level === "benefit" && n.parentName === sub.name);
              return (
                <li key={sub.key}>
                  <div className="ts-tree-row">
                    <span className="ts-tree-num">{sub.order}</span>
                    {names.mode === "read" ? (
                      <button type="button" className="ts-tree-name ts-linklike" onClick={() => onPick(sub)}>{nameOf(sub)}</button>
                    ) : (
                      <input value={nameOf(sub)} onChange={(e) => setName(sub, e.target.value)} className="ts-field-direct ts-tree-input" aria-label={`세부보장명 · ${sub.name}`} />
                    )}
                    <span className="ts-count">급부 <b>{sub.benefitCount}</b></span>
                  </div>
                  <ul className="ts-tree">
                    {benefits.map((benefit) => (
                      <li key={benefit.key}>
                        <div className="ts-tree-row">
                          <span className="ts-tree-num">{benefit.order}</span>
                          {names.mode === "read" ? (
                            <button type="button" className="ts-tree-name ts-linklike" onClick={() => onPick(benefit)}>{nameOf(benefit)}</button>
                          ) : (
                            <input value={nameOf(benefit)} onChange={(e) => setName(benefit, e.target.value)} className="ts-field-direct ts-tree-input" aria-label={`급부명 · ${benefit.name}`} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </li>
      </ul>
    </section>
  );
}

function BasicTab({ coverageId, nodes, usageCount, documentId, attributeValueLabels, onPick }: { coverageId: string; nodes: EditorNode[]; usageCount: number; documentId?: string; attributeValueLabels: string[]; onPick: (node: EditorNode) => void }) {
  const label = useEditField<string>("label");
  // Q-C — 담보속성은 상품에 탑재할 때 정한다. 경고까지만 하고 저장은 막지 않는다 (거부 아님).
  // 「기본계약」이 「기본」에 먼저 걸리지 않게 긴 값부터 본다. 이름을 고치는 자리에서만 띄운다.
  const hit =
    label.mode === "edit"
      ? [...attributeValueLabels].sort((a, b) => b.length - a.length).find((value) => value && label.value.includes(value))
      : undefined;

  return (
    <div className="ts-detail-split">
      <div className="ts-detail-main">
        <Field name="label" label="담보명" />
        {hit ? <p className="ts-warn">담보명에 담보속성 값이 들어 있다 — 「{hit}」. 담보속성은 상품에 탑재할 때 정하므로 담보명에서 빼는 것이 좋다.</p> : null}
        <Field name="description" label="설명" type="textarea" />
      </div>
      <dl className="ts-detail-side">
        <dt>사용처</dt>
        <dd>
          탑재 상품담보 <b>{usageCount}</b>
          <InfoTip text="마스터 값을 고쳐도 이미 탑재된 상품담보의 값에는 소급되지 않는다 (ADR-0002)." />
        </dd>
        <dt>문면</dt>
        <dd>
          {documentId ? (
            <Link href={`/documents/${documentId}`}>담보약관 열기 →</Link>
          ) : label.mode === "edit" ? (
            <form action={createSpecialDocumentAction.bind(null, coverageId)} className="ts-inline-form">
              <input type="text" name="title" placeholder="문면 제목" defaultValue={`${label.value} 특별약관`} />
              <button type="submit">문면 생성</button>
            </form>
          ) : (
            <span className="ts-muted">없음</span>
          )}
        </dd>
      </dl>
      <div className="ts-detail-full">
        <StructureTree nodes={nodes} onPick={onPick} />
      </div>
    </div>
  );
}

// ───────────────────────────── 값 탭 ─────────────────────────────

function ValueTab({ level, nodes, byNode, formsByNode, attachableByNode, selected, onSelect }: {
  level: CoverageNodeLevel;
  nodes: EditorNode[];
  byNode: NodeCompleteness[];
  formsByNode: Record<string, EditorForm[]>;
  attachableByNode: Record<string, { code: string; label: string }[]>;
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  const values = useEditField<Record<string, Submission>>("values");
  const levelNodes = nodes.filter((n) => n.level === level);
  const current = levelNodes.find((n) => n.key === selected) ?? levelNodes[0];
  const countOf = (key: string) => byNode.find((c) => encodeNodeKey(c.node.level, c.node.id) === key);

  if (!current) return <p className="ts-form-empty">이 층에 노드가 없다.</p>;

  const forms = formsByNode[current.key] ?? [];
  const attachable = attachableByNode[current.key] ?? [];
  const owner: CoverageNodeRef = { level: current.level, id: current.id };

  const body = (
    <div className="ts-detail-main">
      <h2 className="ts-h2">{current.name} — 값</h2>
      {forms.length === 0 ? (
        <p className="ts-form-empty">이 층에 묻는 값이 없다.</p>
      ) : (
        forms.map((form) => (
          <div key={form.code} id={`def-${form.code}`} className="ts-value-block">
            <StructForm
              model={form.model}
              embedded
              readOnly={values.mode === "read"}
              onChange={(submission) => {
                const next = { ...values.value, [current.key]: submission };
                values.setValue(next);
              }}
            />
            {values.mode === "edit" && !form.alwaysExposed ? (
              <DetachButton owner={owner} code={form.code} label={form.label} />
            ) : null}
          </div>
        ))
      )}
      {values.mode === "edit" && attachable.length > 0 ? (
        <div className="ts-panel">
          <h2 className="ts-form-title">부착 가능</h2>
          {attachable.map((def) => (
            <AttachButton key={def.code} owner={owner} code={def.code} label={def.label} />
          ))}
        </div>
      ) : null}
    </div>
  );

  // 담보 탭은 노드가 하나(담보 자신)라 왼쪽 열이 없다.
  if (level === "coverage") return body;

  return (
    <div className="ts-node-split">
      <ul className="ts-node-list">
        {levelNodes.map((node) => {
          const count = countOf(node.key);
          return (
            <li key={node.key}>
              <button type="button" onClick={() => onSelect(node.key)} aria-current={node.key === current.key ? "true" : undefined}>
                <span className="ts-tree-num">{node.order}</span>
                <span className="ts-node-name">{node.parentName ? `${node.parentName} › ${node.name}` : node.name}</span>
                <span className="ts-count">{count ? `${count.entered} / ${count.total}` : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {body}
    </div>
  );
}

function AttachButton({ owner, code, label }: { owner: CoverageNodeRef; code: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <>
      <button type="button" disabled={pending} onClick={() => start(async () => {
        const result = await attachEditAction(owner, code);
        if (result.ok === true) { setError(""); router.refresh(); } else if (result.ok === false) setError(result.message);
      })}>+ {label}</button>
      {error ? <span className="ts-error">{error}</span> : null}
    </>
  );
}

function DetachButton({ owner, code, label }: { owner: CoverageNodeRef; code: string; label: string }) {
  const [outcome, setOutcome] = useState<{ valueRowsLost: number } | undefined>();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (confirm = false) => start(async () => {
    const result = await detachEditAction(owner, code, confirm);
    if (result.ok === "confirm") { setOutcome({ valueRowsLost: result.impact.valueRowsLost }); return; }
    if (result.ok === false) { setError(result.message); setOutcome(undefined); return; }
    setOutcome(undefined); setError(""); router.refresh();
  });
  return (
    <p className="ts-detach">
      <IconButton icon={<IconTrash />} label={`부착 해제 · ${label}`} danger disabled={pending} onClick={() => run()} />
      {error ? <span className="ts-error">{error}</span> : null}
      {outcome ? (
        <dialog open className="ts-dialog">
          <p className="ts-confirm-title">부착 해제 · {label}</p>
          <ul className="ts-confirm-loss"><li>사람이 입력한 값 {outcome.valueRowsLost}건이 사라진다</li></ul>
          <div className="ts-confirm-actions">
            <button type="button" onClick={() => setOutcome(undefined)} disabled={pending}>취소</button>
            <button type="button" className="danger" onClick={() => run(true)} disabled={pending}>부착 해제</button>
          </div>
        </dialog>
      ) : null}
    </p>
  );
}

// ───────────────────────────── 탭 + 껍데기 ─────────────────────────────

function Tabs(props: Omit<CoverageEditorProps, "id"> & { coverageId: string }) {
  const { coverageId, nodes, byNode, formsByNode, attachableByNode, usageCount, documentId, attributeValueLabels, initial, initialTab } = props;
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "basic");
  const [selected, setSelected] = useState<Record<CoverageNodeLevel, string | undefined>>({ coverage: undefined, subCoverage: undefined, benefit: undefined });
  const label = useEditField<string>("label");
  const description = useEditField<string>("description");
  const names = useEditField<Record<string, string>>("names");
  const values = useEditField<Record<string, Submission>>("values");

  // URL 은 따라만 간다 — router 로 옮기면 서버 컴포넌트가 다시 그려져 초안이 날아간다.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "basic") url.searchParams.delete("tab"); else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, [tab]);

  const basicDirty =
    label.value !== initial.label ||
    description.value !== initial.description ||
    nodes.some((n) => names.value[n.key] !== undefined && names.value[n.key] !== n.name);
  const dirtyOf = (candidate: Tab): boolean => {
    if (candidate === "basic") return basicDirty;
    return nodes.some((n) => n.level === candidate && values.value[n.key] !== undefined);
  };

  const pick = (node: EditorNode) => {
    setSelected((current) => ({ ...current, [node.level]: node.key }));
    setTab(node.level);
  };

  return (
    <>
      <nav className="ts-subtabs" aria-label="담보 상세 탭">
        {TABS.map((candidate) => (
          <button key={candidate} type="button" aria-current={candidate === tab ? "page" : undefined} onClick={() => setTab(candidate)}>
            {TAB_LABEL[candidate]}
            {dirtyOf(candidate) ? <span className="ts-dot" aria-label="변경됨">•</span> : null}
          </button>
        ))}
      </nav>
      {tab === "basic" ? (
        <BasicTab coverageId={coverageId} nodes={nodes} usageCount={usageCount} documentId={documentId} attributeValueLabels={attributeValueLabels} onPick={pick} />
      ) : (
        <ValueTab
          level={tab}
          nodes={nodes}
          byNode={byNode}
          formsByNode={formsByNode}
          attachableByNode={attachableByNode}
          selected={selected[tab]}
          onSelect={(key) => setSelected((current) => ({ ...current, [tab]: key }))}
        />
      )}
    </>
  );
}

export function CoverageEditor(props: CoverageEditorProps) {
  const { id, initial, ...rest } = props;
  return (
    <EditShell
      initial={initial}
      title={initial.label}
      backHref="/coverages"
      backLabel="담보 목록"
      saveAction={saveCoverageEditAction.bind(null, id)}
      deleteAction={removeCoverageEditAction.bind(null, id)}
      deleteLabel={`${initial.label} 삭제`}
      deleteTooltip={`담보 ${initial.label} 삭제`}
      deleteSuccessHref="/coverages"
      headerMeta={<span className="ts-count">탑재 상품담보 <b>{rest.usageCount}</b></span>}
    >
      <Tabs {...rest} initial={initial} coverageId={id} />
    </EditShell>
  );
}
