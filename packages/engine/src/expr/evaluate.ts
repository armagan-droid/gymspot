import type { Expr, ValueNode } from "./parse";

/** true / false, or undefined when the answer depends on an unknown value. */
export type Truth = boolean | undefined;

/**
 * Evaluates an AST with three-valued (Kleene) logic: a missing or NaN metric
 * makes its comparison unknown, and an unknown result must be treated as
 * "condition not met" by callers, so uncertain data never raises a fault
 * (specs/04 "Bilinmeyen değer", specs/05).
 */
export function evaluate(expr: Expr, values: Readonly<Record<string, number>>): Truth {
  switch (expr.kind) {
    case "compare": {
      const l = valueOf(expr.left, values);
      const r = valueOf(expr.right, values);
      if (Number.isNaN(l) || Number.isNaN(r)) return undefined;
      switch (expr.op) {
        case ">":
          return l > r;
        case "<":
          return l < r;
        case ">=":
          return l >= r;
        case "<=":
          return l <= r;
      }
      break;
    }
    case "not": {
      const v = evaluate(expr.operand, values);
      return v === undefined ? undefined : !v;
    }
    case "and": {
      const l = evaluate(expr.left, values);
      if (l === false) return false;
      const r = evaluate(expr.right, values);
      if (r === false) return false;
      return l === undefined || r === undefined ? undefined : true;
    }
    case "or": {
      const l = evaluate(expr.left, values);
      if (l === true) return true;
      const r = evaluate(expr.right, values);
      if (r === true) return true;
      return l === undefined || r === undefined ? undefined : false;
    }
  }
}

function valueOf(node: ValueNode, values: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "metric": {
      // Own properties only: "constructor" etc. must not resolve to prototype members.
      const v = Object.hasOwn(values, node.name) ? values[node.name] : undefined;
      return typeof v === "number" ? v : NaN;
    }
    case "call": {
      const args = node.args.map((a) => valueOf(a, values));
      switch (node.fn) {
        case "abs":
          return Math.abs(args[0]!);
        case "avg":
          return args.reduce((s, x) => s + x, 0) / args.length;
        case "min":
          return Math.min(...args);
        case "max":
          return Math.max(...args);
      }
    }
  }
}
