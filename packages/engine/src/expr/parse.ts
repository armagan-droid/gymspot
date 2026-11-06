import { CHECK_POSITIONS, type CheckPosition } from "@gymspot/shared";
import { ExpressionError } from "./error";
import { type CompareOp, type Token, tokenize } from "./tokenize";

// Recursive-descent parser for the rule pack expression language (specs/04 "İfade dili").
// Produces a plain AST; nothing is ever compiled to or executed as JavaScript.

export const FUNCTION_NAMES = ["abs", "avg", "min", "max"] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];

export type ValueNode =
  | { kind: "number"; value: number }
  | { kind: "metric"; name: string }
  | { kind: "call"; fn: FunctionName; args: ValueNode[] };

export type Expr =
  | { kind: "or" | "and"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  | { kind: "compare"; op: CompareOp; left: ValueNode; right: ValueNode };

export interface ParseOptions {
  /** Defined metric names. When given, references to anything else are errors. */
  metrics?: ReadonlySet<string>;
}

const KEYWORDS = new Set(["and", "or", "not", "for", "ms"]);

export function parseExpression(src: string, options: ParseOptions = {}): Expr {
  const p = new Parser(tokenize(src), options);
  const expr = p.expr();
  p.expectEnd();
  return expr;
}

export function parseCheck(src: string, options: ParseOptions = {}): { position: CheckPosition; expr: Expr } {
  const p = new Parser(tokenize(src), options);
  const head = p.next();
  if (head.type !== "ident" || !(CHECK_POSITIONS as readonly string[]).includes(head.value)) {
    throw new ExpressionError(`check must start with one of ${CHECK_POSITIONS.join(", ")}`, head.column);
  }
  p.expect("colon", "':' after check position");
  const expr = p.expr();
  p.expectEnd();
  return { position: head.value as CheckPosition, expr };
}

export function parseReadyPose(src: string, options: ParseOptions = {}): { expr: Expr; durationMs: number } {
  const p = new Parser(tokenize(src), options);
  const expr = p.expr();
  p.expectKeyword("for");
  const n = p.next();
  if (n.type !== "number" || !/^\d+$/.test(n.raw) || n.value <= 0) {
    throw new ExpressionError("expected a positive integer duration", n.column);
  }
  p.expectKeyword("ms");
  p.expectEnd();
  return { expr, durationMs: n.value };
}

class Parser {
  private i = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly options: ParseOptions,
  ) {}

  peek(): Token {
    return this.tokens[this.i]!;
  }

  next(): Token {
    const t = this.tokens[this.i]!;
    if (t.type !== "eof") this.i++;
    return t;
  }

  expect(type: Token["type"], what: string): Token {
    const t = this.next();
    if (t.type !== type) throw new ExpressionError(`expected ${what}`, t.column);
    return t;
  }

  expectKeyword(word: string): void {
    const t = this.next();
    if (t.type !== "ident" || t.value !== word) throw new ExpressionError(`expected '${word}'`, t.column);
  }

  expectEnd(): void {
    const t = this.peek();
    if (t.type === "op") throw new ExpressionError("comparisons cannot be chained", t.column);
    if (t.type !== "eof") throw new ExpressionError("unexpected input", t.column);
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value === word;
  }

  // expr = and_expr { "or" and_expr }
  expr(): Expr {
    let left = this.and();
    while (this.isKeyword("or")) {
      this.next();
      left = { kind: "or", left, right: this.and() };
    }
    return left;
  }

  // and_expr = not_expr { "and" not_expr }
  private and(): Expr {
    let left = this.not();
    while (this.isKeyword("and")) {
      this.next();
      left = { kind: "and", left, right: this.not() };
    }
    return left;
  }

  // not_expr = "not" not_expr | "(" expr ")" | compare
  private not(): Expr {
    if (this.isKeyword("not")) {
      this.next();
      return { kind: "not", operand: this.not() };
    }
    if (this.peek().type === "lparen") {
      this.next();
      const inner = this.expr();
      this.expect("rparen", "')'");
      return inner;
    }
    return this.compare();
  }

  // compare = value op value
  private compare(): Expr {
    const left = this.value();
    const op = this.next();
    if (op.type !== "op") throw new ExpressionError("expected a comparison operator", op.column);
    const right = this.value();
    return { kind: "compare", op: op.value, left, right };
  }

  // value = NUMBER | METRIC | func "(" value { "," value } ")"
  private value(): ValueNode {
    const t = this.next();
    if (t.type === "number") return { kind: "number", value: t.value };
    if (t.type !== "ident") throw new ExpressionError("expected a number, metric or function", t.column);
    if (KEYWORDS.has(t.value)) throw new ExpressionError(`unexpected keyword '${t.value}'`, t.column);

    if (this.peek().type === "lparen") {
      if (!(FUNCTION_NAMES as readonly string[]).includes(t.value)) {
        throw new ExpressionError(`unknown function '${t.value}'`, t.column);
      }
      this.next();
      const args = [this.value()];
      while (this.peek().type === "comma") {
        this.next();
        args.push(this.value());
      }
      this.expect("rparen", "')'");
      const fn = t.value as FunctionName;
      if (fn === "abs" && args.length !== 1) throw new ExpressionError("abs takes exactly 1 argument", t.column);
      return { kind: "call", fn, args };
    }

    if (this.options.metrics && !this.options.metrics.has(t.value)) {
      throw new ExpressionError(`unknown metric '${t.value}'`, t.column);
    }
    return { kind: "metric", name: t.value };
  }
}
