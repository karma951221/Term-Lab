/**
 * 본문 평문의 조·항·호·별표 참조를 참조 슬롯 노드로 바꾼다 (개발 도구 — 제품 기능 아님).
 *
 * 규칙 (2026-09-07 실물 재현 설계 · ADR-0023):
 * - `제N조(제목)` · `제N조의M(제목)` → articleRef. 제목이 색인과 다르면 텍스트로 두고 보고한다.
 * - 「보통약관 」 접두가 붙으면 scope general (담보약관에서 보통약관 조). 접두는 덩어리당 한 번.
 * - `, ` · ` 및 ` · ` 또는 ` 로 이어진 참조는 한 슬롯(다중 대상 덩어리). 마지막 연결어가 슬롯의 connector.
 * - `제N조(…) 제M항 [제K호]` 는 그 조의 항·호. 조 없는 `제M항 [제K호]` 는 **현재 조**의 항·호.
 * - 법령 인용(「의료법 제3조(의료기관)」 「민법 제27조(실종의 선고)」)은 건드리지 않는다 — 직전 낱말이 「…법」.
 * - `【별표N(이름)】` → appendixRef (번호 → 코드 표). 이름은 마스터가 찍는다.
 */

import type { InlineNode } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

export interface ArticleEntry {
  id: Id;
  title: string;
  /** 항 id (순서대로). */
  paragraphIds: Id[];
  /** 항 id → 호 id (순서대로). */
  itemIds: Map<Id, Id[]>;
}

export interface ArticleIndex {
  /** 원문 번호(`"27"` · `"27의1"`) → 조. */
  byNumber: Map<string, ArticleEntry>;
}

export interface RefEnv {
  self: ArticleIndex;
  /** 담보약관이면 대응 보통약관 색인. 보통약관 자신이면 undefined. */
  general?: ArticleIndex;
  appendixByNumber: Map<number, string>;
  currentArticleId: Id;
  /** 변환하지 못한 참조 — 사람이 본다. */
  report: string[];
}

interface Piece {
  start: number;
  end: number;
  node: InlineNode;
}

const REF = /(보통약관 )?제(\d+)조(?:의(\d+))?\(((?:[^()]|\([^()]*\))*)\)(?: 제(\d+)항)?(?: 제(\d+)호)?/g;
const PARA = /제(\d+)항(?: 제(\d+)호)?/g;
const APX = /【별표(\d+)\(([^】]*)\)】/g;
/** 직전 텍스트가 「…법 」 「…법률 」 「…령 」 으로 끝나면 법령 인용이다. */
const LAW = /(법|법률|령)\s?$/;
const JOIN = /^(, | 및 | 또는 )(?=제\d+조)/;

const squash = (s: string) => s.replace(/\s+/g, "");

function resolveTarget(m: RegExpExecArray, index: ArticleIndex, env: RefEnv): Id | undefined {
  const number = m[3] ? `${m[2]}의${m[3]}` : m[2];
  const a = index.byNumber.get(number);
  if (!a) {
    env.report.push(`조 없음: ${m[0]}`);
    return undefined;
  }
  if (squash(a.title) !== squash(m[4])) {
    env.report.push(`조 제목 불일치: ${m[0]} ↔ 색인 「${a.title}」`);
    return undefined;
  }
  if (!m[5]) return a.id;
  const pid = a.paragraphIds[Number(m[5]) - 1];
  if (!pid) {
    env.report.push(`항 없음: ${m[0]}`);
    return undefined;
  }
  if (!m[6]) return pid;
  const iid = a.itemIds.get(pid)?.[Number(m[6]) - 1];
  if (!iid) {
    env.report.push(`호 없음: ${m[0]}`);
    return undefined;
  }
  return iid;
}

/** `text[from..]` 에서 REF 가 정확히 `from` 에서 시작하는 매치. */
function refAt(text: string, from: number): RegExpExecArray | null {
  const re = new RegExp(REF.source, "y");
  re.lastIndex = from;
  return re.exec(text);
}

export function inlinesFromText(text: string, env: RefEnv, newId: () => Id): InlineNode[] {
  const pieces: Piece[] = [];
  const covered = (pos: number) => pieces.some((p) => p.start <= pos && pos < p.end);

  for (const m of text.matchAll(APX)) {
    const code = env.appendixByNumber.get(Number(m[1]));
    if (!code) {
      env.report.push(`별표 ${m[1]} 코드 없음: ${m[0]}`);
      continue;
    }
    pieces.push({ start: m.index, end: m.index + m[0].length, node: { id: newId(), kind: "appendixRef", appendixCode: code } });
  }

  // 조 참조 덩어리: ref (JOIN ref)*
  let cursor = 0;
  while (cursor < text.length) {
    REF.lastIndex = cursor;
    const first = REF.exec(text);
    if (!first) break;
    const start = first.index;
    cursor = start + first[0].length;
    if (covered(start)) continue;
    if (LAW.test(text.slice(0, start))) continue;

    const scope = first[1] ? "general" : "self";
    const index = scope === "general" ? env.general : env.self;
    if (!index) {
      env.report.push(`보통약관 색인 없음: ${first[0]}`);
      continue;
    }
    const targets: { nodeId: Id }[] = [];
    let connector = "및";
    let end = start + first[0].length;
    let current: RegExpExecArray | null = first;
    let ok = true;
    while (current) {
      const t = resolveTarget(current, index, env);
      if (!t) {
        ok = false;
        break;
      }
      targets.push({ nodeId: t });
      end = current.index + current[0].length;
      const join = JOIN.exec(text.slice(end));
      if (!join) break;
      const next = refAt(text, end + join[0].length);
      if (!next || next[1]) break; // 다음 것이 「보통약관 」 접두를 새로 달면 새 덩어리
      if (join[1] !== ", ") connector = join[1].trim();
      current = next;
    }
    if (!ok) continue;
    pieces.push({ start, end, node: { id: newId(), kind: "articleRef", targets, connector, scope } });
    cursor = end;
  }

  // 조 없는 항·호 참조 — 현재 조
  for (const m of text.matchAll(PARA)) {
    if (covered(m.index)) continue;
    if (text.slice(0, m.index).endsWith(") ")) continue; // 「제N조(…) 제M항」 은 위에서 처리
    const here = [...env.self.byNumber.values()].find((a) => a.id === env.currentArticleId);
    const pid = here?.paragraphIds[Number(m[1]) - 1];
    if (!pid) {
      env.report.push(`항 참조 미해소: ${m[0]} (조 ${env.currentArticleId})`);
      continue;
    }
    let target = pid;
    if (m[2]) {
      const iid = here?.itemIds.get(pid)?.[Number(m[2]) - 1];
      if (!iid) {
        env.report.push(`호 참조 미해소: ${m[0]} (조 ${env.currentArticleId})`);
        continue;
      }
      target = iid;
    }
    pieces.push({ start: m.index, end: m.index + m[0].length, node: { id: newId(), kind: "articleRef", targets: [{ nodeId: target }], connector: "및", scope: "self" } });
  }

  pieces.sort((a, b) => a.start - b.start);
  const out: InlineNode[] = [];
  let pos = 0;
  for (const p of pieces) {
    if (p.start > pos) out.push({ id: newId(), kind: "text", text: text.slice(pos, p.start) });
    out.push(p.node);
    pos = p.end;
  }
  if (pos < text.length) out.push({ id: newId(), kind: "text", text: text.slice(pos) });
  return out;
}
