// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext } from '@objectstack/spec/contracts';
import { markGuardRefusal } from './guard-refusal.js';

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
 * The PROVENANCE-ONLY envelope, for a run that resolves NO principal.
 *
 * It names the run that made the write and carries nothing else: no `userId`,
 * no `positions`, no `permissions`, not even `isSystem: false`. That absence is
 * the point. Every principal gate in the data security middleware keys on one
 * of those fields — the elevation short-circuit on `isSystem`, the ADR-0103
 * engine-owned write guard and the ADR-0090 D12 delegated-admin gate on
 * `context.userId`, the empty-principal fall-open on
 * `positions`/`permissions`/`userId` (and the delegated-admin gate normalizes a
 * missing context to `{}` before testing it) — so this envelope is
 * indistinguishable from passing no context at all.
 *
 * Since #3760 a principal-less run may no longer reach a DATA node at all
 * ({@link resolveRunDataContext} refuses), so this envelope is no longer the
 * carrier of the old #1888 fail-open. It survives for the non-data provenance
 * uses that motivated #3712 — a run id is still attributable without presenting
 * an identity it does not have.
 */
export interface RunProvenanceContext {
  /** The run performing this operation. The whole envelope (#3712). */
  flowRunId: string;
}

/**
 * Thrown when a run whose effective identity is the #1888 *unscoped* case tries
 * to perform a data operation (#3760).
 *
 * The refusal is the point: an effective `runAs:'user'` with no resolvable
 * trigger user used to execute its data nodes UNSCOPED — the data security
 * middleware skips when there is no principal, so the run read and wrote EVERY
 * row of EVERY tenant. `runAs:'user'` is an access-NARROWING declaration, and
 * ADR-0049's standing rule is that failing to resolve a narrowing declaration
 * must never resolve to a grant. So the operation is refused instead.
 *
 * Note this is strictly narrower than elevating to `isSystem`: the security
 * middleware's `isSystem` short-circuit fires BEFORE the package-managed-row,
 * system-row, audience-anchor and delegated-admin gates, so "unscoped" was
 * never equivalent to "system" and quietly re-badging these runs as system
 * would have WIDENED them.
 */
export class UnscopedRunDataAccessError extends Error {
  readonly code = 'AUTOMATION_UNSCOPED_RUN_DATA_ACCESS';

  constructor(context?: AutomationContext) {
    const where = [
      context?.object ? `object '${context.object}'` : undefined,
      context?.event ? `event '${context.event}'` : undefined,
      context?.flowRunId ? `run '${context.flowRunId}'` : undefined,
    ]
      .filter(Boolean)
      .join(', ');
    super(
      `[runAs] refusing a data operation${where ? ` (${where})` : ''}: this run's effective runAs is ` +
        `'user' but no trigger user could be resolved, so the operation would execute UNSCOPED ` +
        `(elevated, RLS-bypassing) rather than restricted to a user. Declare \`runAs: 'system'\` on the ` +
        `flow to make the elevation explicit and intended, or arrange for the trigger to supply a user ` +
        `(a write made with a system context carries none). (ADR-0049, #1888, #3760)`,
    );
    this.name = 'UnscopedRunDataAccessError';
    // #3863 — a guard refusal, so a `fault` edge must not route it. Elevation
    // is the thing being refused; letting a handler swallow it would turn one
    // declared edge into an opt-out from the ADR-0049 scoping check.
    markGuardRefusal(this);
  }
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
 *  - neither (an effective `runAs:'user'` run with no trigger user) → **throws**
 *    {@link UnscopedRunDataAccessError} (#3760). This used to return a
 *    provenance-only envelope and let the run proceed UNSCOPED — the #1888
 *    fail-open. A schedule is only the most obvious source of a user-less run;
 *    the commonest is a record-change flow fired by a write that carried no
 *    user (any `isSystem` plugin/service write, or a `runAs:'system'` flow's own
 *    data node — `isSystem` does NOT suppress trigger dispatch, only
 *    `skipTriggers` does). None of those are decidable at authoring time, which
 *    is why the refusal has to live here.
 *
 *    Elevation and anonymity are separate choices, and a service that elevates
 *    for a reason usually still knows who it is acting for. The approvals status
 *    mirror was the motivating example on both sides: it has to stay `isSystem`
 *    (the record is locked while its approval is live) but it now names the
 *    deciding user, so approvals cascades resolve here instead of being refused
 *    (#3783). Only its machine-driven sweeps stay user-less.
 *
 * The engine sets {@link AutomationContext.runAs} on the run context at setup;
 * this function is the single place that maps it to an ObjectQL context, shared
 * by every data-touching node so the policy can't drift between node types —
 * which is exactly why the refusal belongs here and not in each executor.
 *
 * @throws {UnscopedRunDataAccessError} when the run resolves no principal.
 */
export function resolveRunDataContext(context: AutomationContext | undefined): RunDataContext | undefined {
  const flowRunId = context?.flowRunId;
  if (context?.runAs === 'system') {
    return { isSystem: true, positions: [], permissions: [], ...(flowRunId ? { flowRunId } : {}) };
  }
  if (!context?.userId) {
    // #3760 — FAIL CLOSED. There is no identity to present, and presenting none
    // means the data security middleware skips every principal gate and runs the
    // operation unscoped. `runAs:'user'` asked for restriction; silently
    // delivering elevation is the fail-open ADR-0049 forbids. Refuse instead.
    //
    // Deliberately NOT `{ isSystem: true }`: the middleware's isSystem
    // short-circuit precedes the package-managed-row / system-row /
    // audience-anchor / delegated-admin gates that a principal-less context
    // still has to clear, so re-badging these runs as system would GRANT them
    // powers they never had (e.g. writing sys_user_position) rather than
    // preserving the status quo.
    throw new UnscopedRunDataAccessError(context);
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
 * True when a run has NO resolvable principal: an effective `runAs:'user'`
 * (explicit or defaulted) with no trigger user (#1888).
 *
 * A schedule is the shape the docs have always led with, but it is not the
 * common one. ANY run whose trigger resolved no user lands here — most often a
 * record-change flow fired by a write that carried no user, since `isSystem`
 * does not suppress trigger dispatch (only `skipTriggers` does). `time_relative`
 * and `api` triggers likewise supply no user.
 *
 * Since #3760 such a run may not touch data at all: {@link resolveRunDataContext}
 * throws {@link UnscopedRunDataAccessError} rather than handing the data engine
 * a principal-less context that the security middleware would wave straight
 * through. The engine uses this predicate to warn at run SETUP — before any node
 * executes — that a data-touching run is going to be refused, so the failure is
 * diagnosable rather than a surprise mid-flow. The build-time lint
 * `flow-runas-unscoped` rejects the statically-decidable shapes at
 * publish time. Declaring `runAs:'system'` makes the elevation explicit and
 * intended (ADR-0049).
 */
export function runIsUnscopedUserMode(context: AutomationContext | undefined): boolean {
  return context?.runAs !== 'system' && !context?.userId;
}
