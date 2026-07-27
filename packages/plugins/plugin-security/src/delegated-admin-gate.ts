// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D12] Delegated-administration write gate.
 *
 * "Administration itself becomes a scoped capability." Today whoever can
 * write the RBAC link tables can manage ALL permissions; this gate turns
 * those writes into a governed operation:
 *
 * - TENANT-LEVEL ADMINS (a resolved set carries the ADR-0066 superuser
 *   wildcard `objects['*'].modifyAllRecords`) keep the status quo — the gate
 *   passes and the ordinary CRUD/RLS checks decide (note the built-in
 *   `organization_admin` also passes here but is still denied downstream by
 *   its explicit per-table `allowEdit:false` overrides — unchanged).
 * - DELEGATES (non-tenant-admins holding ≥1 `adminScope`) may write ONLY
 *   what one of their scopes fully approves: the right kind of action
 *   (manageAssignments / manageBindings / authorEnvironmentSets), inside
 *   their BU subtree, handing out only allowlisted sets, with STRICT
 *   containment whenever the touched set itself carries an adminScope.
 * - EVERYONE ELSE is denied — holding plain CRUD on `sys_user_position`
 *   no longer makes you a permission administrator (fail closed, D12).
 *
 * The `everyone` / `guest` audience anchors stay tenant-level only: no
 * delegated scope can touch their bindings, and DIRECT position assignments
 * to an anchor are rejected for every caller (anchors are implicit — a
 * stored assignment row is a modeling error).
 *
 * System/boot writes carry `isSystem` and short-circuit the security
 * middleware before this gate (seeders, publish materializer, better-auth
 * reconciliation are unaffected).
 */

import { isGrantActive } from '@objectstack/core';
import type { AdminScope, PermissionSet } from '@objectstack/spec/security';
import { PermissionDeniedError } from './errors.js';

const SYSTEM_CTX = { isSystem: true } as const;
/** Max BU-tree depth walked when expanding a scope subtree (safety bound). */
const MAX_TREE_DEPTH = 32;
/** Max existing assignments examined for a binding blast-radius check. */
const BLAST_RADIUS_CAP = 500;
/** [ADR-0091 D3] Default self-delegation ceiling: 30 days. A "temporary"
 *  grant that can be rolled forever is a permanent grant with extra steps. */
const DEFAULT_DELEGATION_CEILING_MS = 30 * 24 * 60 * 60 * 1000;

/** Coerce a stored timestamp to epoch ms; undefined = absent, NaN = unparseable. */
function toEpochMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}

const GOVERNED_OBJECTS = new Set([
  'sys_user_position',
  'sys_position_permission_set',
  'sys_user_permission_set',
  'sys_permission_set',
]);
const GOVERNED_OPERATIONS = new Set(['insert', 'update', 'delete', 'transfer', 'restore', 'purge']);
const ANCHOR_POSITIONS = new Set(['everyone', 'guest']);

export interface DelegatedAdminGateDeps {
  /** ObjectQL engine handle (system-context reads for pre-images/lookups). */
  ql: any;
  /** Shared permission-set resolution (same path as the CRUD middleware). */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  logger?: { warn?: (msg: string, meta?: any) => void };
  /** [ADR-0091 D3] Clock for delegation validity/ceiling checks (tests inject). */
  now?: () => number;
  /** [ADR-0091 D3] Max self-delegation duration (ms). Default 30 days. */
  delegationCeilingMs?: number;
}

/**
 * [ADR-0090 D12 / ADR-0105 D8] What the caller may delegate — the read half
 * of the gate, shaped for a picker (see
 * {@link DelegatedAdminGate.describeDelegableScope}).
 */
export interface DelegableScopeReport {
  /** ADR-0066 superuser wildcard: unconstrained. The lists below then enumerate everything. */
  isTenantAdmin: boolean;
  /** Every `adminScope` the caller holds, with its subtree resolved to ids. */
  scopes: Array<{
    setName: string;
    businessUnit: string;
    includeSubtree: boolean;
    manageAssignments: boolean;
    manageBindings: boolean;
    authorEnvironmentSets: boolean;
    assignablePermissionSets: string[];
    businessUnitIds: string[];
  }>;
  /** Union of the subtrees where the caller may PLACE people (`manageAssignments`). */
  placeableBusinessUnitIds: string[];
  /** Positions the caller may assign — every set they distribute is allowlisted. */
  assignablePositions: string[];
}

interface HeldScope {
  /** The set that carries the scope (for error messages). */
  setName: string;
  scope: AdminScope & { assignablePermissionSets: string[] };
  /** Resolved BU ids covered (root + descendants when includeSubtree). Empty = misconfigured → approves nothing. */
  subtree: Set<string>;
}

function rowsOf(opCtx: any): any[] {
  const d = opCtx?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  return [];
}

function parseMaybeJson(v: unknown): any {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** ADR-0066 tenant-level admin: a resolved set whose '*' entry carries modifyAllRecords. */
export function isTenantAdmin(sets: PermissionSet[]): boolean {
  for (const ps of sets) {
    const objects: any = parseMaybeJson((ps as any).objects) ?? {};
    const wildcard = objects?.['*'];
    if (wildcard && wildcard.modifyAllRecords === true) return true;
  }
  return false;
}

/** Single scalar id from an update/delete opCtx (mirrors the engine's single-id rule). */
function extractSingleId(opCtx: any): string | number | null {
  const isScalar = (v: unknown): v is string | number =>
    v !== null && (typeof v === 'string' || typeof v === 'number');
  const data = opCtx?.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && isScalar(data.id)) return data.id;
  const whereId = opCtx?.options?.where?.id ?? opCtx?.where?.id ?? opCtx?.id;
  return isScalar(whereId) ? whereId : null;
}

export class DelegatedAdminGate {
  constructor(private readonly deps: DelegatedAdminGateDeps) {}

  /** Per-call caches (BU subtrees, position bindings) live on the instance
   *  only for the duration of one assert — recreated each call for freshness. */

  async assert(opCtx: any): Promise<void> {
    if (!GOVERNED_OBJECTS.has(opCtx?.object)) return;
    if (!GOVERNED_OPERATIONS.has(opCtx?.operation)) return;

    const ctx = opCtx.context ?? {};

    // ── Unconditional invariant: no stored assignments to audience anchors —
    //    they are implicit for whole principal classes (ADR-0090 D5/D9), so a
    //    row is at best inert and at worst a privilege-mask. Applies to every
    //    caller, tenant admins included (boot/system short-circuited earlier).
    if (opCtx.object === 'sys_user_position' && ['insert', 'update'].includes(opCtx.operation)) {
      for (const row of rowsOf(opCtx)) {
        const pos = String(row?.position ?? '');
        if (ANCHOR_POSITIONS.has(pos)) {
          throw new PermissionDeniedError(
            `[Security] Access denied: the '${pos}' audience anchor is implicit — it cannot be ` +
              `assigned via sys_user_position (ADR-0090 D9). Authenticated principals hold ` +
              `'everyone' and anonymous principals hold 'guest' automatically.`,
            { operation: opCtx.operation, object: opCtx.object, position: pos },
          );
        }
      }
    }

    // ── Principal-less non-system writes to RBAC tables: fail CLOSED. ──
    if (!ctx.userId) {
      throw new PermissionDeniedError(
        `[Security] Access denied: '${opCtx.operation}' on '${opCtx.object}' requires an ` +
          `authenticated administrator (ADR-0090 D12 — administration is a scoped capability).`,
        { operation: opCtx.operation, object: opCtx.object },
      );
    }

    let sets: PermissionSet[] = [];
    try {
      sets = await this.deps.resolveSets(ctx);
    } catch {
      sets = []; // resolution failure → treated as no authority (fail closed)
    }

    if (isTenantAdmin(sets)) return; // status quo — downstream CRUD/RLS decide

    // ── [ADR-0091 D3] Self-service delegation of duty (职务代理) ──────────
    // A write that STAMPS `delegated_from` is a delegation: the holder passes
    // their OWN hat, judged by delegation rules — not by an adminScope. This
    // is the ONE authority path open to a non-admin, so it is tried before the
    // held-scope resolution that would otherwise fail closed. (Tenant admins
    // short-circuited above; a scope-holding delegate who stamps
    // `delegated_from` is still held to the delegation invariants — a
    // delegation is a delegation regardless of who writes it.)
    if (this.isDelegationWrite(opCtx)) {
      return this.assertSelfDelegation(opCtx, ctx);
    }

    const held = await this.resolveHeldScopes(sets);
    if (held.length === 0) {
      throw new PermissionDeniedError(
        `[Security] Access denied: '${opCtx.operation}' on '${opCtx.object}' requires tenant-level ` +
          `administration or a delegated adminScope (ADR-0090 D12) — plain CRUD grants on RBAC ` +
          `tables do not make a permission administrator.`,
        { operation: opCtx.operation, object: opCtx.object, userId: ctx.userId },
      );
    }

    // Delegates may not run filter-writes — a mutation the gate cannot
    // attribute to ONE pre-imaged row cannot be boundary-checked (a broad
    // `where` with a patch payload would slip the subtree check otherwise).
    // Supported delegate shapes: insert with payload rows, or single-row
    // update/delete by scalar id.
    const isMutationWithoutId = ['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation)
      && extractSingleId(opCtx) == null;
    if (isMutationWithoutId) {
      throw new PermissionDeniedError(
        `[Security] Access denied: delegated administrators must target single rows by id on ` +
          `'${opCtx.object}' — filter writes cannot be checked against a delegation boundary.`,
        { operation: opCtx.operation, object: opCtx.object },
      );
    }

    switch (opCtx.object) {
      case 'sys_user_position':
        return this.assertAssignmentWrite(opCtx, ctx, held);
      case 'sys_user_permission_set':
        return this.assertDirectGrantWrite(opCtx, ctx, held);
      case 'sys_position_permission_set':
        return this.assertBindingWrite(opCtx, held);
      case 'sys_permission_set':
        return this.assertSetAuthoring(opCtx, held);
    }
  }

  /**
   * [ADR-0090 D6 × D12] Does the actor (via their resolved sets) hold a
   * delegated `adminScope` whose BU subtree covers `targetUserId`? Used by
   * the explain API: an administrator who can already manage a user's
   * assignments inside their delegation boundary may also read WHY that
   * user's access resolves the way it does — without tenant-level
   * `manage_users`. Any scope kind qualifies (assignments, bindings,
   * authoring): all of them administer capability inside the subtree, and
   * the report is read-only. Fail-closed: unresolvable scopes/memberships
   * cover nothing.
   */
  async scopesCoverUser(sets: PermissionSet[], targetUserId: string): Promise<boolean> {
    const held = await this.resolveHeldScopes(sets);
    if (held.length === 0) return false;
    const userBUs = await this.businessUnitsOfUser(targetUserId);
    if (userBUs.size === 0) return false;
    for (const s of held) {
      for (const bu of userBUs) if (s.subtree.has(bu)) return true;
    }
    return false;
  }

  /**
   * [ADR-0090 D12 / ADR-0105 D8] Describe what the caller may DELEGATE —
   * the read half of this gate.
   *
   * A UI that offers "place this person in a unit, with these positions"
   * (the D8 scoped-invitation form) must narrow its options to what the
   * issuer could actually assign; otherwise every picker lists the whole
   * tree and the user discovers the boundary only by being refused. The
   * lists here are computed by the SAME `resolveHeldScopes` /
   * `setsBoundToPosition` / containment helpers the write path enforces
   * with, so an option this report offers is one `assert()` accepts — the
   * picker narrows, it does not decide.
   *
   * Self-scoped by construction: the caller's own resolved sets are the
   * only input, so reading it discloses nothing beyond the authority they
   * already hold. Fail-closed shape: unresolvable scopes contribute
   * nothing, and a caller with no delegated authority gets empty lists.
   *
   * A tenant-level admin (ADR-0066 superuser wildcard) is unconstrained;
   * the report says so AND enumerates everything, so a consumer can render
   * one uniform picker instead of special-casing.
   */
  async describeDelegableScope(sets: PermissionSet[]): Promise<DelegableScopeReport> {
    const ql = this.deps.ql;
    const allPositions = async (): Promise<string[]> => {
      if (!ql?.find) return [];
      try {
        const rows = await ql.find('sys_position', { limit: 1000, context: SYSTEM_CTX });
        return (Array.isArray(rows) ? rows : [])
          .map((r: any) => String(r?.name ?? ''))
          .filter((n) => n && !ANCHOR_POSITIONS.has(n));
      } catch {
        return [];
      }
    };

    if (isTenantAdmin(sets)) {
      let businessUnitIds: string[] = [];
      if (ql?.find) {
        try {
          const rows = await ql.find('sys_business_unit', { limit: 5000, context: SYSTEM_CTX });
          businessUnitIds = (Array.isArray(rows) ? rows : [])
            .map((r: any) => String(r?.id ?? ''))
            .filter(Boolean);
        } catch {
          businessUnitIds = [];
        }
      }
      return {
        isTenantAdmin: true,
        scopes: [],
        placeableBusinessUnitIds: businessUnitIds,
        assignablePositions: await allPositions(),
      };
    }

    const held = await this.resolveHeldScopes(sets);
    const scopes = held.map((h) => ({
      setName: h.setName,
      businessUnit: h.scope.businessUnit,
      includeSubtree: h.scope.includeSubtree,
      manageAssignments: h.scope.manageAssignments,
      manageBindings: h.scope.manageBindings,
      authorEnvironmentSets: h.scope.authorEnvironmentSets,
      assignablePermissionSets: [...h.scope.assignablePermissionSets],
      businessUnitIds: [...h.subtree],
    }));

    // Placement needs `manageAssignments` — a bindings-only or authoring-only
    // scope administers capability without placing people.
    const placing = held.filter((h) => h.scope.manageAssignments);
    const placeableBusinessUnitIds = [...new Set(placing.flatMap((h) => [...h.subtree]))];

    // A position is assignable when at least ONE placing scope allowlists
    // every set it distributes — exactly `assertAssignmentWrite`'s test,
    // containment check included.
    const assignablePositions: string[] = [];
    if (placing.length > 0) {
      for (const positionName of await allPositions()) {
        const boundSets = await this.setsBoundToPosition(positionName);
        const ok = placing.some((s) =>
          boundSets.every(
            (bound) =>
              s.scope.assignablePermissionSets.includes(bound.name) &&
              this.assertScopeGrantContainment(bound, held, /*dryRun*/ true) === null,
          ),
        );
        if (ok) assignablePositions.push(positionName);
      }
    }

    return {
      isTenantAdmin: false,
      scopes,
      placeableBusinessUnitIds,
      assignablePositions,
    };
  }

  // ── [ADR-0091 D3] Self-service delegation of duty ────────────────────

  /** A delegation write = a `sys_user_position` INSERT whose rows stamp
   *  `delegated_from`. Insert-only by design: a delegation is not
   *  self-renewable (no update path to push `valid_until` forward — continuing
   *  past expiry requires a fresh delegation, leaving a new audit record). */
  private isDelegationWrite(opCtx: any): boolean {
    if (opCtx?.object !== 'sys_user_position' || opCtx?.operation !== 'insert') return false;
    return rowsOf(opCtx).some((r) => r?.delegated_from != null && r.delegated_from !== '');
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * A holder of a `delegatable` position may assign it to a delegate WITHOUT
   * being an administrator, iff every row is a well-formed delegation
   * (ADR-0091 D3):
   *  1. `delegated_from` = the writer (you delegate your OWN authority);
   *  2. mandatory `valid_until`, in the future, within the config ceiling;
   *  3. mandatory `reason` (dual-audit substrate);
   *  4. the delegator CURRENTLY holds the position (validity-filtered) and
   *     holds it DIRECTLY — a grant that itself arrived via delegation is not
   *     re-delegatable (chains are cut);
   *  5. the position is `delegatable: true`;
   *  6. the position distributes NO `adminScope`-carrying set (administration
   *     is never self-delegated — that would bypass the D12 containment gate);
   *  7. [cloud#830 follow-up] if the delegation carries a `business_unit_id`
   *     anchor, that anchor falls inside the delegator's OWN effective anchor
   *     for the position — a delegation may NARROW visibility, never widen it.
   * The writer is stamped into `granted_by` (dual audit: `granted_by` = writer,
   * `delegated_from` = authority source).
   */
  private async assertSelfDelegation(opCtx: any, ctx: any): Promise<void> {
    const now = this.now();
    const ceiling = this.deps.delegationCeilingMs ?? DEFAULT_DELEGATION_CEILING_MS;
    const ceilingDays = Math.round(ceiling / (24 * 60 * 60 * 1000));

    for (const row of rowsOf(opCtx)) {
      const deny = (reason: string, meta: Record<string, unknown> = {}): never => {
        throw new PermissionDeniedError(
          `[Security] Access denied: delegation of duty rejected — ${reason} (ADR-0091 D3).`,
          { operation: opCtx.operation, object: opCtx.object, ...meta },
        );
      };

      // Homogeneity: a delegation insert must be ALL delegations — a mixed
      // batch can't be audited as one authority act.
      const df = row?.delegated_from;
      if (df == null || df === '') {
        deny('a delegation insert may not mix delegation and non-delegation rows');
      }
      // 1. You may only delegate your OWN authority.
      if (String(df) !== String(ctx.userId)) {
        deny(`delegated_from '${df}' is not you — you may only delegate authority you hold yourself`);
      }
      const positionName = String(row?.position ?? '');
      if (!positionName) deny('the delegation names no position');

      const targetUser = row?.user_id != null ? String(row.user_id) : '';
      if (!targetUser) deny('the delegation names no delegate (user_id)');
      if (targetUser === String(ctx.userId)) {
        deny('you cannot delegate a position to yourself');
      }

      // 2. valid_until: mandatory, future, within ceiling.
      const until = toEpochMs(row?.valid_until);
      if (until === undefined) {
        deny(`'${positionName}' delegation requires a valid_until — an open-ended delegation is a permanent grant`, { position: positionName });
      }
      if (Number.isNaN(until as number)) deny('valid_until is not a parseable timestamp', { position: positionName });
      if (!((until as number) > now)) deny('valid_until is not in the future', { position: positionName });
      if ((until as number) > now + ceiling) {
        deny(`valid_until exceeds the ${ceilingDays}-day delegation ceiling`, { position: positionName });
      }

      // 3. reason: mandatory.
      if (typeof row?.reason !== 'string' || row.reason.trim().length === 0) {
        deny(`'${positionName}' delegation requires a reason (dual audit)`, { position: positionName });
      }

      // 4. Delegator currently holds it, directly (no re-delegation).
      const holdings = await this.activeHoldings(String(ctx.userId), positionName, now);
      const directHolding = holdings.some((h) => h.direct);
      if (!directHolding) {
        if (holdings.length > 0) {
          deny(`you hold '${positionName}' only via delegation — a delegated grant is not re-delegatable`, { position: positionName });
        }
        deny(`you do not currently hold '${positionName}' — only a current holder may delegate it`, { position: positionName });
      }

      // 4b. [cloud#830 follow-up] Anchor containment. `business_unit_id` is
      //     visibility LOAD-BEARING (cloud#830 made it the readScope depth
      //     anchor: a `unit`/`unit_and_below` holder sees the owner set rooted
      //     at this BU). "Anchoring only narrows, never widens" must therefore
      //     hold on THIS path too — otherwise a holder anchored at a low BU
      //     could hand a co-conspirator an ANCESTOR BU and leak that whole
      //     subtree's records, exceeding the delegator's own range (lateral
      //     escalation). So a delegated anchor must fall inside the delegator's
      //     OWN effective anchor for this position — same spirit as the D12
      //     delegated-admin subtree check (assertAssignmentWrite). Fail-closed:
      //     an anchor we cannot prove is inside the delegator's range is
      //     refused. An unanchored delegation row keeps the prior behavior (the
      //     delegate resolves to their own member BU — not a widening).
      const rowAnchor =
        row?.business_unit_id != null && row.business_unit_id !== '' ? String(row.business_unit_id) : null;
      if (rowAnchor) {
        const allowed = await this.delegatorAnchorSubtree(
          String(ctx.userId),
          holdings.filter((hd) => hd.direct),
        );
        if (!allowed.has(rowAnchor)) {
          deny(
            allowed.size === 0
              ? `business unit anchor '${rowAnchor}' cannot be validated against your own '${positionName}' anchor — an anchor that cannot be proven within your own range is refused (cloud#830: anchoring only narrows)`
              : `business unit anchor '${rowAnchor}' is outside your own effective anchor for '${positionName}' — a delegation may only narrow visibility, never widen it (cloud#830: anchoring only narrows)`,
            { position: positionName, businessUnitId: rowAnchor },
          );
        }
      }

      // 5. The position must opt in to delegation.
      if (!(await this.positionIsDelegatable(positionName))) {
        deny(`position '${positionName}' is not delegatable — set delegatable: true on the position to allow it`, { position: positionName });
      }

      // 6. A delegatable position must not distribute administration.
      const boundSets = await this.setsBoundToPosition(positionName);
      for (const b of boundSets) {
        if (parseMaybeJson((b as any).admin_scope ?? (b as any).adminScope)) {
          deny(`position '${positionName}' distributes the admin set '${b.name}' — administration cannot be self-delegated (D12 containment)`, { position: positionName, permissionSet: b.name });
        }
      }

      // Dual audit: stamp the writer (never overwrite an explicit value).
      if (row.granted_by == null) row.granted_by = ctx.userId;
    }
  }

  /** The actor's holdings of `positionName` that are inside their validity
   *  window, tagged `direct` when the holding itself did NOT arrive via
   *  delegation (only a direct holding is re-delegatable) and carrying each
   *  holding's own `businessUnitId` anchor (null = unanchored). The anchor of a
   *  direct holding bounds what a self-delegation of that position may hand out
   *  (cloud#830 — the anchor is visibility load-bearing). */
  private async activeHoldings(
    userId: string,
    positionName: string,
    now: number,
  ): Promise<Array<{ direct: boolean; businessUnitId: string | null }>> {
    const ql = this.deps.ql;
    if (!ql?.find) return [];
    let rows: any[] = [];
    try {
      rows = await ql.find('sys_user_position', {
        where: { user_id: userId, position: positionName },
        limit: 200,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => isGrantActive(r, now))
      .map((r) => ({
        direct: r?.delegated_from == null || r.delegated_from === '',
        businessUnitId:
          r?.business_unit_id != null && r.business_unit_id !== '' ? String(r.business_unit_id) : null,
      }));
  }

  private async positionIsDelegatable(positionName: string): Promise<boolean> {
    const ql = this.deps.ql;
    if (!ql?.find) return false;
    try {
      const rows = await ql.find('sys_position', { where: { name: positionName }, limit: 1, context: SYSTEM_CTX });
      const pos = Array.isArray(rows) && rows[0] ? rows[0] : null;
      const v = (pos as any)?.delegatable;
      return v === true || v === 1 || v === '1';
    } catch {
      return false;
    }
  }

  // ── sys_user_position: user ↔ position assignments ──────────────────

  private async assertAssignmentWrite(opCtx: any, ctx: any, held: HeldScope[]): Promise<void> {
    const targets = await this.materializeTargets(opCtx, 'sys_user_position');
    for (const t of targets) {
      const buId = t.next?.business_unit_id ?? null;
      const positionName = String(t.next?.position ?? t.prev?.position ?? '');
      const boundSets = positionName ? await this.setsBoundToPosition(positionName) : [];

      const failure = this.firstApprovalFailure(held, (s) => {
        if (!s.scope.manageAssignments) return 'the scope does not grant manageAssignments';
        // New/updated rows must be anchored inside the delegate's subtree.
        if (t.next) {
          if (!buId) return 'the assignment has no business_unit_id anchor — delegated assignments must target your subtree (ADR-0090 Addendum)';
          if (!s.subtree.has(String(buId))) return `business unit '${buId}' is outside the delegated subtree`;
        }
        // Pre-image (update/delete) must also lie inside the subtree — a
        // delegate can neither capture nor evict assignments beyond it.
        if (t.prev) {
          const prevBu = t.prev.business_unit_id ?? null;
          if (!prevBu) return 'the existing assignment is unanchored (no business_unit_id) — only a tenant admin may modify it';
          if (!s.subtree.has(String(prevBu))) return `the existing assignment's business unit '${prevBu}' is outside the delegated subtree`;
        }
        // Every set the position distributes must be allowlisted.
        for (const bound of boundSets) {
          if (!s.scope.assignablePermissionSets.includes(bound.name)) {
            return `position '${positionName}' distributes permission set '${bound.name}', which is not in the scope's allowlist`;
          }
          const contained = this.assertScopeGrantContainment(bound, held, /*dryRun*/ true);
          if (contained) return contained;
        }
        return null;
      });
      if (failure) {
        throw new PermissionDeniedError(
          `[Security] Access denied: delegated '${opCtx.operation}' on sys_user_position rejected — ${failure}.`,
          { operation: opCtx.operation, object: opCtx.object, position: positionName },
        );
      }
      // Audit stamp: who granted this (insert only; never overwrite an explicit value).
      if (opCtx.operation === 'insert' && t.next && t.next.granted_by == null && ctx.userId) {
        t.next.granted_by = ctx.userId;
      }
    }
  }

  // ── sys_user_permission_set: direct user ↔ set grants ───────────────

  private async assertDirectGrantWrite(opCtx: any, ctx: any, held: HeldScope[]): Promise<void> {
    const targets = await this.materializeTargets(opCtx, 'sys_user_permission_set');
    for (const t of targets) {
      const row = t.next ?? t.prev ?? {};
      const setRow = await this.loadSetRowById(row.permission_set_id);
      const setName = String(setRow?.name ?? row.permission_set_id ?? '');
      const targetUserId = row.user_id ? String(row.user_id) : null;
      const userBUs = targetUserId ? await this.businessUnitsOfUser(targetUserId) : new Set<string>();

      const failure = this.firstApprovalFailure(held, (s) => {
        if (!s.scope.manageAssignments) return 'the scope does not grant manageAssignments';
        if (!s.scope.assignablePermissionSets.includes(setName)) {
          return `permission set '${setName}' is not in the scope's allowlist`;
        }
        if (!targetUserId) return 'the grant names no target user';
        if (userBUs.size === 0) return `target user '${targetUserId}' has no business-unit membership — only a tenant admin may grant outside the tree`;
        let inSubtree = false;
        for (const bu of userBUs) if (s.subtree.has(bu)) { inSubtree = true; break; }
        if (!inSubtree) return `target user '${targetUserId}' is outside the delegated subtree`;
        if (setRow) {
          const contained = this.assertScopeGrantContainment(setRow, held, true);
          if (contained) return contained;
        }
        return null;
      });
      if (failure) {
        throw new PermissionDeniedError(
          `[Security] Access denied: delegated '${opCtx.operation}' on sys_user_permission_set rejected — ${failure}.`,
          { operation: opCtx.operation, object: opCtx.object, permissionSet: setName },
        );
      }
      if (opCtx.operation === 'insert' && t.next && t.next.granted_by == null && ctx.userId) {
        t.next.granted_by = ctx.userId;
      }
    }
  }

  // ── sys_position_permission_set: position ↔ set bindings ────────────

  private async assertBindingWrite(opCtx: any, held: HeldScope[]): Promise<void> {
    const targets = await this.materializeTargets(opCtx, 'sys_position_permission_set');
    for (const t of targets) {
      const row = t.next ?? t.prev ?? {};
      const positionName = await this.positionNameById(row.position_id);
      if (ANCHOR_POSITIONS.has(positionName)) {
        throw new PermissionDeniedError(
          `[Security] Access denied: bindings of the '${positionName}' audience anchor are ` +
            `tenant-level only — no delegated scope can touch them (ADR-0090 D12).`,
          { operation: opCtx.operation, object: opCtx.object, position: positionName },
        );
      }
      const setRow = await this.loadSetRowById(row.permission_set_id);
      const setName = String(setRow?.name ?? row.permission_set_id ?? '');
      const radius = positionName ? await this.assignmentAnchorsOfPosition(positionName) : { anchors: new Set<string>(), overCap: false, unanchored: 0 };

      const failure = this.firstApprovalFailure(held, (s) => {
        if (!s.scope.manageBindings) return 'the scope does not grant manageBindings';
        if (!s.scope.assignablePermissionSets.includes(setName)) {
          return `permission set '${setName}' is not in the scope's allowlist`;
        }
        // Blast radius: re-composing a position re-composes EVERY holder's
        // capability. A delegate may only do that when all current holders
        // sit inside their subtree (fail closed on unanchored/over-cap).
        if (radius.overCap) return `position '${positionName}' has more than ${BLAST_RADIUS_CAP} assignments — only a tenant admin may re-compose it`;
        if (radius.unanchored > 0) return `position '${positionName}' has ${radius.unanchored} unanchored assignment(s) (no business_unit_id) — only a tenant admin may re-compose it`;
        for (const bu of radius.anchors) {
          if (!s.subtree.has(bu)) return `position '${positionName}' is held in business unit '${bu}', outside the delegated subtree`;
        }
        if (setRow) {
          const contained = this.assertScopeGrantContainment(setRow, held, true);
          if (contained) return contained;
        }
        return null;
      });
      if (failure) {
        throw new PermissionDeniedError(
          `[Security] Access denied: delegated '${opCtx.operation}' on sys_position_permission_set rejected — ${failure}.`,
          { operation: opCtx.operation, object: opCtx.object, position: positionName, permissionSet: setName },
        );
      }
    }
  }

  // ── sys_permission_set: environment-set authoring ────────────────────

  private async assertSetAuthoring(opCtx: any, held: HeldScope[]): Promise<void> {
    // Package-managed rows were already rejected by the two-doors gate; what
    // reaches here is environment-owned authoring.
    const targets = await this.materializeTargets(opCtx, 'sys_permission_set');
    for (const t of targets) {
      const payload = t.next ?? {};
      const existing = t.prev ?? null;
      const setName = String(payload.name ?? existing?.name ?? '');
      const authoredScope: AdminScope | undefined =
        parseMaybeJson(payload.admin_scope ?? payload.adminScope) ?? undefined;

      const failure = this.firstApprovalFailure(held, (s) => {
        if (!s.scope.authorEnvironmentSets) return 'the scope does not grant authorEnvironmentSets';
        // Mutating/deleting an existing env set is only in-domain when the
        // delegate distributes it (allowlist); fresh inserts are inert until
        // distributed, so they pass this check.
        if (existing && !s.scope.assignablePermissionSets.includes(setName)) {
          return `environment set '${setName}' is outside the scope's allowlist — only its tenant-level owner may change it`;
        }
        return null;
      });
      if (failure) {
        throw new PermissionDeniedError(
          `[Security] Access denied: delegated '${opCtx.operation}' on sys_permission_set rejected — ${failure}.`,
          { operation: opCtx.operation, object: opCtx.object, permissionSet: setName },
        );
      }

      // A delegate may suggest nothing tenant-wide: isDefault is the D5
      // install-suggestion to bind to `everyone` — tenant-level only.
      if (t.next && (t.next.isDefault === true || t.next.is_default === true)) {
        throw new PermissionDeniedError(
          `[Security] Access denied: 'isDefault' (the everyone-binding suggestion) is tenant-level ` +
            `only — a delegated administrator cannot set it (ADR-0090 D12).`,
          { operation: opCtx.operation, object: opCtx.object, permissionSet: setName },
        );
      }

      // Authoring a set that CARRIES an adminScope = minting administration:
      // requires a held scope that STRICTLY contains the minted one.
      if (authoredScope) {
        const containment = await this.checkStrictContainment(authoredScope, held);
        if (containment) {
          throw new PermissionDeniedError(
            `[Security] Access denied: the authored adminScope is not strictly contained by your ` +
              `own — ${containment} (ADR-0090 D12: granting an admin scope requires holding a scope ` +
              `that strictly contains it).`,
            { operation: opCtx.operation, object: opCtx.object, permissionSet: setName },
          );
        }
      }
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────

  /** First scope that fully approves wins; otherwise the FIRST failure reason
   *  from the LAST scope tried is surfaced (all scopes rejected). */
  private firstApprovalFailure(
    held: HeldScope[],
    check: (s: HeldScope) => string | null,
  ): string | null {
    let lastReason: string | null = null;
    for (const s of held) {
      const reason = check(s);
      if (reason == null) return null;
      lastReason = `${reason} (scope from '${s.setName}')`;
    }
    return lastReason ?? 'no delegated scope applies';
  }

  /**
   * If `setRowOrDef` itself carries an adminScope, verify strict containment
   * against the actor's held scopes. Returns a failure description or null.
   * (`dryRun` callers use the string as a per-scope rejection reason.)
   */
  private assertScopeGrantContainment(setRowOrDef: any, held: HeldScope[], _dryRun: boolean): string | null {
    const carried: AdminScope | undefined =
      parseMaybeJson(setRowOrDef.admin_scope ?? setRowOrDef.adminScope) ?? undefined;
    if (!carried) return null;
    // NOTE: containment needs resolved subtrees — checked synchronously against
    // the pre-resolved held scopes; the carried scope's subtree is resolved in
    // checkStrictContainment for the authoring path. For grant paths we compare
    // conservatively by definition (name + flags + allowlist).
    for (const s of held) {
      if (this.definitionContainsStrictly(s.scope, carried)) return null;
    }
    return `granting set '${setRowOrDef.name ?? '?'}' would hand out an adminScope not strictly contained by yours`;
  }

  /** Definition-level strict containment (no tree resolution): same-root-or-
   *  narrower BU (equal root only when outer includes subtree and inner is the
   *  same or a descendant — without the tree we accept equal root + subtree,
   *  or require the authoring path's resolved check), rights ⊇, allowlist ⊇,
   *  and NOT identical. Conservative: unknown ⇒ not contained. */
  private definitionContainsStrictly(outer: HeldScope['scope'], inner: AdminScope): boolean {
    const innerFull = {
      includeSubtree: inner.includeSubtree !== false,
      manageAssignments: inner.manageAssignments === true,
      manageBindings: inner.manageBindings === true,
      authorEnvironmentSets: inner.authorEnvironmentSets === true,
      assignable: (inner.assignablePermissionSets ?? []) as string[],
    };
    // BU axis (definition level): identical root, and inner must not cover
    // MORE of the tree than outer.
    if (inner.businessUnit !== outer.businessUnit) return false;
    if (innerFull.includeSubtree && outer.includeSubtree === false) return false;
    // Rights axis: inner ⊆ outer.
    if (innerFull.manageAssignments && !outer.manageAssignments) return false;
    if (innerFull.manageBindings && !outer.manageBindings) return false;
    if (innerFull.authorEnvironmentSets && !outer.authorEnvironmentSets) return false;
    // Allowlist axis: inner ⊆ outer.
    for (const name of innerFull.assignable) {
      if (!outer.assignablePermissionSets.includes(name)) return false;
    }
    // Strictness: some axis must be strictly smaller.
    const equalRights =
      innerFull.manageAssignments === (outer.manageAssignments === true) &&
      innerFull.manageBindings === (outer.manageBindings === true) &&
      innerFull.authorEnvironmentSets === (outer.authorEnvironmentSets === true);
    const equalTree = innerFull.includeSubtree === (outer.includeSubtree !== false);
    const equalAllow =
      innerFull.assignable.length === outer.assignablePermissionSets.length &&
      innerFull.assignable.every((n) => outer.assignablePermissionSets.includes(n));
    return !(equalRights && equalTree && equalAllow);
  }

  /** Authoring-path strict containment with resolved subtrees. Returns a
   *  failure description, or null when some held scope strictly contains. */
  private async checkStrictContainment(minted: AdminScope, held: HeldScope[]): Promise<string | null> {
    const mintedSubtree = await this.resolveSubtree(minted.businessUnit, minted.includeSubtree !== false);
    if (mintedSubtree.size === 0) return `its business unit '${minted.businessUnit}' does not resolve`;
    for (const s of held) {
      let treeContained = true;
      for (const bu of mintedSubtree) if (!s.subtree.has(bu)) { treeContained = false; break; }
      if (!treeContained) continue;
      if ((minted.manageAssignments === true) && !s.scope.manageAssignments) continue;
      if ((minted.manageBindings === true) && !s.scope.manageBindings) continue;
      if ((minted.authorEnvironmentSets === true) && !s.scope.authorEnvironmentSets) continue;
      const mintedAllow = minted.assignablePermissionSets ?? [];
      if (!mintedAllow.every((n) => s.scope.assignablePermissionSets.includes(n))) continue;
      // Strictness on the resolved tuple.
      const equalTree = mintedSubtree.size === s.subtree.size;
      const equalRights =
        (minted.manageAssignments === true) === (s.scope.manageAssignments === true) &&
        (minted.manageBindings === true) === (s.scope.manageBindings === true) &&
        (minted.authorEnvironmentSets === true) === (s.scope.authorEnvironmentSets === true);
      const equalAllow =
        mintedAllow.length === s.scope.assignablePermissionSets.length &&
        mintedAllow.every((n) => s.scope.assignablePermissionSets.includes(n));
      if (equalTree && equalRights && equalAllow) continue; // identical — not STRICT
      return null;
    }
    return 'no held scope covers its subtree, rights and allowlist with room to spare';
  }

  /** Resolve every adminScope carried by the actor's resolved sets. */
  private async resolveHeldScopes(sets: PermissionSet[]): Promise<HeldScope[]> {
    const out: HeldScope[] = [];
    for (const ps of sets) {
      const raw = parseMaybeJson((ps as any).adminScope ?? (ps as any).admin_scope);
      if (!raw || typeof raw !== 'object' || typeof raw.businessUnit !== 'string') continue;
      const scope = {
        businessUnit: raw.businessUnit,
        includeSubtree: raw.includeSubtree !== false,
        manageAssignments: raw.manageAssignments === true,
        manageBindings: raw.manageBindings === true,
        authorEnvironmentSets: raw.authorEnvironmentSets === true,
        assignablePermissionSets: Array.isArray(raw.assignablePermissionSets)
          ? raw.assignablePermissionSets.filter((n: unknown): n is string => typeof n === 'string')
          : [],
      };
      const subtree = await this.resolveSubtree(scope.businessUnit, scope.includeSubtree);
      out.push({ setName: (ps as any).name ?? '?', scope, subtree });
    }
    return out;
  }

  /** BU name → covered BU-id set (root + descendants when includeSubtree). */
  private async resolveSubtree(businessUnitName: string, includeSubtree: boolean): Promise<Set<string>> {
    const ql = this.deps.ql;
    if (!ql?.find) return new Set<string>();
    let root: any = null;
    try {
      const roots = await ql.find('sys_business_unit', { where: { name: businessUnitName }, limit: 1, context: SYSTEM_CTX });
      root = Array.isArray(roots) && roots[0] ? roots[0] : null;
    } catch { root = null; }
    if (!root?.id) return new Set<string>(); // misconfigured scope → approves nothing (fail closed)
    if (!includeSubtree) return new Set<string>([String(root.id)]);
    return this.resolveSubtreeById(String(root.id));
  }

  /** BU id → covered BU-id set (root id + all descendants). Subtree is always
   *  walked: the delegator's readScope depth is not known on the delegation
   *  path, so the whole subtree is the containment bound — matching the D12
   *  admin subtree check. Fail-closed on unresolvable ids (empty set). */
  private async resolveSubtreeById(rootId: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const ql = this.deps.ql;
    if (!ql?.find || !rootId) return ids;
    ids.add(String(rootId));
    let frontier: string[] = [String(rootId)];
    for (let depth = 0; depth < MAX_TREE_DEPTH && frontier.length > 0; depth++) {
      let children: any[] = [];
      try {
        children = await ql.find('sys_business_unit', {
          where: { parent_business_unit_id: { $in: frontier } },
          limit: 5000,
          context: SYSTEM_CTX,
        });
      } catch { children = []; }
      const next: string[] = [];
      for (const c of Array.isArray(children) ? children : []) {
        const id = String((c as any)?.id ?? '');
        if (id && !ids.has(id)) { ids.add(id); next.push(id); }
      }
      frontier = next;
    }
    return ids;
  }

  /** [cloud#830 follow-up] The union BU-subtree covered by the delegator's OWN
   *  DIRECT holdings of a position: subtree(anchor) for each anchored holding,
   *  plus subtree(member BU) for each unanchored holding (an unanchored holding
   *  resolves the depth anchor to the holder's own membership). A self-delegated
   *  `business_unit_id` anchor must fall inside this set. Fail-closed:
   *  unresolvable holdings/memberships contribute nothing, so an anchor that
   *  can't be proven inside the delegator's range is refused upstream. */
  private async delegatorAnchorSubtree(
    userId: string,
    directHoldings: Array<{ businessUnitId: string | null }>,
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    let memberSubtreeResolved = false;
    for (const h of directHoldings) {
      if (h.businessUnitId) {
        for (const id of await this.resolveSubtreeById(h.businessUnitId)) allowed.add(id);
      } else if (!memberSubtreeResolved) {
        // An unanchored direct holding resolves to the delegator's own member
        // BU(s); resolve those once (they don't vary by holding).
        memberSubtreeResolved = true;
        for (const bu of await this.businessUnitsOfUser(userId)) {
          for (const id of await this.resolveSubtreeById(bu)) allowed.add(id);
        }
      }
    }
    return allowed;
  }

  /** Rows targeted by this write: `{ next, prev }` per row (prev = pre-image on update/delete). */
  private async materializeTargets(opCtx: any, object: string): Promise<Array<{ next: any | null; prev: any | null }>> {
    const op = opCtx.operation;
    const payload = rowsOf(opCtx);
    if (op === 'insert') return payload.map((r) => ({ next: r, prev: null }));

    const id = extractSingleId(opCtx);
    let prev: any = null;
    if (id != null && this.deps.ql?.findOne) {
      prev = await this.deps.ql
        .findOne(object, { where: { id }, context: SYSTEM_CTX })
        .catch(() => null);
    }
    if (op === 'update') {
      const next = payload.length > 0 ? payload[0] : null;
      // Merge unchanged pre-image values so boundary checks see the full row
      // (an update payload may carry only the changed columns).
      const merged = next && prev ? { ...prev, ...next } : next ?? prev;
      return [{ next: merged, prev }];
    }
    // delete / transfer / restore / purge — judged on the pre-image alone.
    return [{ next: null, prev }];
  }

  private async setsBoundToPosition(positionName: string): Promise<Array<{ name: string; admin_scope?: any }>> {
    const ql = this.deps.ql;
    if (!ql?.find) return [];
    try {
      const posRows = await ql.find('sys_position', { where: { name: positionName }, limit: 1, context: SYSTEM_CTX });
      const pos = Array.isArray(posRows) && posRows[0] ? posRows[0] : null;
      if (!pos?.id) return [];
      const bindings = await ql.find('sys_position_permission_set', {
        where: { position_id: pos.id },
        limit: 1000,
        context: SYSTEM_CTX,
      });
      const setIds = (Array.isArray(bindings) ? bindings : [])
        .map((b: any) => b?.permission_set_id)
        .filter(Boolean);
      if (setIds.length === 0) return [];
      const setRows = await ql.find('sys_permission_set', {
        where: { id: { $in: setIds } },
        limit: setIds.length,
        context: SYSTEM_CTX,
      });
      return (Array.isArray(setRows) ? setRows : [])
        .map((r: any) => ({ name: String(r?.name ?? ''), admin_scope: r?.admin_scope }))
        .filter((r: any) => r.name);
    } catch {
      return [];
    }
  }

  private async loadSetRowById(id: unknown): Promise<any | null> {
    if (id == null || !this.deps.ql?.find) return null;
    try {
      const rows = await this.deps.ql.find('sys_permission_set', { where: { id }, limit: 1, context: SYSTEM_CTX });
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch {
      return null;
    }
  }

  private async positionNameById(id: unknown): Promise<string> {
    if (id == null || !this.deps.ql?.find) return '';
    try {
      const rows = await this.deps.ql.find('sys_position', { where: { id }, limit: 1, context: SYSTEM_CTX });
      return String((Array.isArray(rows) && rows[0] ? (rows[0] as any).name : '') ?? '');
    } catch {
      return '';
    }
  }

  /** BU anchors of every current assignment of a position (blast radius). */
  private async assignmentAnchorsOfPosition(
    positionName: string,
  ): Promise<{ anchors: Set<string>; overCap: boolean; unanchored: number }> {
    const anchors = new Set<string>();
    let unanchored = 0;
    const ql = this.deps.ql;
    if (!ql?.find) return { anchors, overCap: false, unanchored };
    let rows: any[] = [];
    try {
      rows = await ql.find('sys_user_position', {
        where: { position: positionName },
        limit: BLAST_RADIUS_CAP + 1,
        context: SYSTEM_CTX,
      });
    } catch {
      rows = [];
    }
    const list = Array.isArray(rows) ? rows : [];
    if (list.length > BLAST_RADIUS_CAP) return { anchors, overCap: true, unanchored };
    for (const r of list) {
      const bu = (r as any)?.business_unit_id;
      if (bu == null || bu === '') unanchored += 1;
      else anchors.add(String(bu));
    }
    return { anchors, overCap: false, unanchored };
  }

  /** Target user's BU memberships (sys_business_unit_member ∪ primary projection). */
  private async businessUnitsOfUser(userId: string): Promise<Set<string>> {
    const out = new Set<string>();
    const ql = this.deps.ql;
    if (!ql?.find) return out;
    try {
      const memberships = await ql.find('sys_business_unit_member', {
        where: { user_id: userId },
        limit: 1000,
        context: SYSTEM_CTX,
      });
      for (const m of Array.isArray(memberships) ? memberships : []) {
        const bu = (m as any)?.business_unit_id;
        if (bu != null && bu !== '') out.add(String(bu));
      }
    } catch { /* table may not exist in minimal harnesses */ }
    if (out.size === 0) {
      try {
        const users = await ql.find('sys_user', { where: { id: userId }, limit: 1, context: SYSTEM_CTX });
        const primary = Array.isArray(users) && users[0] ? (users[0] as any).primary_business_unit_id : null;
        if (primary != null && primary !== '') out.add(String(primary));
      } catch { /* ignore */ }
    }
    return out;
  }
}
