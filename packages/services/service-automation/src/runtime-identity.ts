// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext } from '@objectstack/spec/contracts';

/**
 * The identity envelope a flow's data nodes pass to ObjectQL as `options.context`.
 * A structural subset of the kernel `ExecutionContext` — it always carries the
 * three fields the security middleware keys on (`isSystem`, `positions`,
 * `permissions`) so it is directly assignable to the engine's `context` option,
 * plus the optional `userId`/`tenantId` of the acting user.
 */
export interface RunDataContext {
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
 *
 * Returns `undefined` when neither elevation nor a user identity applies (e.g. a
 * schedule-triggered `user`-mode run with no user). The CRUD node then omits the
 * `context` and the data engine applies its no-identity default — unchanged from
 * the pre-#1888 behavior for that (identity-less) case.
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
  // NOTE (#3456): the identity-less case below returns `undefined`, so a
  // schedule-triggered `runAs:'user'` run with no user carries NO context at all
  // — and therefore no `flowRunId` either, leaving it subject to the approvals
  // record lock on its own target record. Manufacturing a context here just to
  // carry the run id would flip that run from the documented unscoped fail-open
  // (#1888) to baseline-member RLS — a separate, larger behavior change. The
  // dead-run sweep in plugin-approvals is what recovers this shape.
  if (!context?.userId) return undefined;
  // `context` is now narrowed to a defined AutomationContext with a userId.
  const out: RunDataContext = {
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
 * {@link resolveRunDataContext} returns `undefined` for this case, so the CRUD
 * node omits `options.context` and the data security middleware — which *skips*
 * when there is no identity (delegating auth to the auth layer) — runs the
 * operation UNSCOPED (effectively elevated). An author who left `runAs` at the
 * `'user'` default expecting a restricted run instead gets an unscoped one. The
 * engine uses this predicate to surface the footgun at run time (a loud warning,
 * not a silent elevation); the build-time lint `flow-schedule-runas-unscoped`
 * catches it earlier, and declaring `runAs:'system'` makes the elevation
 * explicit and intended (ADR-0049).
 */
export function runIsUnscopedUserMode(context: AutomationContext | undefined): boolean {
  return context?.runAs !== 'system' && !context?.userId;
}
