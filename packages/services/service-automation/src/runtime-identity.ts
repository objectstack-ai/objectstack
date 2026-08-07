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
  /**
   * Service-principal label for audit attribution (`ExecutionContext.actor`,
   * ADR-0014 D2): `svc:flow:<flowName>` on a `runAs:'system'` run. It names
   * WHICH automation performed the write (ADR-0118 D5's "related field", not a
   * second actor spelling); the acting human, when the trigger resolved one,
   * rides {@link userId} beside it. Without at least one of the two the audit
   * writer records `user_id=null, actor=null` and the history UI renders
   * "Unknown user" (#4366). Attribution only — no security middleware keys on
   * it.
   */
  actor?: string;
  /**
   * Acting user id. On a `runAs:'user'` run it drives owner/role RLS. On a
   * `runAs:'system'` run it is carried through UNCHANGED from the trigger when
   * one resolved a user (#5494): elevation and anonymity are separate choices
   * (ADR-0073's authorization-vs-attribution axes; the #3783 approvals-mirror
   * `{ isSystem: true, userId }` shape), and the security middleware's
   * `isSystem` short-circuit precedes every gate that reads `userId`, so under
   * elevation it grants nothing — it only keeps the run's writes attributable
   * (`created_by`/`updated_by` audit stamps, `sys_audit_log` actor) and lets
   * record-change flows fired by those writes resolve the same triggering
   * human instead of being refused user-less (#3760).
   */
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
 *  - `runAs:'system'` → `{ isSystem: true, actor: 'svc:flow:<flowName>' }`,
 *    PLUS the trigger's `userId` / `tenantId` when the trigger resolved them
 *    (#5494) — the security middleware short-circuits on `isSystem`, so the
 *    run reads/writes with full access, bypassing RLS; the `actor` label and
 *    the carried-through acting user keep those writes attributable in the
 *    audit log and in the rows' own `created_by`/`updated_by` stamps
 *    (ADR-0014 D2, #4366), and the carried org lets the driver's tenant
 *    machinery fill `organization_id` on born rows like any user-path insert.
 *    `runAs` declares the run's AUTHORIZATION posture, not its identity
 *    (ADR-0073 D2) — discarding the trigger identity here is what used to
 *    insert rows with all three platform columns NULL: outside the org
 *    partition, and untouchable even by the triggering member (the default
 *    `owner_only_writes` RLS keys on `created_by`). Same envelope shape as
 *    the action-body seam's `{ ...caller, isSystem: true }` (the
 *    hotcrm#548-family fix in @objectstack/runtime) — one platform posture
 *    for "elevated, user-triggered" writers. A run whose trigger genuinely
 *    resolved no user (a schedule) stays user-less: the actor label +
 *    `flowRunId` are its provenance, and ADR-0118 D1 forbids inventing a
 *    sentinel or pseudo-user in its place.
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
    // Name the flow as the acting service principal (`svc:flow:<name>`,
    // ADR-0014 D2) — the audit writer falls back to `session.actor` when
    // `userId` is absent, which is what keeps a genuinely user-less run's
    // writes attributable instead of "Unknown user" (#4366).
    const actor = `svc:flow:${context.flowName ?? 'automation'}`;
    return {
      isSystem: true,
      actor,
      // #5494 — elevation is not anonymity. When the trigger resolved a user
      // (a manual run, a record-change fired by a user's write), carry them
      // through: `isSystem` alone decides authorization (the middleware
      // short-circuits before any gate reads `userId`), while the user drives
      // the platform's attribution stamps — `created_by`/`updated_by` via the
      // engine's audit hook — and downstream record-change dispatch, exactly
      // like the #3783 approvals mirror's `{ isSystem: true, userId }` writes.
      // A schedule-shaped trigger resolves no user and stays user-less; per
      // ADR-0118 D1 its actor representation IS null (never a sentinel).
      ...(context.userId ? { userId: context.userId } : {}),
      // #5494 — and elevation is not org-lessness either. The trigger's org
      // rides along, which is what makes the driver's tenant machinery treat
      // this run's INSERTs exactly like a user-path insert: `organization_id`
      // filled on rows that omit it (per-table opt-outs respected), autonumber
      // sequences org-scoped. Without it, every row a user-triggered system
      // sweep created was born org-NULL — outside the org partition, where
      // unique indexes don't bite and org-scoped queries don't look. Reads /
      // updates / deletes org-scope to `(org = trigger-org OR org IS NULL)` at
      // the driver — the same posture the action-body seam ships for its
      // `{ ...caller, isSystem: true }` envelope (the hotcrm#548-family fix):
      // the tenant wall survives elevation for an org-triggered run, while
      // org-NULL (pre-fix / global) rows stay reachable via the OR-NULL arm.
      // A run that must genuinely cross orgs is a user-less one (a schedule
      // carries no org, nothing narrows) or sets explicit fields.
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      positions: [],
      permissions: [],
      ...(flowRunId ? { flowRunId } : {}),
    };
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
 * Fill `owner_id` on a `runAs:'system'` create's payload from the run's acting
 * user, when the run has one and the flow did not set an owner itself (#5494).
 *
 * The ownership anchor is normally stamped by the security middleware ("an
 * empty `owner_id` is auto-stamped to the acting user", #3004 step 3.5), but
 * that middleware — including the stamp — short-circuits on `isSystem`, so for
 * a system-elevated write the payload is the only channel. Left NULL, the row
 * is born outside every owner-scoped grant: nobody's `own`-depth write scope
 * matches it, and repairing it needs a transfer grant the affected users may
 * not hold — #5494's "born untouchable even by admin". Stamping the ACTING
 * USER restores exactly the default the same trigger would have produced under
 * `runAs:'user'`; it does not put a system identity in the column (ADR-0118 D6
 * keeps `owner_id` a business-ownership axis — the system never owns records,
 * and ADR-0073 D3 forbids force-owning rows to an automation principal).
 *
 * Fill-only and schema-guarded:
 *  - an author-set `owner_id` in the node's `fields` wins (flow logic sets
 *    ownership explicitly — ADR-0073 D3), matching the middleware's own
 *    "empty means stamp" test (`null`/`''` count as empty);
 *  - objects that do not carry the column (`ownership: 'org' | 'none'`,
 *    platform-managed tables) are left alone — stamping would make the driver
 *    INSERT a column the table does not have. Same duck-typed `getSchema`
 *    posture as the engine's audit hook and plugin-security: no schema
 *    surface → no stamp (today's behavior, not an error).
 *  - a user-less system run (a schedule) stamps nothing: there is no acting
 *    user, and ADR-0118 D1 forbids a sentinel or pseudo-user in its place.
 */
export function stampSystemInsertOwner(
  fields: Record<string, unknown>,
  dataCtx: RunDataContext | undefined,
  data: unknown,
  objectName: string,
): void {
  if (!dataCtx || (dataCtx as RunIdentityContext).isSystem !== true) return;
  const userId = (dataCtx as RunIdentityContext).userId;
  if (!userId) return;
  // Own-property test + the middleware's own "empty" definition: a present,
  // non-empty owner is the author's explicit choice and is never overwritten.
  if (
    Object.prototype.hasOwnProperty.call(fields, 'owner_id') &&
    fields.owner_id != null &&
    fields.owner_id !== ''
  ) {
    return;
  }
  const getSchema = (data as { getSchema?: (o: string) => unknown } | null | undefined)?.getSchema;
  if (typeof getSchema !== 'function') return;
  try {
    const schema = getSchema.call(data, objectName) as { fields?: Record<string, unknown> } | null | undefined;
    const schemaFields = schema?.fields;
    if (!schemaFields || typeof schemaFields !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(schemaFields, 'owner_id')) return;
  } catch {
    return;
  }
  fields.owner_id = userId;
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
