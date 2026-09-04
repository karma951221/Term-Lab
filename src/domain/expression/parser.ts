/**
 * 식 언어 파서 — 손으로 쓴 재귀하강 (외부 의존성 없음).
 *
 * 문법 (docs/03_설계/식언어.md):
 *   expr     := or
 *   or       := and ('or' and)*
 *   and      := compare ('and' compare)*
 *   compare  := unary (cmpOp unary)?          — 연쇄 불가
 *   unary    := 'not' unary | primary
 *   primary  := literal | aggregate | ref | '(' expr ')'
 *   aggregate:= aggOp '(' path ')'
 *   path     := ident | ident '.' ident | 'builtin' '.' level '.' ident | 'attr' '.' ident
 *
 * 담보속성(attr) 제약(ADR-0015)은 문법 차원에서 건다 — 파서를 통과한 AST 에는
 * `exist/notexist(attr.X)` 와 `attr.X = / ≠ '문자열'` 두 형태만 남는다.
 */

import { ATTACH_LEVELS, reject, ok } from "../types";
import type { AttachLevel, Coordinate, Issue, Result } from "../types";
import { AGGREGATE_OPS } from "./ast";
import type { AggregateOp, CompareOp, Expr, Ref } from "./ast";

// ───────────────────────────── 예약어 ─────────────────────────────

/** 구분자 코드로 쓸 수 없는 단어. 모두 소문자·대소문자 구분. */
export const RESERVED_WORDS: readonly string[] = [
  "and",
  "or",
  "not",
  "true",
  "false",
  ...AGGREGATE_OPS,
  "attr",
  "builtin",
];

const RESERVED = new Set<string>(RESERVED_WORDS);
const AGGREGATES = new Set<string>(AGGREGATE_OPS);
const LEVELS = new Set<string>(ATTACH_LEVELS);

// ───────────────────────────── 토큰 ─────────────────────────────

type Token =
  | { type: "ident"; text: string; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "number"; value: number; pos: number }
  | { type: "date"; value: string; pos: number }
  | { type: "op"; text: CompareOp; pos: number }
  | { type: "punct"; text: "(" | ")" | "."; pos: number }
  | { type: "eof"; pos: number };

/** 문법 오류. 파서 내부에서만 던지고 `parse` 가 Result 로 바꾼다. */
class SyntaxFailure extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

/** 식별자 시작 문자: 영문·밑줄·한글(자모·음절). 숫자는 두 번째 글자부터. */
const IDENT_START = /[A-Za-z_ㄱ-ㆎ가-힣]/;
const IDENT_PART = /[A-Za-z0-9_ㄱ-ㆎ가-힣]/;
const DIGIT = /[0-9]/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  /** `'...'` 를 읽는다. i 는 여는 따옴표 위치. 닫는 따옴표 다음 위치를 돌려준다. */
  const readString = (start: number): { value: string; end: number } => {
    let j = start + 1;
    let out = "";
    while (j < src.length) {
      const ch = src[j];
      if (ch === "\\") {
        const next = src[j + 1];
        if (next === "'" || next === "\\") {
          out += next;
          j += 2;
          continue;
        }
        throw new SyntaxFailure(`문자열 안의 이스케이프는 \\' 와 \\\\ 만 허용합니다`, j);
      }
      if (ch === "'") return { value: out, end: j + 1 };
      out += ch;
      j += 1;
    }
    throw new SyntaxFailure("문자열이 닫히지 않았습니다", start);
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ".") {
      tokens.push({ type: "punct", text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "'") {
      const { value, end } = readString(i);
      tokens.push({ type: "string", value, pos: i });
      i = end;
      continue;
    }
    // 날짜 리터럴 d'YYYY-MM-DD'
    if (ch === "d" && src[i + 1] === "'") {
      const { value, end } = readString(i + 1);
      if (!isValidDate(value)) {
        throw new SyntaxFailure(`날짜 리터럴은 d'YYYY-MM-DD' 형식의 실재하는 날짜여야 합니다: '${value}'`, i);
      }
      tokens.push({ type: "date", value, pos: i });
      i = end;
      continue;
    }
    // 숫자 (음수 포함 — 산술이 없으므로 '-' 뒤 숫자는 항상 리터럴)
    if (DIGIT.test(ch) || (ch === "-" && src[i + 1] !== undefined && DIGIT.test(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && DIGIT.test(src[j])) j += 1;
      if (src[j] === "." && src[j + 1] !== undefined && DIGIT.test(src[j + 1])) {
        j += 1;
        while (j < src.length && DIGIT.test(src[j])) j += 1;
      }
      tokens.push({ type: "number", value: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && IDENT_PART.test(src[j])) j += 1;
      tokens.push({ type: "ident", text: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // 비교 연산자
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=") {
      tokens.push({ type: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if (two === "!=") {
      tokens.push({ type: "op", text: "≠", pos: i });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "≠" || ch === "<" || ch === ">") {
      tokens.push({ type: "op", text: ch, pos: i });
      i += 1;
      continue;
    }
    throw new SyntaxFailure(`알 수 없는 문자 '${ch}'`, i);
  }
  tokens.push({ type: "eof", pos: src.length });
  return tokens;
}

// ───────────────────────────── 파서 ─────────────────────────────

class Parser {
  private idx = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.idx];
  }

  private next(): Token {
    const t = this.tokens[this.idx];
    this.idx += 1;
    return t;
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.text === word;
  }

  private expectPunct(text: "(" | ")" | "."): void {
    const t = this.next();
    if (t.type !== "punct" || t.text !== text) {
      throw new SyntaxFailure(`'${text}' 가 필요합니다`, t.pos);
    }
  }

  parseExpr(): Expr {
    const expr = this.parseOr();
    const t = this.peek();
    if (t.type !== "eof") {
      throw new SyntaxFailure(`식 끝에 해석되지 않는 토큰이 남았습니다: ${describe(t)}`, t.pos);
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      this.next();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseCompare();
    while (this.isKeyword("and")) {
      this.next();
      const right = this.parseCompare();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseCompare(): Expr {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.type !== "op") {
      assertNotBareAttribute(left, t.pos);
      return left;
    }
    this.next();
    const right = this.parseUnary();
    const after = this.peek();
    if (after.type === "op") {
      throw new SyntaxFailure("비교는 연쇄할 수 없습니다 (a = b = c). 괄호와 and 로 나누세요", after.pos);
    }
    checkAttributeCompare(left, t.text, right, t.pos);
    return { kind: "compare", op: t.text, left, right };
  }

  private parseUnary(): Expr {
    if (this.isKeyword("not")) {
      const t = this.next();
      const operand = this.parseUnary();
      assertNotBareAttribute(operand, t.pos);
      return { kind: "not", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.type) {
      case "string":
        return { kind: "literal", literal: { type: "string", value: t.value } };
      case "number":
        return { kind: "literal", literal: { type: "number", value: t.value } };
      case "date":
        return { kind: "literal", literal: { type: "date", value: t.value } };
      case "punct":
        if (t.text === "(") {
          const inner = this.parseOr();
          const close = this.peek();
          if (close.type !== "punct" || close.text !== ")") {
            throw new SyntaxFailure("')' 가 필요합니다", close.pos);
          }
          this.next();
          assertNotBareAttribute(inner, t.pos);
          return inner;
        }
        throw new SyntaxFailure(`예상치 못한 '${t.text}'`, t.pos);
      case "op":
        throw new SyntaxFailure(`연산자 '${t.text}' 앞에 피연산자가 없습니다`, t.pos);
      case "eof":
        throw new SyntaxFailure("식이 끝나기 전에 피연산자가 필요합니다", t.pos);
      case "ident":
        return this.parseIdentStart(t);
    }
  }

  private parseIdentStart(t: Token & { type: "ident" }): Expr {
    if (t.text === "true" || t.text === "false") {
      return { kind: "literal", literal: { type: "boolean", value: t.text === "true" } };
    }
    if (AGGREGATES.has(t.text)) {
      const op = t.text as AggregateOp;
      const open = this.peek();
      if (open.type !== "punct" || open.text !== "(") {
        throw new SyntaxFailure(`'${op}' 는 예약어(집계)라 코드로 쓸 수 없습니다 — ${op}(경로) 형태여야 합니다`, t.pos);
      }
      this.next();
      const ref = this.parsePath("집계 인자는 참조 경로여야 합니다");
      const close = this.peek();
      if (close.type !== "punct" || close.text !== ")") {
        throw new SyntaxFailure(
          `집계 인자는 참조 경로 하나여야 합니다 — ')' 자리에 ${describe(close)}`,
          close.pos,
        );
      }
      this.next();
      if (ref.kind === "attr" && op !== "exist" && op !== "notexist") {
        throw new SyntaxFailure(
          `담보속성 attr.${ref.code} 는 exist·notexist 에만 쓸 수 있습니다 (${op} 불가)`,
          t.pos,
        );
      }
      return { kind: "aggregate", op, ref };
    }
    if (t.text === "not" || t.text === "and" || t.text === "or") {
      throw new SyntaxFailure(`'${t.text}' 는 예약어라 피연산자 자리에 올 수 없습니다`, t.pos);
    }
    this.idx -= 1;
    const ref = this.parsePath("참조 경로가 필요합니다");
    return { kind: "ref", ref };
  }

  /** ident ('.' ident)* 를 읽어 Ref 로. 세그먼트 수·네임스페이스 규칙은 여기서. */
  private parsePath(whatIfNotIdent: string): Ref {
    const first = this.next();
    if (first.type !== "ident") {
      throw new SyntaxFailure(`${whatIfNotIdent} (${describe(first)})`, first.pos);
    }
    if (RESERVED.has(first.text) && first.text !== "attr" && first.text !== "builtin") {
      throw new SyntaxFailure(
        `${whatIfNotIdent} — '${first.text}' 는 예약어라 코드로 쓸 수 없습니다`,
        first.pos,
      );
    }
    const segments: string[] = [first.text];
    while (this.peek().type === "punct" && (this.peek() as { text: string }).text === ".") {
      this.next();
      const seg = this.next();
      if (seg.type !== "ident") {
        throw new SyntaxFailure("'.' 뒤에는 코드가 와야 합니다", seg.pos);
      }
      segments.push(seg.text);
    }
    return toRef(segments, first.pos);
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case "ident":
      return `'${t.text}'`;
    case "string":
      return `'${t.value}'`;
    case "number":
      return String(t.value);
    case "date":
      return `d'${t.value}'`;
    case "op":
    case "punct":
      return `'${t.text}'`;
    case "eof":
      return "식의 끝";
  }
}

function toRef(segments: string[], pos: number): Ref {
  const [head] = segments;
  if (head === "attr") {
    if (segments.length !== 2) {
      throw new SyntaxFailure("담보속성 경로는 attr.<속성종류코드> 두 단계입니다", pos);
    }
    assertCode(segments[1], pos);
    return { kind: "attr", code: segments[1] };
  }
  if (head === "builtin") {
    if (segments.length !== 3) {
      throw new SyntaxFailure("내장 경로는 builtin.<레벨>.<속성> 세 단계입니다", pos);
    }
    if (!LEVELS.has(segments[1])) {
      throw new SyntaxFailure(
        `내장 경로의 레벨은 ${ATTACH_LEVELS.join("·")} 중 하나여야 합니다: '${segments[1]}'`,
        pos,
      );
    }
    return { kind: "builtin", level: segments[1] as AttachLevel, prop: segments[2] };
  }
  if (segments.length > 2) {
    throw new SyntaxFailure(
      "구분자 경로는 <구분자코드> 또는 <구분자코드>.<필드코드> 두 단계까지입니다",
      pos,
    );
  }
  for (const s of segments) assertCode(s, pos);
  return segments.length === 1
    ? { kind: "discriminator", code: segments[0] }
    : { kind: "discriminator", code: segments[0], field: segments[1] };
}

function assertCode(text: string, pos: number): void {
  if (RESERVED.has(text)) {
    throw new SyntaxFailure(`'${text}' 는 예약어라 코드로 쓸 수 없습니다`, pos);
  }
}

/** 담보속성 참조가 비교 LHS 나 exist 밖에 홀로 서면 오류. */
function assertNotBareAttribute(expr: Expr, pos: number): void {
  if (expr.kind === "ref" && expr.ref.kind === "attr") {
    throw new SyntaxFailure(
      `담보속성 attr.${expr.ref.code} 는 exist(attr.X) · attr.X = '값' · attr.X ≠ '값' 형태로만 쓸 수 있습니다`,
      pos,
    );
  }
}

/** 담보속성 비교 규칙 (ADR-0015): LHS 만, = / ≠ 만, RHS 는 문자열 리터럴만. */
function checkAttributeCompare(left: Expr, op: CompareOp, right: Expr, pos: number): void {
  if (right.kind === "ref" && right.ref.kind === "attr") {
    throw new SyntaxFailure(
      `담보속성 attr.${right.ref.code} 는 비교의 왼쪽에만 올 수 있습니다`,
      pos,
    );
  }
  if (left.kind !== "ref" || left.ref.kind !== "attr") return;
  if (op !== "=" && op !== "≠") {
    throw new SyntaxFailure(`담보속성 비교는 = 와 ≠ 만 허용합니다 ('${op}' 불가)`, pos);
  }
  if (right.kind !== "literal" || right.literal.type !== "string") {
    throw new SyntaxFailure(
      `담보속성 비교의 오른쪽은 유효값 문자열 리터럴('값')만 허용합니다`,
      pos,
    );
  }
}

// ───────────────────────────── 진입점 ─────────────────────────────

/**
 * 소스 문자열 → AST. 문법 오류는 `Rejection{reason:'invalid', issues:[{kind:'syntax'}]}`.
 * 오류 메시지에 0-기반 문자 위치가 들어간다. `coordinate` 는 Issue 의 좌표로 그대로 실린다.
 */
export function parse(src: string, coordinate: Coordinate = {}): Result<Expr> {
  try {
    if (src.trim() === "") throw new SyntaxFailure("빈 식입니다", 0);
    const tokens = tokenize(src);
    return ok(new Parser(tokens).parseExpr());
  } catch (e) {
    if (e instanceof SyntaxFailure) {
      const issue: Issue = {
        kind: "syntax",
        message: `문법 오류 (위치 ${e.pos}): ${e.message}`,
        at: { ...coordinate },
      };
      return reject({ reason: "invalid", issues: [issue] });
    }
    throw e;
  }
}
