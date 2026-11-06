import type { Expr, ValueNode } from "./parse";

/** Metric names referenced by an expression. */
export function collectMetrics(expr: Expr): Set<string> {
  const out = new Set<string>();
  const value = (v: ValueNode) => {
    if (v.kind === "metric") out.add(v.name);
    else if (v.kind === "call") v.args.forEach(value);
  };
  const walk = (e: Expr) => {
    if (e.kind === "compare") {
      value(e.left);
      value(e.right);
    } else if (e.kind === "not") {
      walk(e.operand);
    } else {
      walk(e.left);
      walk(e.right);
    }
  };
  walk(expr);
  return out;
}
