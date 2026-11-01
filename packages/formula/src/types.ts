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
 * The acting subject's held system capabilities — the
 * {@link EvalContext.systemPermissions} payload, and the only input
 * `hasCapability()` reads.
 *
 * **It is the published `/auth/me/permissions` shape, verbatim**: the
 * `systemPermissions` array of `GetEffectivePermissionsResponse`, the same list
 * the action gate checks an action's `requiredPermissions` against (ADR-0066
 * D4). A caller carries it in here unchanged.
 *
 * **A pure DATA list, never a resolver**, for the reason {@link EvalPermissions}
 * gives.
 */
export type EvalSystemPermissions = ReadonlyArray<string>;

/**
 * The option labels a reader reads, per field and per stored value — the
 * {@link EvalContext.optionLabels} payload, and the only input `label()` reads.
 *
 * Field name → (stored option value, as text → the label to show). One entry
 * per field of the record's object that declares options, already resolved in
 * the reader's locale by the caller. The caller resolves them the way the
 * object's metadata is served to that reader — its declared `options` with the
 * translation bundle laid over them (`translateObject`, `@objectstack/spec/system`)
 * — so a label here is the label the select control shows the same reader.
 *
 * **A pure DATA map, never a resolver**, for the reason {@link EvalPermissions}
 * gives: the stdlib may read pinned data and nothing else, so it is never
 * handed a translator. The locale decision is the caller's, made once, before
 * evaluation.
 */
export type EvalOptionLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

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
   * Locale (BCP-47 tag, e.g. `zh-CN`) the `template` dialect's formatters
   * render numbers, money, percents and dates in. Defaults to `en-US` when
   * unset or empty.
   *
   * A reserved channel, like {@link timezone}: it is NOT bound as a variable,
   * and nothing in {@link extra} or any other root sets it. A template's roots
   * are author-visible values (a bulk action's params, a flow's variables), so
   * a root named `locale` is just a value a hole can print — it used to also
   * set the formatter locale of the whole sentence (objectstack#26232). The
   * caller that knows the viewer's display locale passes it here.
   *
   * The `cel` dialect reads no locale. Its one locale-dependent function,
   * `label()`, reads {@link optionLabels}, which the caller resolved in the
   * reader's locale before evaluating — the stdlib holds data, never a
   * translator.
   */
  locale?: string;
  /**
   * The tenant default currency (an ISO 4217 code in three capitals, e.g.
   * `CNY`): the `localization.currency` setting, read the way a currency field
   * and a dashboard measure read it (`ExecutionContext.currency` on a request).
   * A `template` hole `{{ amount | currency }}` with no argument formats in it.
   *
   * A reserved channel, like {@link locale}: never bound as a variable, and no
   * root sets it. Unset (the tenant has no default, or the caller supplied
   * none) or not a three-capital code, a no-argument `currency` hole makes the
   * evaluation fail (`kind: 'runtime'`), naming the hole and the remedy: the
   * amount is never formatted in a currency nobody chose. A hole that names
   * its code (`currency:EUR`) does not read this.
   */
  currency?: string;
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
  /**
   * The acting subject's held system capabilities — see
   * {@link EvalSystemPermissions} for the shape and where it comes from.
   *
   * Read by exactly one binding, `current_user.hasCapability(name)`, and bound
   * only when {@link user} is also present, on the terms {@link permissions}
   * is: ⛔ NOT mounted as a CEL variable, so the function stays the only door.
   *
   * **Absent ≠ empty.** With no list at all `hasCapability()` THROWS
   * (`ok: false, kind: 'runtime'`) rather than answering; an EMPTY list is a
   * real answer (this subject holds no capability) and evaluates to `false`.
   */
  systemPermissions?: EvalSystemPermissions;
  /**
   * The option labels of the record's object, in the reader's locale — see
   * {@link EvalOptionLabels} for the shape and where it comes from.
   *
   * Read by exactly one binding, `label(record.<field>)`, which turns a select
   * field's stored value into the label a reader reads. ⛔ NOT mounted as a
   * CEL variable, on the terms {@link permissions} is.
   *
   * **Absent ≠ empty.** With no map at all `label()` THROWS
   * (`ok: false, kind: 'runtime'`): a context that was never given labels
   * cannot answer, and printing the stored value instead (`clean` where the
   * reader should read `清稿`) is the quiet wrong answer this function exists
   * to remove. A map that lacks the field means the field declares no
   * options, and `label()` throws for that too.
   */
  optionLabels?: EvalOptionLabels;
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
  /**
   * Source position when known: the range cel-js reports for the fault, as
   * UTF-16 offsets into the expression's `source` (`end` exclusive). Filled
   * for a cel-js parse, check or evaluation fault that carries a range, over
   * the author's text as written (#27904); absent for a fault with no range,
   * a non-CEL throw, or a source the engine rewrote before reading it.
   */
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
