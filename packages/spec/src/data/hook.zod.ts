// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Hook Lifecycle Events
 * Defines the interception points in the ObjectQL execution pipeline.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { HookBodySchema } from './hook-body.zod';
// Type-only, and it must stay that way: `contracts/` already imports `data/`
// (`contracts/data-engine.ts`), so a VALUE import here would close a runtime
// cycle. `import type` is erased, leaving the edge in the type graph only.
import type { IScopedContext } from '../contracts/scoped-context';

/*
 * ── Unknown-key strictness (#4001 data step) ────────────────────────────────
 *
 * {@link HookSchema} (the AUTHORING shape) and its `retryPolicy` block are
 * `.strict()`. `hook` is a registered metadata type — it sits in
 * BUILTIN_METADATA_TYPE_SCHEMAS, so the same shape backs `defineStack({ hooks })`
 * parsing, the `/api/v1/meta/types/hook` endpoint, and the Studio form. A key it
 * silently dropped was invisible on every one of those surfaces.
 *
 * {@link HookContextSchema} is deliberately NOT strict, and must not become so.
 * It is the RUNTIME shape the engine hands to a handler — nobody authors it.
 * Strictness there would invert the contract: adding a field to the context
 * (as `provenance` was in #3712) would turn an engine-internal enrichment into
 * a breaking change for anyone parsing a context they were handed. Same
 * reasoning as `RLSUserContextSchema` / `FlowVersionHistorySchema`.
 *
 * Two near-miss key names, both now aliased because they are genuinely easy to
 * cross:
 *   - hook-level `timeout` vs body-level `timeoutMs` (see hook-body.zod.ts)
 *   - hook `retryPolicy.backoffMs` vs datasource `retryPolicy.baseDelayMs`
 */

/*
 * ── An empty target is not "no target" ──────────────────────────────────────
 *
 * `object` had no emptiness constraint, so `''`, `[]` and `['']` all parsed.
 * The binder (`normalizeObjects` in `packages/objectql/src/hook-binder.ts`)
 * then mapped the first two to `['*']` — and `'*'` is the match-everything
 * sentinel in the engine's dispatch (`targets.includes('*')`). An author who
 * left the target blank therefore got a hook registered on EVERY object in the
 * tenant, on every event listed, with no diagnostic anywhere.
 *
 * That is the #4001 failure mode pointed the wrong way: the usual silent strip
 * narrows what was written, this one WIDENS it — blank intent became the
 * broadest possible blast radius. `['']` failed the other way, registering on
 * an object named `''` that nothing matches — a hook that can never fire
 * (ADR-0078 "no silently inert metadata").
 *
 * Both are refused here, and the binder no longer escalates: a target it cannot
 * make sense of is skipped and recorded, never widened. A wildcard hook remains
 * entirely legitimate — it just has to be SPELLED `'*'`, so that it is a choice
 * a reviewer can see in the diff rather than a default someone fell into.
 */
const hookTargetError =
  'A hook `object` target must name at least one object. An empty target is not '
  + '"no target": until #4001 `\'\'` and `[]` were widened to the wildcard `\'*\'`, '
  + 'registering the hook on EVERY object, and `[\'\']` registered it on an object '
  + 'name nothing matches, so it could never fire. Name the object(s) — '
  + "`object: 'account'` or `object: ['account', 'contact']` — or, if firing on "
  + "every object really is the intent, write the wildcard explicitly: `object: '*'`.";

/**
 * The lifecycle events a hook can subscribe to.
 *
 * ## `after*` fires INSIDE the unit of work, not after it commits (#7477)
 *
 * `afterInsert` / `afterUpdate` / `afterDelete` mean **"the write has been
 * requested and will happen unless this unit of work is undone"** — NOT "the
 * write happened". They are dispatched before the enclosing transaction (if
 * there is one) commits, so a later refusal can roll the row back after the
 * hook has already run. Ruled on #7477 (2026-08-11) as the declared semantics,
 * not an implementation detail to be re-timed later.
 *
 * Three ordinary ways a write ends up inside such a unit:
 *   - a by-id `delete()` whose cascade is atomic — each dependent's own
 *     `afterDelete` runs inside the wrap the parent opened (#7413);
 *   - a `batchData`/`deleteManyData` call with `atomic: true` — every member's
 *     `after*` runs inside one transaction that aborts on the first failure
 *     (#4620);
 *   - any caller that opened `engine.transaction()` / `ctx.api.transaction()`
 *     around the write itself.
 *
 * What that means for a handler:
 *   - **Effects through the same engine are safe.** `ctx.api` / `ctx.ql` writes
 *     join the same transaction and roll back with everything else — which is
 *     exactly what makes an in-engine audit hook correct.
 *   - **Effects OUTSIDE the engine are the hook's own responsibility to make
 *     rollback-tolerant** — webhooks, notifications, external index updates,
 *     file deletion, email. On a rollback the row survives and the
 *     announcement has already gone out. Make such an effect idempotent and
 *     reconcilable, or enqueue it for a worker that re-reads the row before
 *     acting rather than trusting the event alone.
 *
 * The `before*` events carry no such caveat: they run before the write is
 * issued, and throwing from one refuses the operation.
 */
export const HookEvent = z.enum([
  // Read — one event per read, regardless of shape. `beforeFind`/`afterFind`
  // fire for BOTH `find` and `findOne` (the event attaches to record
  // materialization, not to the engine method — Rails' `after_find` model), so
  // a single subscription covers every read path. There is deliberately no
  // per-method read event (`findOne`/`count`/`aggregate`): read authorization
  // and row filtering are the RLS/permission middleware's job, and field
  // masking is field-level metadata — not something every author re-implements
  // as a hook. See #3195.
  'beforeFind', 'afterFind',

  // Write — before/after per mutation kind. These fire on BOTH single-id and
  // bulk (`multi: true`) writes: a bulk update/delete runs the SAME
  // `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` (there is no
  // per-cardinality `*Many` event — one write event covers one row or many,
  // Salesforce's bulk-first model). The row-scoping predicate is NOT reachable
  // from `input` on those write events: it lives on the engine-internal
  // `OperationContext.ast` (#2982) so that the filters middleware composes onto
  // it, where no handler can widen it — scope a bulk batch through
  // `options.where` at the CALLER, or work per row on the `after*` events. Full
  // per-event shapes in the `HookContextSchema.input` contract table below,
  // pinned against the real engine by
  // `packages/objectql/src/hook-input-shape-contract.test.ts`. See #3195.
  'beforeInsert', 'afterInsert',
  'beforeUpdate', 'afterUpdate',
  'beforeDelete', 'afterDelete',
]);

/**
 * Hook Definition Schema
 * 
 * Hooks serve as the "Logic Layer" in ObjectStack, allowing developers to 
 * inject custom code during the data access lifecycle.
 * 
 * Use cases:
 * - Data Enrichment (Default values, Calculated fields)
 * - Validation (Complex business rules)
 * - Side Effects (Sending emails, Syncing to external systems)
 * - Security (Filtering data based on context)
 */
export const HookSchema = lazySchema(() => strictObject(
  {
    surface: 'this hook',
    aliases: {
      hookname: 'name',
      objectname: 'object',
      objects: 'object',
      event: 'events',
      fn: 'handler',
      callback: 'handler',
      order: 'priority',
      sequence: 'priority',
      background: 'async',
      isasync: 'async',
      when: 'condition',
      predicate: 'condition',
      retry: 'retryPolicy',
      timeoutms: 'timeout',
      errorpolicy: 'onError',
      onfailure: 'onError',
    },
    guidance: {
      enabled:
        '`enabled` is not a hook key — a hook has no on/off switch. Gate it with `condition` '
        + '(the hook is skipped when the predicate is false), or remove the hook.',
      active:
        '`active` is not a hook key — a hook has no on/off switch. Gate it with `condition`, '
        + 'or remove the hook.',
    },
    history: 'Until #4001 these were dropped silently — the hook still registered and ran.',
  },
  {
  /**
   * Unique identifier for the hook
   * Required for debugging and overriding.
   */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Hook unique name (snake_case)'),

  /**
   * Human readable label
   */
  label: z.string().optional().describe('Description of what this hook does'),

  /**
   * Target Object(s)
   * can be:
   * - Single object: "account"
   * - List of objects: ["account", "contact"]
   * - Wildcard: "*" (All objects)
   *
   * Must name at least one object. An empty target (`''`, `[]`, `['']`) is
   * refused rather than widened to the wildcard — see {@link hookTargetError},
   * which carries the rejection text and the reason.
   */
  object: z.union([z.string(), z.array(z.string())])
    .refine(
      (v) => (Array.isArray(v)
        ? v.length > 0 && v.every((name) => name.trim().length > 0)
        : v.trim().length > 0),
      { error: hookTargetError },
    )
    .describe('Target object(s)'),

  /**
   * Events to subscribe to
   * Combinations of timing (before/after) and action (find/insert/update/delete/etc)
   */
  events: z.array(HookEvent).describe('Lifecycle events'),

  /**
   * Handler Logic
   *
   * Two accepted shapes:
   *
   *   - **Inline function** (authoring): `handler: async (ctx) => { ... }`.
   *     Convenient in `defineStack({ hooks: [...] })` source files.
   *   - **String reference** (build artifact / Studio): `handler: 'my_fn'`.
   *     Resolved at runtime against the bundle's `functions` map +
   *     anything `engine.registerFunction(name, fn)` added.
   *
   * `objectstack build` automatically lowers inline functions to the
   * string form (using `Hook.name` as the ref) and emits the originals
   * into a sibling `objectstack-runtime.<hash>.mjs` referenced by the
   * top-level `runtimeModule` field. The JSON artifact therefore only
   * ever contains the string form.
   */
  handler: z.union([z.string(), z.custom<(...args: any[]) => any>((v) => typeof v === 'function', { message: 'Expected function' })]).optional().describe('Handler function name (string, post-build) or inline function (pre-build) — DEPRECATED, prefer `body`'),

  /**
   * Hook Body (L1 expression or L2 sandboxed JS).
   *
   * Preferred over `handler` for new code. When both are present, runtime
   * loader uses `body` and ignores `handler`.
   *
   * - `{ language: 'expression', source: '...' }` — pure formula (L1).
   * - `{ language: 'js', source: '...', capabilities: [...] }` — sandboxed JS (L2).
   *
   * Authoring convenience: `objectstack build` extracts inline TS handlers from
   * `*.hook.ts` files, AST-checks them, and emits the result here. See plan §6.
   */
  body: HookBodySchema.optional().describe('Hook body — expression (L1) or sandboxed JS (L2)'),

  /**
   * Execution Order
   * Lower numbers run first.
   * - System Hooks: 0-99
   * - App Hooks: 100-999
   * - User Hooks: 1000+
   */
  priority: z.number().default(100).describe('Execution priority'),

  /**
   * Async / Background Execution
   * If true, the hook runs in the background and does not block the transaction.
   * Only applicable for 'after*' events.
   * Default: false (Blocking)
   */
  async: z.boolean().default(false).describe('Run specifically as fire-and-forget'),

  /**
   * Declarative Condition
   * Formula expression evaluated before the handler runs.
   * If provided and evaluates to FALSE, the hook is skipped entirely.
   * Useful for filtering by record data without writing handler code.
   * 
   * @example "record.status == 'closed' && record.amount > 1000"
   */
  condition: ExpressionInputSchema.optional().describe('Predicate (CEL); hook runs only when TRUE. e.g. P`record.status == "closed" && record.amount > 1000`'),

  /**
   * Human-readable description
   */
  description: z.string().optional().describe('Human-readable description of what this hook does'),

  /**
   * Retry Policy
   */
  retryPolicy: strictObject(
  {
    surface: "this hook's retryPolicy",
    aliases: {
      retries: 'maxRetries',
      attempts: 'maxRetries',
      basedelayms: 'backoffMs',
      backoff: 'backoffMs',
      delayms: 'backoffMs',
    },
    history:
      'Until #4001 these were dropped silently — the hook retried on the defaults rather '
      + 'than the policy that was written. Note a datasource retryPolicy spells its delay '
      + '`baseDelayMs`; a hook spells it `backoffMs`.',
  },
  {
    maxRetries: z.number().default(3).describe('Maximum retry attempts on failure'),
    backoffMs: z.number().default(1000).describe('Backoff delay between retries in milliseconds'),
  }).optional().describe('Retry policy for failed hook executions'),

  /**
   * Execution Timeout
   */
  timeout: z.number().optional().describe('Maximum execution time in milliseconds before the hook is aborted'),

  /**
   * Error Policy
   * What to do if the hook throws an exception?
   * - abort: Rollback transaction (if blocking)
   * - log: Log error and continue
   */
  onError: z.enum(['abort', 'log']).default('abort').describe('Error handling strategy'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // MISSING until the registered-type invariant test was written: `hook` closed
  // strict in the #4001 data step without declaring it, so the `_packageId` /
  // `_provenance` that `MetadataPlugin` stamps on every registered type were
  // REJECTED here — the same live 422 that `permission` hit on the ADR-0094
  // overlay path before Tier-A declared them (#4001 findings log, entries 2/8).
  ...MetadataProtectionFields,
}));

/**
 * Hook Runtime Context
 * Defines what is available to the hook handler during execution.
 * 
 * Best Practices:
 * - **Immutability**: `object`, `event`, `id` are immutable.
 * - **Mutability**: `input` and `result` are mutable to allow transformation.
 * - **Encapsulation**: `session` isolates auth info; `transaction` ensures atomicity.
 */
export const HookContextSchema = lazySchema(() => z.object({
  /** Tracing ID */
  id: z.string().optional().describe('Unique execution ID for tracing'),

  /** Target Object Name */
  object: z.string(),
  
  /** Current Lifecycle Event */
  event: HookEvent,

  /**
   * Input Parameters (Mutable)
   * Modify this to change the behavior of the operation.
   *
   * TWO SURFACES, and they do NOT hand a handler the same `input`. The rows
   * immediately below are the RAW ENVELOPE the engine builds — what a handler
   * registered through `engine.registerHook` receives, and only that. Every
   * DECLARATIVE hook — a metadata `Hook`, i.e. everything an app author writes
   * in `defineStack({ hooks })` — is handed a FLAT RECORD VIEW of that
   * envelope instead. If you are authoring a `Hook`, the rows you need are the
   * DECLARATIVE SURFACE block that follows the envelope rows; read the
   * envelope rows as the shape being viewed, not as what you will see.
   *
   * These shapes are exactly what the engine BUILDS — `packages/objectql`'s
   * `engine.ts` is the only producer of a `HookContext`. A key this table
   * lists but no producer sets reads back `undefined` at every call site, and
   * a contract statement is the one place that cannot be discovered as false:
   * #5273 was three such keys (`ast` on both bulk writes, `doc` on insert)
   * standing in the table long after the engine had stopped agreeing. Pinned
   * against the real engine in
   * `packages/objectql/src/hook-input-shape-contract.test.ts` — the assertions
   * live there because only objectql can execute a dispatch, and spec must not
   * depend on it.
   *
   * - find (also fires for findOne): { ast: QueryAST, options: see PHASE below }
   * - insert (one context per row, batch inserts included): { data: Record, options: see PHASE below }
   * - update (single id): { id: ID, data: Record, options: see PHASE below }
   * - update (bulk, multi:true) — before, PER MATCHED ROW: { id: ID, data: Record, options: EngineUpdateOptions }
   * - update (bulk, multi:true) — after, PER MATCHED ROW: { id: ID, data: Record, options: DriverOptions }
   * - delete (single id): { id: ID, options: see PHASE below }
   * - delete (bulk, multi:true) — before, PER MATCHED ROW: { id: ID, options: EngineDeleteOptions }
   * - delete (bulk, multi:true) — after, PER MATCHED ROW: { id: ID, options: DriverOptions }
   *
   * DECLARATIVE SURFACE — what an app author is actually handed
   *
   * `bindHooksToEngine` wraps every metadata `Hook` in `wrapDeclarativeHook`,
   * which calls `installFlatInput` (`packages/objectql/src/hook-wrappers.ts`)
   * for the duration of the handler call: `ctx.input` is swapped for a Proxy
   * presenting a flat record view over the envelope above, then restored in a
   * `finally`, so the engine's own downstream `input.data` read still picks up
   * whatever the handler wrote. That produces TWO shapes, not one — measured
   * (#7254) on a real kernel and the real QuickJS runner, with persisted-row
   * assertions:
   *
   * - declarative `handler` (code): `input.<field>` IS the record field. Reads
   *   of any non-wrapper key resolve against `data`; writes ALWAYS land in
   *   `data` (created if missing), which is how `input.field = value` reaches
   *   the driver — and on a bulk write that IS the one batch-scoped payload
   *   (D3 below), so the flat spelling scopes a rewrite no better than
   *   `input.data.field` did. The wrapper keys `data` / `id` / `options` / `ast` still
   *   pass THROUGH to the envelope, so `input.data.<field>` also happens to
   *   work here — redundantly, and it is the spelling that breaks on the other
   *   surface. Enumeration is flat-only: `Object.keys(input)`, spread and
   *   `for…in` list the record fields and hide the wrapper keys (the proxy's
   *   `ownKeys` trap), so a diff written as
   *   `Object.keys(input).filter(k => input[k] !== previous[k])` sees fields.
   * - declarative `body` (L2 sandboxed JS): `ctx.input` IS the flat record —
   *   a plain snapshot the runner takes as `unwrapProxyToPlain(engineCtx.input)`
   *   (`packages/runtime/src/sandbox/body-runner.ts`), i.e. `Object.entries`
   *   over that proxy, so it materialises exactly what `ownKeys` exposes and
   *   nothing else. There is NO `data` key at all: `input.data` is `undefined`,
   *   and the envelope spelling `input.data.<field>` is a **TypeError** — which
   *   ABORTS the caller's write on a hook whose `onError` is `abort` — which is
   *   this schema's DEFAULT, and what shipped showcase body hooks declare
   *   explicitly. `id`, `options` and `ast` are
   *   absent for the same reason; on `find` and `delete`, whose envelopes carry
   *   no `data`, the whole snapshot is `{}`. A body that needs the row reads
   *   `ctx.previous` — the pre-image, `id` included, bound on update and delete.
   *   Writes the script makes to `ctx.input` are copied back onto the live proxy
   *   after it returns (`applyMutationsToInput`), so `input.field = value` still
   *   lands in `data` through the same `set` trap.
   *
   * There is therefore no single spelling that works everywhere:
   * `input.<field>` is correct on BOTH declarative surfaces, and
   * `input.data.<field>` only off the raw `registerHook` envelope. #7225 is
   * what naming just one half costs: a careful reader holding only the envelope
   * rows concluded that three shipped, working example hooks were silent
   * no-ops, and prescribed re-spelling them to `input.data` — which would have
   * converted the showcase's public web-to-lead insert into a hard refusal of
   * every submission. The two declarative shapes are pinned against a real
   * kernel in `examples/app-showcase/test/hook-body-persisted-writes.test.ts`
   * (#7258); the envelope rows stay pinned in objectql's
   * `hook-input-shape-contract.test.ts`. Whether the two surfaces should
   * CONVERGE is a separate question, deliberately not decided here (#7254) —
   * the split is stated so it cannot be mistaken for an oversight.
   *
   * PHASE — `input.options` is the one slot whose TYPE depends on when you read
   * it, on every envelope path above. The engine builds the context with the CALLER's
   * own options bag (`EngineQueryOptions` / `DataEngineInsertOptions` /
   * `EngineUpdateOptions` / `EngineDeleteOptions`) and only AFTER the `before*`
   * handlers return — before the driver call — merges the driver-facing keys
   * onto it (`buildDriverOptions`: transaction, tenantId, timezone, …). So a
   * `before*` handler reads the CALLER's bag, `where` and `multi` included; an
   * `after*` handler and the driver read the `DriverOptions` view. The merge is
   * ADDITIVE — it spreads the caller's bag and adds keys, never strips one — so
   * the widening is one-way and nothing a `before*` handler saw disappears.
   * #5997 corrected the two `before` envelope rows above, which had said `DriverOptions`
   * (a type that declares no `where` and no `multi`): that is not what the
   * engine builds there, and not what the two consumers named below read.
   * Measured and pinned in the same contract test as the rest of this table.
   *
   * A bulk (`multi: true`) update/delete fires the SAME `beforeUpdate`/
   * `beforeDelete` events as a single-id write; there is no separate `*Many`
   * event. Since #5574's engine half it fires them once PER MATCHED ROW, each
   * on a single-record-shaped context carrying that row's `id` and `previous`
   * — the same move #5038 made for the `after*` phase, held to the same
   * yardstick. Zero matched rows is zero dispatches. The full clause set
   * (D1–D7) with its budget ceiling is `data/bulk-write-hook-conformance.ts`
   * (ADR-0058 Addendum II).
   *
   * Two things a reader of the envelope rows above still has to know:
   *
   *  - The PAYLOAD stays BATCH-scoped (D3). Every per-row `beforeUpdate`
   *    context carries THE one payload, not a copy — `driver.updateMany` takes
   *    one SET clause for N rows — so a rewrite applies to the whole batch
   *    whichever row's dispatch made it, and rewrites accumulate in dispatch
   *    order. A rewrite CONDITIONED on the row is therefore out of contract:
   *    it widens to every matched row instead of scoping itself. Per-row
   *    `previous` is supplied so a guard can REFUSE (throw), not so a rewrite
   *    can be aimed.
   *  - `input.id` is NOT a reroute lever (D4). It used to be: on the batch
   *    dispatch `input.id` was present-but-`undefined`, and binding it moved
   *    the write onto the single-id path. A per-row context arrives with `id`
   *    already bound and the dispatch already decided, so rebinding retargets
   *    nothing — and objectql REFUSES it (`HookTargetRebindError`) rather than
   *    ignoring it, on the by-id path too. A silent no-op is the failure this
   *    family exists to abolish.
   *
   * What the change fixed, recorded because the failure direction is the
   * dangerous one: a `before*` handler on a bulk write used to have NO
   * `previous`, so a guard written as `previous?.x` passed silently on every
   * batch — fail-OPEN, and invisible.
   *
   * The row-scoping predicate a bulk write EXECUTES is not reachable from
   * `input` at all. It is the composed `ast`, which lives on the
   * engine-internal `OperationContext.ast` (#2982) so that the filters
   * middleware composes onto it — RLS write policies, the sharing plugin's
   * editable-rows filter — and binds the driver call itself, where no handler
   * can widen it. What a `before*` handler CAN read is the strictly separate
   * fact above: the caller's RAW predicate on `input.options.where` (with
   * `input.options.multi`). The two differ by exactly the middleware's
   * narrowing, and middleware only ever narrows, never widens — so treating
   * the caller's predicate as the batch's row set is an UPPER-BOUND
   * approximation. That is the safe direction for a fail-closed guard (it may
   * refuse a write that would have touched fewer rows; it can never miss one
   * that touches more) and the wrong direction for anything that needs the
   * effective set exactly, which should work per row instead — on the
   * `before*` events too, since #5574. Both of `plugin-auth`'s break-glass
   * last-admin guards (#5892 ban half, #5941 delete half) are built on that
   * upper bound, so do not narrow `input.options` on the `before*` paths
   * without re-reading both. (objectql's `isPredicateBulkWrite` read the same
   * slot to tell a batch dispatch from a per-row one; it is retired with the
   * batch dispatch — `hook-wrappers.ts` records why.)
   *
   * Since #5038 (ADR-0058's bulk-write addendum) the `after*` events on a bulk
   * write dispatch ONCE PER MATCHED ROW, each on a single-record-shaped
   * context — `input.id` names that row, `previous` is its pre-image and
   * `result` its post-state — so a handler written for a single-id write needs
   * no bulk-aware branch of its own. The `before*` events joined them in #5574,
   * with `result` absent — the before phase has no post-state. The batch-level
   * context keeps the affected COUNT as `result` and is what the call itself
   * resolves (#4639); no handler is dispatched on it any more.
   */
  input: z.record(z.string(), z.unknown()).describe('Mutable input parameters'),

  /** 
   * Operation Result (Mutable)
   * Available in 'after*' events. Modify this to transform the output.
   */
  result: z.unknown().optional().describe('Operation result (After hooks only)'),

  /**
   * Data Snapshot
   * The state of the record BEFORE the operation (for update/delete).
   */
  previous: z.record(z.string(), z.unknown()).optional().describe('Record state before operation'),

  /**
   * Dispatch Marker
   * How THIS hook call relates to the caller's write — and the one place a
   * handler may keep state that survives from the `before*` phase to the
   * `after*` phase of the same write.
   *
   * ## Why it exists (#6966)
   *
   * Since #5038 (`after*`) and #5574 (`before*`) a predicate (`multi: true`)
   * write dispatches ONCE PER MATCHED ROW, on a context deliberately
   * indistinguishable from the single-id shape — `input.id` names the row,
   * `previous` is its pre-image. That indistinguishability is the feature: a
   * handler written for one record needs no bulk-aware branch.
   *
   * It also erased the only signal several handlers had. Before #5574,
   * "`input.id` is empty" meant "this one call stands for N rows", and guards
   * across the platform were written on it. Every one of them silently
   * inverted: a per-row context has an id, so the guard now answers "single
   * write" for every row of a bulk write. This key restores the question as a
   * FACT the engine states, rather than an inference from the shape of
   * another key.
   *
   * ## Why the engine has to state it
   *
   * A handler cannot rebuild the answer. The verdict is the engine's dispatch
   * ladder (`isByIdWrite` / `isPredicatePath`), which also consults driver
   * capability (`updateMany`/`deleteMany` presence) — and `asScalarId` is
   * deliberately unexported to stop the plugin side from re-deriving it from
   * `options.multi` (#4434 / #4550). So the marker is produced where the
   * verdict is made, once, and never re-derived.
   *
   * ## Not the retired `isPredicateBulkWrite` (#5574, ADR-0049)
   *
   * A bulk discriminator was removed from `hook-wrappers.ts` because it had
   * neither a producer nor a reachable consumer: its whole test was "no
   * `input.id` and `options.multi`", which answered `false` everywhere once
   * every dispatch carried an id. This key is the opposite on both counts and
   * must stay that way — it is bound by the engine at EVERY write dispatch
   * site (insert, update, delete; both phases), and the platform's own
   * handlers read it. If it ever loses its readers, retire it; do not leave it
   * declared.
   *
   *  - `mode` — `'record'` when this call is the caller's whole write (a
   *    single-id update/delete, a non-batch insert); `'per-row'` when it is
   *    one of N dispatches for one caller write.
   *  - `index` — 0-based position within that fan-out; always 0 when
   *    `mode` is `'record'`. `index === 0` is how a handler does batch-scoped
   *    work exactly once instead of N times.
   *  - `scope` — scratch shared by EVERY dispatch of one caller write, both
   *    phases, same object identity. Handlers used to stash on the context
   *    itself, which worked only because a single-id write reuses one
   *    `HookContext` across its before/after pair; a per-row dispatch builds a
   *    fresh context per row, so those stashes silently stopped arriving
   *    (#6966). This is that seam, named and contractual.
   *
   * OPTIONAL for the same reason `api` is: making it required would start
   * rejecting the partial contexts `HookContextSchema.parse` accepts today.
   * Read it as `ctx.dispatch?.mode === 'per-row'` — an ABSENT marker reads as
   * "not a per-row dispatch", which is the back-compatible direction.
   *
   * Reads (`beforeFind`/`afterFind`) carry no marker: a read has no fan-out.
   */
  dispatch: z.object({
    mode: z.enum(['record', 'per-row']).describe("'record' = this call is the caller's whole write; 'per-row' = one of N dispatches for one write"),
    index: z.number().int().nonnegative().describe('0-based position in the per-row fan-out; always 0 when mode is "record"'),
    scope: z.record(z.string(), z.unknown()).describe('Scratch shared by every dispatch of one caller write, across both phases (same object identity)'),
  }).optional().describe('How this hook call relates to the caller\'s write (engine-produced; #6966)'),

  /**
   * Execution Session
   * Contains authentication and organization/tenancy information.
   *
   * WHO is calling. Absent when the operation carried no identity envelope at
   * all — a bare-kernel / programmatic call — which is why hooks that gate on
   * the caller (the attachment access gate, for one) skip when it is missing.
   * Write PROVENANCE deliberately lives outside it, in {@link provenance}, so
   * an identity-less writer can still be attributed without manufacturing a
   * caller that was never there (#3712).
   */
  session: z.object({
    userId: z.string().optional(),
    /**
     * Service-principal label for audit attribution when the caller is not a
     * real user (`ExecutionContext.actor`, ADR-0014 D2) — e.g. a service token
     * (`svc:<name>`) or an automation run (`svc:flow:<flowName>`, #4366).
     * `userId` takes precedence when set; this is the fallback the audit
     * writer records on `sys_audit_log.actor`. Attribution only — it grants
     * nothing and no security middleware keys on it.
     */
    actor: z.string().optional().describe('Service-principal label for audit attribution when the caller is not a real user (e.g. svc:flow:<flowName>)'),
    /**
     * Active organization ID — the developer-facing name for the caller's
     * current org. Same value everywhere a developer reads the org: the
     * `organization_id` column, `current_user.organizationId` (RLS/sharing),
     * and seed rows. `null`/`undefined` on unscoped (platform/community) calls.
     *
     * The former `session.tenantId` alias (#3280) was removed in the v16 major
     * (#3290): read the org under this single blessed name. The generic
     * driver-layer isolation knob (`ExecutionContext.tenantId`,
     * `DriverOptions.tenantId`) is a distinct, configurable axis and is
     * deliberately untouched.
     */
    organizationId: z.string().optional().describe('Active organization ID (blessed developer-facing name)'),
    accessToken: z.string().optional(),
    isSystem: z.boolean().optional().describe('True when the call was made with an elevated system context (engine self-writes)'),
    skipTriggers: z.boolean().optional().describe('True when record-change automation (flow triggers) must be suppressed for this write — e.g. package seed replay. Lifecycle hooks still run.'),
    skipAutomations: z.boolean().optional().describe('True when metadata-bound automation hooks must be suppressed for this write — e.g. data import with "run automations" unchecked, or import undo. Implies skipTriggers; code-registered system hooks (audit, security) still run.'),
    /**
     * Position names held by the caller (ADR-0090 D3 vocabulary — the schema
     * comment on `ExecutionContext.positions` spells it "Formerly `roles`").
     * Copied verbatim from `ExecutionContext.positions` by ObjectQL's
     * `buildSession()` (`packages/objectql/src/engine.ts`).
     *
     * ⚠️ **Descriptive, NOT an authorization input.** A hook may READ this to
     * describe the caller — tailoring a message, branching a *business* rule
     * through its own channel (`ctx.api`), logging — and nothing more. It
     * grants nothing on its own, no security middleware keys on it here, and a
     * hook must never make the access decision itself by testing it
     * (`session.positions.includes('sales_manager')` is the anti-pattern).
     *
     * The example that used to stand here — forwarding this array as the
     * sharing service's evaluation context,
     * `services.sharing.canEdit(..., { positions })` — was itself unreachable
     * and is gone (#6001). A hook context is assembled key by key by the engine
     * (`buildSession()` / `buildSandboxContext()` in
     * `packages/runtime/src/sandbox/body-runner.ts`) and carries **no
     * `services` key**, so that call is `undefined()` at run time and the
     * customary `if (!ok) throw` around it rejects every write (#5720). It was
     * a defect shape wearing a good-practice label. The sharing gates run
     * inside the engine and have already thrown `FORBIDDEN` before any hook is
     * reached, so there is nothing for a hook to forward: see
     * `content/docs/kernel/runtime-services/sharing-service.mdx`,
     * "Enforcement is automatic — do not re-check it in a hook".
     * PRIVILEGE is judged by the security service on the ExecutionContext:
     * capability grants (`permissions`), placements (`positions`) and the
     * derived posture (ADR-0095 D3). A hook that re-decides access from this
     * array is deciding, in a place with no access to the grant model,
     * something already decided — structurally the same mistake as the
     * `roles` tombstone below (#5050), one vocabulary later. That is why this
     * key is declared with the boundary written down rather than left to be
     * inferred from its name.
     *
     * Declared in #5605 (maintainer ruling A): it was PRODUCED by
     * `buildSession()` and TAUGHT by two kernel doc pages while the contract
     * omitted it — so `HookContextSchema.parse()` silently stripped it (this
     * shape is deliberately non-strict, see the header) and a handler typed
     * `(ctx: HookContext)` could not read it without TS2339. Produced-never-
     * declared, the mirror of `roles`' declared-never-produced.
     */
    positions: z.array(z.string()).optional().describe(
      'Position names held by the caller (ADR-0090 D3; formerly `roles`), copied from '
      + 'ExecutionContext.positions. For hook READS only — e.g. tailoring a message, or '
      + 'branching a business rule the hook runs through its own `ctx.api` channel. '
      + 'Authorization is decided by the security service on the ExecutionContext '
      + '(permissions / positions / derived posture); this is NOT an authorization input '
      + 'and a hook must not gate a write by testing it. A hook context carries no '
      + '`services` key, so the sharing service cannot be called from one either — the '
      + 'sharing gates already ran inside the engine before the hook chain.',
    ),
    /**
     * Historical-import audit-preservation flag (#3493). Set by
     * `buildSession()` only when the write context carries it, so a normal
     * write leaves it absent.
     *
     * Its one consumer is the built-in audit hook
     * (`packages/objectql/src/plugin.ts`, `applyToRecord`): when true, a
     * client-supplied `updated_at` / `updated_by` is PREFERRED and kept —
     * reinstating the original timeline of imported history — instead of
     * being overwritten with the import instant, symmetric with how
     * `created_at` / `created_by` behave on insert. It also whitelists the
     * audit/timestamp family through `stripReadonlyFields()`.
     *
     * Server-set and opt-in; like {@link positions} it authorizes nothing —
     * it selects a stamping policy for a write the security service has
     * already allowed.
     */
    preserveAudit: z.boolean().optional().describe(
      'True when this write is a historical import that must KEEP its caller-supplied '
      + 'updated_at/updated_by (and the readonly audit family) instead of being stamped with '
      + 'the import instant (#3493). Server-set, opt-in, absent on normal writes; read by the '
      + 'built-in audit hook. A stamping policy, not an authorization input.',
    ),
    // `roles` REMOVED (#5050, ADR-0049 D2). It was DECLARED here, READ by two
    // dead exemption branches in plugin-approvals (the approval record lock and
    // the delegation write guard, both deleted in #4839 / PR #5049), and NEVER
    // PRODUCED on the hook path: ObjectQL's `buildSession()`
    // (`packages/objectql/src/engine.ts`) builds the session field by field —
    // `userId`, `organizationId`, `accessToken`, `isSystem`, `actor`, the skip
    // flags — and has no `roles` write, and no other producer feeds a
    // HookContext. So both readers resolved `undefined` on every real engine
    // path: an authorization decision in shape only. #5049 removed the last two
    // readers; this removes the declaration, which is what ADR-0049
    // enforce-or-remove asks for once a key has neither end.
    //
    // ⚠️ One NEIGHBOUR, deliberately not conflated (the #4865 lesson — a
    // tombstone claim disproven by a surface nobody checked): an ACTION body's
    // `ctx.session` is a DIFFERENT object, built by
    // `runtime/src/action-execution.ts` `buildActionSession()`, and it does
    // write a `roles` key today (from `ec.positions`, i.e. the ADR-0090 D3
    // vocabulary spelled in the banned name). It is untyped `any`, reaches no
    // schema, and never becomes a HookContext — so it neither refutes the
    // never-produced finding here nor is fixed by this removal. Filed as
    // #5613; do not "restore" this key on the strength of having seen
    // `session.roles` populated inside an action body.
    //
    // Tombstoned rather than deleted: `HookContextSchema` is deliberately NOT
    // `.strict()` (see the header), so a plain deletion would make Zod strip
    // the key silently — the #3733 / ADR-0104 failure, and exactly the silent
    // no-op this retirement exists to end.
    //
    // ⚠️ Keep tombstones at the BOTTOM of this shape. The generated reference
    // renders an inline object as its first four declared keys plus `…`
    // (`scripts/lib/format-type.ts`, INLINE_KEY_LIMIT), and a `z.never()` has
    // no JSON-Schema `type`, so it prints as `any` with no room for the
    // `[REMOVED]` prescription a top-level row would carry. In its original
    // position `roles` was the 4th key and `references/data/hook.mdx` began
    // advertising `roles?: any` — a retired key reading as a free-form
    // authorable slot, the ADR-0033 trap pointed at the docs. Below the live
    // keys it is elided instead, and the two real channels (tsc + the parse)
    // are untouched. The renderer gap itself is filed separately.
    //
    // The live vocabulary is unchanged and lives elsewhere on purpose: a hook
    // that gates on the caller reads `session.userId` / `session.isSystem`
    // here, and privilege itself is judged on the ExecutionContext the security
    // service resolves — capability grants (`permissions`), placements
    // (`positions`) and the derived posture (ADR-0095 D3) — never by a session
    // field named `roles` or a comparison against the string 'admin'
    // (ADR-0090 D3 bans the `role` spelling outright).
    roles: retiredKey(
      '`HookContext.session.roles` was removed in @objectstack/spec 17.0.0 (#5050, ADR-0049 D2) — '
      + 'it was declared, read by two dead exemption branches (removed in #5049), and never '
      + 'produced: ObjectQL\'s `buildSession()` builds the session field by field and has never '
      + 'written `roles`, so every read resolved `undefined` and a guard keyed on it was dead '
      + 'code that merely LOOKED like an authorization decision. Delete the key. To gate a hook '
      + 'on the caller, read `ctx.session.userId` / `ctx.session.isSystem`; to judge PRIVILEGE, '
      + 'ask the security service, which evaluates the ADR-0095 vocabulary on the execution '
      + 'context — capability grants (`permissions`), placements (`positions`) and the derived '
      + 'posture — never a role-name string comparison (ADR-0090 D3 bans the `role` spelling '
      + 'outright). Nothing to migrate: a HookContext is built per operation by the engine and '
      + 'never stored, so no metadata source carries this key. NOTE an ACTION body\'s '
      + '`ctx.session` is a different object and still carries its own `roles` array today; '
      + 'that surface is tracked separately (#5613) and is not what this key was.',
    ),
  }).optional().describe('Current session context'),

  /**
   * Write Provenance
   * WHERE this write came from, as opposed to WHO is calling ({@link session}).
   *
   * Server-stamped and never client-supplied. **Nothing here is an
   * authorization input**: no security middleware evaluates any of it, and it
   * neither widens nor narrows what the write may touch. It exists so a hook —
   * or the audit writer — can tell "the run / the person this write belongs
   * to" from "an unrelated caller".
   *
   * Two marks, both non-authorizing, for two different questions:
   *  - `flowRunId` — WHAT produced the write (a machine origin, no person);
   *  - `attributedUserId` — WHO is CREDITED for a write the system authorized
   *    (a person, but never the subject the write was authorized as).
   *
   * Kept OUT of `session` on purpose. A writer can have provenance and no
   * identity at all — a schedule-triggered flow run resolves no principal — and
   * folding the two together would have forced such a run to present an empty
   * session, silently turning "no caller" into "an anonymous caller" for every
   * hook that gates on `session` being absent (#3712). The same reasoning
   * keeps `attributedUserId` out: it names a human, but the write authorized
   * as the SYSTEM, and a hook reading `session.userId` must keep seeing the
   * truth — there was no caller (#4586).
   */
  provenance: z.object({
    flowRunId: z.string().optional().describe('Id of the automation flow run performing this write, when it originates from a flow data node. Lets a hook recognize the run that OWNS state that run itself opened — the approvals record lock exempts the run holding the pending request (#3456).'),
    attributedUserId: z.string().optional().describe('The real human credited for a write whose authorization subject was the SYSTEM — e.g. the admin whose better-auth `update-member-role` call the identity adapter executes as `isSystem` (#4586). ATTRIBUTION ONLY: the audit writer records it as `sys_audit_log.user_id`; no security middleware reads it, and it never becomes the subject the write is authorized as.'),
  }).optional().describe('Server-stamped write provenance (never client-supplied, never an authorization input)'),


  /**
   * Transaction Handle
   * If the operation is part of a transaction, use this handle for side-effects.
   */
  transaction: z.unknown().optional().describe('Database transaction handle'),

  /**
   * Engine Access
   * Reference to the ObjectQL engine for performing side effects.
   */
  ql: z.unknown().describe('ObjectQL Engine Reference'),

  /**
   * Cross-Object API
   * Provides a scoped data access interface for performing CRUD operations
   * on other objects within hooks. Bound to the current execution context
   * (userId, organizationId, transaction).
   *
   * Usage in hooks — this example COMPILES, and is pinned as a compile probe
   * by `contracts/scoped-context.test.ts` so that it keeps doing so:
   *
   *   const owner = await ctx.api?.object('user').findOne({
   *     where: { id: ctx.input.owner_id },
   *   });
   *
   * TYPED as {@link IScopedContext} since #5945 (maintainer ruling C), where it
   * was `z.unknown()` — which made `HookContext['api']` infer as `unknown`, so
   * the two lines this JSDoc used to show were themselves a `TS18046: 'ctx.api'
   * is of type 'unknown'`. Every document teaches `(ctx: HookContext)` plus
   * `ctx.api.object(…)`; none of it type-checked, and the one doc block already
   * under `check:skill-examples` compiled only by casting to a private
   * hand-rolled `CrossObjectApi`. The declared face is deliberately the minimum
   * the corpus is measured to CALL — see the evidence bar in
   * `contracts/scoped-context.ts` for what is excluded and how to grow it.
   *
   * The RUNTIME schema stays `z.unknown()` and the narrowing is a static cast,
   * the same idiom (and for the same reason) as `ObjectCapabilities.apiMethods`
   * in `object.zod.ts`: keep the TS type the authors' one, keep the parse the
   * permissive one. Two things force it here.
   *
   *  1. This key carries a LIVE engine object — ObjectQL's `ScopedContext`, a
   *     class instance with methods — not authored data. Validating it would
   *     mean checking a class against a JSON shape on every parse, on a schema
   *     that is deliberately the non-authored runtime context (see the header).
   *  2. `z.custom<IScopedContext>()` was the obvious spelling and is WRONG
   *     here: `custom` is unrepresentable in JSON Schema, so `gen:schema`
   *     stopped emitting `json-schema/data/HookContext.json` altogether —
   *     "1 previously published schema disappeared", which unpublishes the
   *     generated `references/data/hook.mdx` page on the next `gen:docs`
   *     (#2978). Measured, not guessed: the spec build failed on it. `unknown`
   *     keeps the schema representable, so the JSON Schema, the manifest and
   *     the reference page are all byte-identical to before.
   *
   * The change is therefore type-only: same accepted values, same JSON Schema
   * (`{}`), same generated row — only the `.describe()` text moves, which is
   * that page's only channel for saying what the value is.
   *
   * Stays OPTIONAL, though `buildHookApi` sets it at all five dispatch sites:
   * making it required would start REJECTING the partial contexts that
   * `HookContextSchema.parse` accepts today (a context built without a live
   * engine). Read it as `ctx.api?.object(…)`, or bind it once and narrow.
   */
  api: (z.unknown().optional() as unknown as z.ZodOptional<z.ZodType<IScopedContext, IScopedContext>>)
    .describe('Cross-object data access (IScopedContext — `object(name)` + `transaction(cb)`)'),

  /**
   * Current User Info
   * Convenience shortcut for session.userId + additional user metadata.
   * Populated by the engine when available.
   */
  user: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    /**
     * Active organization ID of the acting user — the blessed name for
     * "the current org to filter/scope by" inside a hook. Same value as
     * `session.organizationId`, `current_user.organizationId` (RLS), and the
     * `organization_id` column, so a hook author needs zero relearning to move
     * between surfaces. Undefined for unscoped (platform/community) calls.
     */
    organizationId: z.string().optional().describe('Active organization ID of the acting user (equals session.organizationId)'),
  }).optional().describe('Current user info shortcut'),
}));

export type Hook = z.input<typeof HookSchema>;
/** Post-parse shape of {@link Hook} — defaults applied, transforms run (ADR-0122). */
export type HookParsed = z.infer<typeof HookSchema>;
export type ResolvedHook = z.output<typeof HookSchema>;
/**
 * One lifecycle event name. See {@link HookEvent} for the timing each one
 * carries — in particular that `after*` fires INSIDE the unit of work, before
 * the enclosing transaction commits (#7477).
 */
export type HookEventType = z.input<typeof HookEvent>;
export type HookContext = z.input<typeof HookContextSchema>;
/**
 * The engine's dispatch marker (#6966) — see `HookContext.dispatch`. Named so
 * a handler can bind it once (`const d = ctx.dispatch;`) and narrow, instead of
 * spelling `NonNullable<HookContext['dispatch']>` at every read site.
 */
export type HookDispatch = NonNullable<HookContext['dispatch']>;

/**
 * Type-safe factory for a lifecycle hook. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL shorthand
 * for `condition`) — preferred over a bare `: Hook` literal (#4269).
 *
 * A bare literal gets TS excess-property checking only: constraint-level rules
 * (snake_case `name`, enum values) and the #4207 alias/guidance errors surface
 * no earlier than bind time — and never for the convention-scan path
 * (`src/objects/<name>.hook.ts`), whose artifact also stays in input shape.
 * The factory closes both gaps: bad config hard-fails at import, and the
 * returned {@link ResolvedHook} has defaults materialized, so scan-path output
 * matches what `defineStack({ hooks })` binding produces.
 *
 * Deliberately a pure parse — no advisory logic here. Handler-deprecation
 * warnings stay in the binder (`bindHooksToEngine`'s `warnLegacyHandler`
 * option), one place only.
 */
export function defineHook(config: Hook): ResolvedHook {
  return HookSchema.parse(config);
}
