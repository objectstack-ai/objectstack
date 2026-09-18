/**
 * @objectstack/formula — public types
 *
 * The expression engine surface is intentionally minimal:
 *
 *  - {@link EvalContext}: input passed by call sites (hooks, seed loader, views).
 *  - {@link EvalResult}: discriminated union — never throws to the caller.
 *  - {@link DialectEngine}: contract any dialect (cel, cron, template) implements.
 *
 * The shape is shared across `cel`, `cron` and `template` so the kernel can
 * route any persisted `Expression` to the correct engine without conditional
 * logic.
 */

import type { Expression } from '@objectstack/spec';
import type { EffectiveObjectPermission } from '@objectstack/spec/security';

/**
 * The acting subject's effective object permissions, indexed by object name —
 * the {@link EvalContext.permissions} payload, and the only input `can()` reads.
 *
 * **It is the published `/auth/me/permissions` shape, verbatim**: the `objects`
 * map of `GetEffectivePermissionsResponse`, object name → the server-resolved
 * `EffectiveObjectPermission` for this subject. One contract, both ends — the
 * server already publishes it, a caller carries it in here unchanged, and
 * nothing re-derives, re-keys or re-shapes it on the way.
 *
 * **A pure DATA map, never a resolver.** ⛔ Not a callback, not a lazy getter,
 * not an object carrying methods: a function here would make evaluation depend
 * on something outside the context — both the "declared, never bound" shape
 * that cost `os.exists` / `os.count` / `os.lookup` their place on this
 * interface, and a breach of the purity invariant `stdlib.ts` documents, the
 * one that keeps `objectstack build` artifacts byte-stable across runs.
 *
 * **Completeness is the caller's promise.** `can()` reads an ABSENT object
 * entry as "no grant" — which is what an all-`false` entry means anyway — so a
 * partial map does not fault, it answers `false`. Pass the whole effective set
 * the endpoint returned, never a hand-picked subset.
 */
export type EvalPermissions = Readonly<Record<string, EffectiveObjectPermission>>;

/**
 * Runtime context for evaluating an expression.
 *
 * Every field is optional — call sites populate only what they have. The CEL
 * engine binds `record`, `previous`, `input`, `os` directly as top-level
 * variables when present.
 *
 * **It carries data, never a query API.** `buildScope()` binds exactly the
 * fields declared here, so an expression reads only what its call site already
 * passed in — reaching a row this context does not carry is outside the
 * contract. A kernel API (`os.exists` / `os.count` / `os.lookup`) was declared
 * here and never bound by `buildScope()`, and it is removed rather than
 * implemented because the harm came from the declaration existing, not from
 * the implementation missing: a predicate written to it faulted at runtime
 * (`found no matching overload for 'dyn.lookup(string, dyn)'`), and an
 * unevaluable predicate refuses the write it guards — so a validation rule
 * authored against the declaration locked every write on its object.
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
  /**
   * Current authenticated subject (hook / action / view contexts).
   *
   * ADR-0068: the canonical user contract is {@link EvalUser} from
   * `@objectstack/spec`, surfaced to predicates as `current_user` (aliases
   * `user`, `ctx.user`). `positions: string[]` is the only canonical membership field;
   * (the legacy singular's "overwritten to 'admin' on
   * promotion" behavior is the footgun ADR-0068 eliminates).
   */
  user?: {
    id: string;
    /** CANONICAL (ADR-0068, renamed ADR-0090 D3). Scope-resolved position names. */
    positions?: string[];
    /** Active organization ID (null = platform / unscoped). */
    organizationId?: string | null;
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
   * The acting subject's effective object permissions — see
   * {@link EvalPermissions} for the shape and where it comes from.
   *
   * Read by exactly one binding, `current_user.can(object, verb)`, and bound
   * only when {@link user} is also present: `can` is a question about the
   * acting subject, and this map is that subject's answer sheet. ⛔ It is NOT
   * mounted as a CEL variable — an authored predicate cannot read
   * `os.permissions.crm_lead.allowEdit` and reach around the verb vocabulary,
   * so the closed verb table stays the only door.
   *
   * **Absent ≠ empty.** With no map at all `can()` THROWS
   * (`ok: false, kind: 'runtime'`) rather than answering: a context that was
   * never given permission data cannot distinguish "denied" from "nobody
   * passed the data", and answering either way — `true` fail-open, or a silent
   * `false` — turns a wiring bug into a security verdict. An EMPTY map is a
   * real answer (this subject holds nothing) and evaluates to `false`.
   */
  permissions?: EvalPermissions;
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
