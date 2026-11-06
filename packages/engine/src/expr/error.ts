export class ExpressionError extends Error {
  constructor(
    readonly reason: string,
    /** 1-based column in the source expression. */
    readonly column: number,
  ) {
    super(`${reason} (column ${column})`);
    this.name = "ExpressionError";
  }
}
