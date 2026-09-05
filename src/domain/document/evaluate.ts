/**
 * 부분 사전평가 (도메인모델 §3 · 문면_기획 「사전평가」 · ADR-0003).
 *
 * 문맥(`EvalContext`)이 채워지는 만큼만 평가한다 — 담보약관 편집 문맥은 B1 의 `masterEvalContext` 가 만든다
 * (담보 레벨 = 마스터 값, 상품 레벨·담보속성 = 미결). 보통약관 문맥은 담보 레벨까지 미결 (ADR-0011).
 *
 * 결과는 데이터뿐이다 — 톤다운·전체 뷰 토글은 화면 몫.
 *   - 가지 상태: taken(탐) · notTaken(안 탐 → 톤다운) · undetermined(미결 — 톤다운 아님) · error(미입력 등, 좌표 있는 이슈)
 *   - 조건 노드 안 가지는 순서대로: 앞 가지가 taken 이면 뒤는 notTaken, 앞이 미결·오류면 뒤는 undetermined.
 *   - 톤다운된 가지 안의 중첩 조건도 독립적으로 평가한다 (톤다운은 잠금이 아니다 — 사전평가 S4).
 *   - 슬롯: 값 · 미결 · 오류.
 */

import { evaluate, parse } from "../expression";
import type { EvalContext, EvalResult } from "../expression";
import type { Coordinate, Id, Issue, Value } from "../types";
import { coordinateOf, indexTree, type DocumentNode } from "./nodes";
import type { BranchState } from "./numbering";

export interface BranchEvaluation {
  state: BranchState;
  /** 미결을 일으킨 참조 경로 (undetermined). */
  reason?: string;
  /** 오류 (error). */
  issue?: Issue;
}

export type SlotEvaluation =
  | { kind: "value"; value: Value }
  | { kind: "undetermined"; reason: string }
  | { kind: "error"; issue: Issue };

export interface PreEvaluation {
  /** 가지 id → 상태. */
  branches: Map<Id, BranchEvaluation>;
  /** 슬롯 노드 id → 값. */
  slots: Map<Id, SlotEvaluation>;
  /** 평가 중 난 오류 전부 (좌표 포함). */
  issues: Issue[];
}

export interface PreEvaluateOptions {
  /** 좌표 기본값. 없으면 `ctx.coordinate`. */
  coordinate?: Coordinate;
}

/** 문맥에 좌표만 바꿔 얹는다 (메서드 바인딩 보존). */
function at(ctx: EvalContext, coordinate: Coordinate): EvalContext {
  return {
    lookup: (ref) => ctx.lookup(ref),
    attribute: (code) => ctx.attribute(code),
    children: (ref) => ctx.children(ref),
    coordinate,
  };
}

function run(src: string, ctx: EvalContext, coordinate: Coordinate): EvalResult {
  const parsed = parse(src, coordinate);
  if (!parsed.ok) {
    const issue: Issue =
      parsed.rejection.reason === "invalid" && parsed.rejection.issues[0]
        ? parsed.rejection.issues[0]
        : { kind: "syntax", message: "식을 읽을 수 없습니다", at: coordinate };
    return { kind: "error", issue };
  }
  return evaluate(parsed.value, at(ctx, coordinate));
}

export function preEvaluate(doc: DocumentNode, ctx: EvalContext, opts: PreEvaluateOptions = {}): PreEvaluation {
  const base = opts.coordinate ?? ctx.coordinate ?? {};
  const ix = indexTree(doc, base);
  const branches = new Map<Id, BranchEvaluation>();
  const slots = new Map<Id, SlotEvaluation>();
  const issues: Issue[] = [];

  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind === "condBlock" || n.kind === "inlineCond") {
      // open: 아직 탄 가지 없음 · closed: 앞에서 탐 · unknown: 앞이 미결/오류
      let mode: "open" | "closed" | "unknown" = "open";
      let reason = "";
      for (const br of n.branches) {
        const be = ix.branches.get(br.id);
        const coordinate = be ? coordinateOf(ix, be, base) : { ...base, nodePath: [...e.path, br.id] };
        if (mode === "closed") {
          branches.set(br.id, { state: "notTaken" });
          continue;
        }
        if (mode === "unknown") {
          branches.set(br.id, { state: "undetermined", reason });
          continue;
        }
        if (br.when === undefined) {
          branches.set(br.id, { state: "taken" });
          mode = "closed";
          continue;
        }
        const r = run(br.when, ctx, coordinate);
        if (r.kind === "error") {
          branches.set(br.id, { state: "error", issue: r.issue });
          issues.push(r.issue);
          mode = "unknown";
          reason = r.issue.at.refPath ?? "error";
        } else if (r.kind === "undetermined") {
          branches.set(br.id, { state: "undetermined", reason: r.reason });
          mode = "unknown";
          reason = r.reason;
        } else if (typeof r.value !== "boolean") {
          const issue: Issue = { kind: "typeMismatch", message: `조건식의 결과가 boolean 이 아닙니다 (${typeof r.value})`, at: coordinate };
          branches.set(br.id, { state: "error", issue });
          issues.push(issue);
          mode = "unknown";
          reason = "typeMismatch";
        } else if (r.value) {
          branches.set(br.id, { state: "taken" });
          mode = "closed";
        } else {
          branches.set(br.id, { state: "notTaken" });
        }
      }
    } else if (n.kind === "slot") {
      const coordinate = coordinateOf(ix, e, base);
      const r = run(n.ref, ctx, coordinate);
      if (r.kind === "error") {
        slots.set(n.id, { kind: "error", issue: r.issue });
        issues.push(r.issue);
      } else if (r.kind === "undetermined") {
        slots.set(n.id, { kind: "undetermined", reason: r.reason });
      } else {
        slots.set(n.id, { kind: "value", value: r.value });
      }
    }
  }
  return { branches, slots, issues };
}
