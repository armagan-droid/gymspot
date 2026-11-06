import { ExpressionError } from "./error";

export type CompareOp = ">" | "<" | ">=" | "<=";

export type Token =
  | { type: "number"; value: number; raw: string; column: number }
  | { type: "ident"; value: string; column: number }
  | { type: "op"; value: CompareOp; column: number }
  | { type: "lparen" | "rparen" | "comma" | "colon" | "eof"; column: number };

const NUMBER = /^-?\d+(?:\.\d+)?/;
const IDENT = /^[a-z_][a-z0-9_]*/;

/**
 * Splits an expression into tokens. Anything outside the grammar in
 * specs/04 (quotes, '=', '.', '[', uppercase, …) is a hard error.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const column = i + 1;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      tokens.push({ type: "number", value: Number(num[0]), raw: num[0], column });
      i += num[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0], column });
      i += ident[0].length;
      continue;
    }
    if (ch === ">" || ch === "<") {
      const op = (src[i + 1] === "=" ? `${ch}=` : ch) as CompareOp;
      tokens.push({ type: "op", value: op, column });
      i += op.length;
      continue;
    }
    const single = { "(": "lparen", ")": "rparen", ",": "comma", ":": "colon" } as const;
    if (ch in single) {
      tokens.push({ type: single[ch as keyof typeof single], column });
      i++;
      continue;
    }
    throw new ExpressionError(`unexpected character '${ch}'`, column);
  }
  tokens.push({ type: "eof", column: src.length + 1 });
  return tokens;
}
