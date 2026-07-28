// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Hook Lifecycle Events
 * Defines the interception points in the ObjectQL execution pipeline.
 */
import { lazySchema } from '../shared/lazy-schema';
import { HookBodySchema } from './hook-body.zod';
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
  // `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` with the
  // row-scoping predicate carried in `input` (there is no per-cardinality
  // `*Many` event — one write event covers one row or many, Salesforce's
  // bulk-first model). See #3195.
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
export const HookSchema = lazySchema(() => z.object({
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
   */
  object: z.union([z.string(), z.array(z.string())]).describe('Target object(s)'),

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
   * @example "status = 'active' AND amount > 1000"
   */
  condition: ExpressionInputSchema.optional().describe('Predicate (CEL); hook runs only when TRUE. e.g. P`record.status == "closed" && record.amount > 1000`'),

  /**
   * Human-readable description
   */
  description: z.string().optional().describe('Human-readable description of what this hook does'),

  /**
   * Retry Policy
   */
  retryPolicy: z.object({
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
   * - find (also fires for findOne): { ast: QueryAST, options: DriverOptions }
   * - insert: { doc: Record, options: DriverOptions }
   * - update (single id): { id: ID, data: Record, options: DriverOptions }
   * - update (bulk, multi:true): { ast: QueryAST, data: Record, options: DriverOptions }
   * - delete (single id): { id: ID, options: DriverOptions }
   * - delete (bulk, multi:true): { ast: QueryAST, options: DriverOptions }
   *
   * A bulk (`multi: true`) update/delete fires the SAME `beforeUpdate`/
   * `beforeDelete` events as a single-id write — the row-scoping predicate is
   * carried in `input.ast` (no per-row `id`). There is no separate `*Many`
   * event.
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
     * Active organization ID — the developer-facing name for the caller's
     * current org. Same value everywhere a developer reads the org: the
     * `organization_id` column, `current_user.organizationId` (RLS/sharing),
     * and seed rows. `null`/`undefined` on unscoped (platform/community) calls.
     *
     * The former `session.tenantId` alias (#3280) was removed in the v11 major
     * (#3290): read the org under this single blessed name. The generic
     * driver-layer isolation knob (`ExecutionContext.tenantId`,
     * `DriverOptions.tenantId`) is a distinct, configurable axis and is
     * deliberately untouched.
     */
    organizationId: z.string().optional().describe('Active organization ID (blessed developer-facing name)'),
    roles: z.array(z.string()).optional(),
    accessToken: z.string().optional(),
    isSystem: z.boolean().optional().describe('True when the call was made with an elevated system context (engine self-writes)'),
    skipTriggers: z.boolean().optional().describe('True when record-change automation (flow triggers) must be suppressed for this write — e.g. package seed replay. Lifecycle hooks still run.'),
    skipAutomations: z.boolean().optional().describe('True when metadata-bound automation hooks must be suppressed for this write — e.g. data import with "run automations" unchecked, or import undo. Implies skipTriggers; code-registered system hooks (audit, security) still run.'),
  }).optional().describe('Current session context'),

  /**
   * Write Provenance
   * WHAT produced this write, as opposed to WHO is calling ({@link session}).
   *
   * Server-stamped and never client-supplied. It is not an identity: nothing
   * here is evaluated by any security middleware, and it neither widens nor
   * narrows what the write may touch. It exists so a hook can tell "the actor
   * that OWNS some externalized state" from "an unrelated caller".
   *
   * Kept OUT of `session` on purpose. A writer can have provenance and no
   * identity at all — a schedule-triggered flow run resolves no principal — and
   * folding the two together would have forced such a run to present an empty
   * session, silently turning "no caller" into "an anonymous caller" for every
   * hook that gates on `session` being absent (#3712).
   */
  provenance: z.object({
    flowRunId: z.string().optional().describe('Id of the automation flow run performing this write, when it originates from a flow data node. Lets a hook recognize the run that OWNS state that run itself opened — the approvals record lock exempts the run holding the pending request (#3456).'),
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
   * (userId, tenantId, transaction).
   *
   * Usage in hooks:
   *   const users = ctx.api.object('user');
   *   const admin = await users.findOne({ filter: { role: 'admin' } });
   */
  api: z.unknown().optional().describe('Cross-object data access (ScopedContext)'),

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
export type ResolvedHook = z.output<typeof HookSchema>;
export type HookEventType = z.infer<typeof HookEvent>;
export type HookContext = z.infer<typeof HookContextSchema>;
