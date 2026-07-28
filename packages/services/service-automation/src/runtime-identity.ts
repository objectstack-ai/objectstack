// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext } from '@objectstack/spec/contracts';

/**
 * The IDENTITY envelope a flow's data nodes pass to ObjectQL as
 * `options.context` when the run resolves a principal. A structural subset of
 * the kernel `ExecutionContext` — it always carries the three fields the
 * security middleware keys on (`isSystem`, `positions`, `permissions`) so it is
 * directly assignable to the engine's `context` option, plus the optional
 * `userId`/`tenantId` of the acting user.
 */
export interface RunIdentityContext {
  /** Elevated, RLS-bypassing system principal (full access) when true. */
  isSystem: boolean;
  /** Acting user id — drives owner/role RLS for `runAs:'user'` runs. */
  userId?: string;
  /** Acting user's role names (RLS parity with a direct REST request). */
  positions: string[];
  /** Acting user's explicit permission-set names. */
  permissions: string[];
  /** Acting user's tenant/org id. */
  tenantId?: string;
  /**
   * The run performing this operation (#3456). Provenance only — it is not part
   * of the identity the security middleware evaluates, so it neither widens nor
   * narrows what the run may touch. Hooks use it to recognize a run's writes to
   * state that run itself opened (the approvals record lock).
   */
  flowRunId?: string;
}

/**
 * The PROVENANCE-ONLY envelope, for a run that resolves NO principal — an
 * effective `runAs:'user'` run with no trigger user, a schedule being the
 * canonical case (#3712).
 *
 * It names the run that made the write and carries nothing else: no `userId`,
 * no `positions`, no `permissions`, not even `isSystem: false`. That absence is
 * the point. Every principal gate in the data security middleware keys on one
 * of those fields — the elevation short-circuit on `isSystem`, the ADR-0103
 * engine-owned write guard and the ADR-0090 D12 delegated-admin gate on
 * `context.userId`, the empty-principal fall-open on
 * `positions`/`permissions`/`userId` (and the delegated-admin gate normalizes a
 * missing context to `{}` before testing it) — so this envelope is
 * indistinguishable from passing no context at all. The run's authorization
 * stays EXACTLY the documented #1888 unscoped fail-open it was before; only
 * provenance rides along.
 */
export interface RunProvenanceContext {
  /** The run performing this operation. The whole envelope (#3712). */
  flowRunId: string;
}

/** What a flow's data nodes pass to ObjectQL as `options.context`. */
export type RunDataContext = RunIdentityContext | RunProvenanceContext;

/**
 * Translate a flow run's {@link AutomationContext} into the ObjectQL `context`
 * its CRUD nodes must pass, honoring `runAs` (ADR-0049 / #1888):
 *
 *  - `runAs:'system'` → `{ isSystem: true }` — the security middleware
 *    short-circuits, so the run reads/writes with full access, bypassing RLS.
 *  - `runAs:'user'` (default) → the triggering user's identity
 *    (`{ userId, positions, permissions, tenantId? }`), so the security middleware
 *    enforces that user's row-level security. The run can never exceed the
 *    triggering user's grants. Empty `positions` falls back to the platform's
 *    baseline permission set, exactly like a fresh member's own REST request.
 *  - neither (an effective `runAs:'user'` run with no trigger user — a
 *    schedule) → a {@link RunProvenanceContext}: the run id and nothing else,
 *    so the middleware still sees no principal and the run still executes under
 *    the documented #1888 unscoped fail-open, while hooks can tell whose run
 *    made the write (#3712). `undefined` only when there is no run id either.
 *
 * The engine sets {@link AutomationContext.runAs} on the run context at setup;
 * this function is the single place that maps it to an ObjectQL context, shared
 * by every data-touching node so the policy can't drift between node types.
 */
export function resolveRunDataContext(context: AutomationContext | undefined): RunDataContext | undefined {
  const flowRunId = context?.flowRunId;
  if (context?.runAs === 'system') {
    return { isSystem: true, positions: [], permissions: [], ...(flowRunId ? { flowRunId } : {}) };
  }
  if (!context?.userId) {
    // #3712 — no identity to present, but there IS a run. Carry the run id
    // ALONE (see {@link RunProvenanceContext}): provenance without a principal,
    // so the approvals record lock can recognise the owning run's write to its
    // own target record (#3456) while the security middleware sees exactly what
    // it saw before — nothing to key on. Manufacturing a *principal* here (even
    // `{ isSystem: false, positions: [], permissions: [] }`) would be the wrong
    // tool: it would tie this fix to the #1888 fail-open's fate instead of
    // leaving that decision open.
    return flowRunId ? { flowRunId } : undefined;
  }
  // `context` is now narrowed to a defined AutomationContext with a userId.
  const out: RunIdentityContext = {
    isSystem: false,
    userId: context.userId,
    positions: Array.isArray(context.positions) ? context.positions : [],
    permissions: Array.isArray(context.permissions) ? context.permissions : [],
  };
  if (context.tenantId) out.tenantId = context.tenantId;
  if (flowRunId) out.flowRunId = flowRunId;
  return out;
}

/**
 * Node types that perform an ObjectQL data operation — the ones that thread
 * {@link resolveRunDataContext} into the data engine as `options.context`. A
 * run's `runAs` only has teeth for a flow that contains at least one of these:
 * a flow that merely sends email / waits / branches touches no data, so its
 * execution identity is moot.
 */
export const DATA_NODE_TYPES: ReadonlySet<string> = new Set([
  'get_record',
  'create_record',
  'update_record',
  'delete_record',
]);

/** True when `flow` contains at least one data-operation node ({@link DATA_NODE_TYPES}). */
export function flowTouchesData(flow: { nodes?: ReadonlyArray<{ type?: string }> } | undefined): boolean {
  return !!flow?.nodes?.some((n) => typeof n?.type === 'string' && DATA_NODE_TYPES.has(n.type));
}

/**
 * True when a run's effective identity is the fail-open *unscoped* case: an
 * effective `runAs:'user'` (explicit or defaulted) with NO resolvable trigger
 * user — e.g. a schedule-triggered run, which has no user to scope to (#1888).
 *
 * {@link resolveRunDataContext} resolves no principal for this case — the CRUD
 * node passes either no `options.context` at all or a provenance-only one
 * (#3712), neither of which presents an identity — and the data security
 * middleware, which *skips* when there is no identity (delegating auth to the
 * auth layer), runs the operation UNSCOPED (effectively elevated). An author
 * who left `runAs` at the
 * `'user'` default expecting a restricted run instead gets an unscoped one. The
 * engine uses this predicate to surface the footgun at run time (a loud warning,
 * not a silent elevation); the build-time lint `flow-schedule-runas-unscoped`
 * catches it earlier, and declaring `runAs:'system'` makes the elevation
 * explicit and intended (ADR-0049).
 */
export function runIsUnscopedUserMode(context: AutomationContext | undefined): boolean {
  return context?.runAs !== 'system' && !context?.userId;
}
