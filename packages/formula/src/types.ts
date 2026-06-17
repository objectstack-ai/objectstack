/**
 * @objectstack/formula — public types
 *
 * The expression engine surface is intentionally minimal:
 *
 *  - {@link EvalContext}: input passed by call sites (hooks, seed loader, views).
 *  - {@link EvalResult}: discriminated union — never throws to the caller.
 *  - {@link DialectEngine}: contract any dialect (cel, js, cron) implements.
 *
 * The shape is shared across `cel`, `js` and `cron` so the kernel can route
 * any persisted `Expression` to the correct engine without conditional logic.
 */

import type { Expression } from '@objectstack/spec';

/**
 * Runtime context for evaluating an expression.
 *
 * Every field is optional — call sites populate only what they have. The CEL
 * engine binds `record`, `previous`, `input`, `os` directly as top-level
 * variables when present.
 */
export interface EvalContext {
  /** Logical "now" snapshot — pinned per evaluation run for determinism. */
  now?: Date;
  /**
   * Reference timezone (IANA name, e.g. `America/New_York`) for calendar-day
   * functions `today()` / `daysFromNow()` / `daysAgo()` and for rendering
   * `datetime` template holes in that zone's wall-clock (ADR-0053 Phase 2).
   * Defaults to `UTC` when unset. Calendar-day `date` rendering stays tz-naive.
   */
  timezone?: string;
  /** Current authenticated subject (hook / action / view contexts). */
  user?: {
    id: string;
    role?: string;
    email?: string;
    [key: string]: unknown;
  };
  /** Current organization (multi-tenant context). */
  org?: {
    id: string;
    tier?: string;
    [key: string]: unknown;
  };
  /** Deployment environment marker. */
  env?: 'prod' | 'dev' | 'test' | string;
  /** Record-shaped data: target row, hook record, view row, etc. */
  record?: Record<string, unknown>;
  /** Previous record state for update hooks. */
  previous?: Record<string, unknown>;
  /** Action / flow input payload. */
  input?: Record<string, unknown>;
  /**
   * Optional kernel API for `os.exists / os.count / os.lookup`.
   * Implemented opportunistically by call sites that have a query engine.
   */
  api?: {
    exists?: (object: string, predicate: Expression) => boolean;
    count?: (object: string, predicate: Expression) => number;
    lookup?: (object: string, id: string) => Record<string, unknown> | null;
  };
  /** Free-form bag for niche call sites; merged onto the variable scope. */
  extra?: Record<string, unknown>;
}

/** Result of a single evaluation. Never throws; callers branch on `ok`. */
export type EvalResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: EvalError };

/** Structured error so AI callers can self-correct. */
export interface EvalError {
  /**
   * - `parse`     source string failed to parse to AST
   * - `type`      static type-check failed
   * - `runtime`   evaluation threw (division by zero, missing field, …)
   * - `bounds`    exceeded execution limits (AST size, depth, …)
   * - `dialect`   no engine registered for `expression.dialect`
   */
  kind: 'parse' | 'type' | 'runtime' | 'bounds' | 'dialect';
  message: string;
  /** Source position when known. */
  pos?: { start: number; end: number };
}

/** Contract every dialect engine implements. */
export interface DialectEngine {
  /** Dialect identifier — must match `Expression.dialect`. */
  readonly dialect: string;
  /**
   * Parse + type-check + emit AST. Source-only — `expression.ast` is what
   * actually gets persisted in `objectstack.json`.
   */
  compile(source: string): EvalResult<unknown>;
  /** Evaluate a fully-resolved expression in the given context. */
  evaluate<T = unknown>(expr: Expression, ctx: EvalContext): EvalResult<T>;
}
