// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D12] Delegated-administration write gate.
 *
 * "Administration itself becomes a scoped capability." Today whoever can
 * write the RBAC link tables can manage ALL permissions; this gate turns
 * those writes into a governed operation:
 *
 * - TENANT-LEVEL ADMINS (a resolved set OTHER than the two organization-
 *   administrator sets carries the ADR-0066 superuser wildcard
 *   `objects['*'].modifyAllRecords` — the platform administrator's
 *   `admin_full_access`) keep the status quo — the gate passes and the
 *   ordinary CRUD/RLS checks decide.
 * - ORGANIZATION-LEVEL ADMINS (the D12 amendment of 2026-10-17, ruling of
 *   record 6228728551: a holder of `organization_admin` /
 *   `organization_admin_no_bypass` for the active organization who is not
 *   tenant-level) create and remove assignment rows of THEIR organization
 *   when every permission set the row distributes is inside the organization
 *   boundary ({@link organizationBoundaryFailure}): no wildcard superuser bit,
 *   no `adminScope`, only `scope: 'org'` capabilities, and not one of the sets
 *   the ADR keeps outside by name. Nothing else — no edit in place, no
 *   organization-less or foreign-organization row, no membership row.
 * - DELEGATES (non-tenant-admins holding ≥1 `adminScope`) may write ONLY
 *   what one of their scopes fully approves: the right kind of action
 *   (manageAssignments), inside their BU subtree, handing out only
 *   allowlisted sets, with STRICT containment whenever the granted set itself
 *   carries an adminScope. A position assignment hands out every set it
 *   grants — the sets its definition lists. The rows it governs are the two assignment tables
 *   (`sys_user_position`, `sys_user_permission_set`); the binding and set
 *   authoring rows retired with the catalog row objects (ADR-0131 D3), so a
 *   position's sets and a set's definition are written through the metadata
 *   door alone.
 * - EVERYONE ELSE is denied — holding plain CRUD on `sys_user_position`
 *   no longer makes you a permission administrator (fail closed, D12).
 *
 * DIRECT position assignments to the `everyone` / `guest` audience anchors
 * are rejected for every caller (anchors are implicit — a stored assignment
 * row is a modeling error).
 *
 * `sys_member` (organization membership) is likewise tenant-level only: no
 * `adminScope` axis expresses membership, and an admin-grade membership row is
 * auto-elevated to `organization_admin` — writing one mints an administrator
 * (#3697 follow-up), which is why an organization administrator may not write
 * one either: administrator status comes from the membership grade alone. The delegable way to add people is an INVITATION, whose
 * placement this gate authorizes and whose role the framework caps at the
 * issuer's own grade.
 *
 * System/boot writes carry `isSystem` and short-circuit the security
 * middleware before this gate (seeders, publish materializer, better-auth
 * reconciliation are unaffected). One system context stops short of that
 * bypass: a flow run's (`isSystem` with a `flowRunId`), whose writes to these
 * tables, `sys_invitation` included, are refused outright
 * (`flow-system-identity-write-refusal.ts`) — a `runAs: 'user'` run is judged
 * here instead, as the user it acts for.
 */

import {
  catalogEntryAddress,
  isGrantActive,
  permissionSetAddressKey,
  permissionSetHolderIsPlatform,
  resolveCatalogReference,
  securityCatalogReaderOf,
  storedPermissionSetScope,
  type SecurityCatalogEntry,
  type SecurityCatalogReader,
  type SecurityCatalogReferenceScope,
} from '@objectstack/core';
import { declaredHttpStatus } from '@objectstack/types';
import type { AdminScope, AdminScopeParsed, PermissionSet } from '@objectstack/spec/security';
import {
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN,
  ORGANIZATION_ADMIN_NO_BYPASS,
} from '@objectstack/spec';
import {
  MCP_AGENT_PERMISSION_SET_READ,
  MCP_AGENT_PERMISSION_SET_RESTRICTED,
  MCP_AGENT_PERMISSION_SET_WRITE,
} from '@objectstack/spec/ai';
import { DelegationScopeViolationError, PermissionDeniedError } from './errors.js';
import {
  resolveOwnOrganizationRow,
  rowOrganizationId,
  seedCtx as organizationScopedCtx,
} from './organization-scope.js';
import { GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';
import { isReservedIdentityName } from './objects/reserved-identity-names.js';

const SYSTEM_CTX = { isSystem: true } as const;
/**
 * Max by-name candidates read when resolving a scope's business-unit anchor.
 *
 * `sys_business_unit.name` carries NO uniqueness — the object's only unique
 * index is `(code, organization_id)` — so under a walled posture two
 * organizations may each hold a unit called `sales`. A `limit: 1` read
 * therefore answers "whichever row the driver ordered first", which is an id
 * ordering and not an organization. The anchor read asks for a small page of
 * candidates instead and {@link resolveOwnOrganizationRow} picks the caller's
 * own row out of it; a driver that honours the tenant scope has already
 * removed most of the others.
 */
const ANCHOR_CANDIDATE_LIMIT = 50;
/** Max BU-tree depth walked when expanding a scope subtree (safety bound). */
const MAX_TREE_DEPTH = 32;
/** [ADR-0091 D3] Default self-delegation ceiling: 30 days. A "temporary"
 *  grant that can be rolled forever is a permanent grant with extra steps. */
const DEFAULT_DELEGATION_CEILING_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The organization a delegated-admin resolution runs in — the caller's own
 * active organization, never a scan across all of them.
 *
 * The same spelling as `SecurityPlugin.callerOrganizationId`, and deliberately
 * so: the `adminScope` this gate resolves arrives on a permission set resolved
 * for THAT organization's caller. Resolving the scope's business-unit anchor in
 * any other organization pairs an authority held in one tenant with a tree
 * owned by another — which is what an unscoped by-name read did. (The set
 * itself is the security catalog's, which is environment-level — ADR-0131 D3;
 * the business units are not.)
 *
 * Under the `single` posture this is the Default Organization: since ADR-0131
 * C1 it exists from boot, and every session on a stock `single` deployment —
 * the administrator's and a delegate's alike — carries it as its active
 * organization. Undefined only for a context carrying no organization at all —
 * ADR-0123 D1's authenticated session with no active organization — and such
 * a context holds no delegated scope: no subtree, no covered or placeable unit,
 * no user it covers, and a write it would authorize is refused naming the
 * missing active organization (`resolveHeldScopes`, {@link NO_ACTIVE_ORGANIZATION}).
 * Nor is it offered a placeable unit as a tenant-level administrator
 * (`describeDelegableScope`): the units a report offers are read only for a
 * context that names its organization. There is no "every organization"
 * mode, here or in the resolver that loads the caller's sets
 * (`grantAppliesInTenant`, `@objectstack/core`).
 *
 * Under the `group` posture (ADR-0105 D2) this is the ACTIVE organization, not
 * the caller's whole membership set. That is the narrower of the two, which is
 * the direction a security boundary takes — and it is already the one the
 * permission-set load took, so the scope and its anchor stay in one tenant.
 */
function callerOrganizationId(context: any): string | undefined {
  const id = context?.organizationId ?? context?.tenantId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * [ADR-0123 D2/D4] The reason an administrator's write is refused for a
 * context that names no organization: the one wording the organization-level
 * branch and a delegated scope's refusal share, so the refusal names what is
 * missing — the active organization — and not a permission the caller holds.
 */
const NO_ACTIVE_ORGANIZATION = 'the request carries no active organization to administer';

/**
 * Does a `sys_user_position` row take effect in `organizationId`?
 *
 * The runtime resolver's own answer (`resolveAuthzContext` step 4, in
 * `@objectstack/core`, `grantAppliesInTenant`): a holding takes effect only in
 * its OWN organization. A holding stamped with a different organization grants
 * nothing here; an organization-less holding grants nowhere — the 18.0
 * ownership ceremony (ADR-0131 D10) attributes every such row before an
 * upgraded database boots, so one is invalid state, not a "global" holding;
 * and a context carrying no organization holds nothing.
 *
 * Every holding the gate reasons about goes through this, because
 * `sys_user_position.position` is a position NAME, the same string in every
 * organization that holds it (ADR-0131 D3: one environment catalog) — so under
 * a walled posture another organization's holding of the position is the same
 * string. The
 * gate must count exactly the holdings the runtime grants: counting another
 * organization's, or one the runtime reads as belonging to none, lets a user
 * self-delegate a position they do not hold there.
 */
function holdingTakesEffectIn(row: any, organizationId?: string): boolean {
  const org = rowOrganizationId(row);
  return !!organizationId && !!org && org === organizationId;
}

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
  'sys_user_permission_set',
  // [#3697 follow-up] Organization MEMBERSHIP is an authority surface too: a
  // row whose `role` is admin-grade is auto-elevated to `organization_admin`
  // by `auto-org-admin-grant.ts`, whose wildcard `modifyAllRecords` IS
  // `isTenantAdmin()`. So writing one mints a tenant admin — the same
  // escalation the invitation role cap closes on the issuance path.
  //
  // Unreachable today (every writer is a better-auth path running under
  // `isSystem`, short-circuited before this gate; the ADR-0092 D2 identity
  // write guard refuses user-context writes to better-auth tables upstream).
  // It is here so the chain does not silently reopen the day someone adds a
  // direct-write surface — a `case` label is not enforcement, and the call
  // site is what matters (AGENTS.md Prime Directive #10).
  'sys_member',
]);
/**
 * The verbs this gate governs. Exported because the flow-origin system refusal
 * (`flow-system-identity-write-refusal.ts`) judges the same set: a verb added
 * here is refused there too.
 */
export const GOVERNED_OPERATIONS: ReadonlySet<string> = new Set(['insert', 'update', 'delete', 'transfer', 'restore', 'purge']);
const ANCHOR_POSITIONS = new Set(['everyone', 'guest']);

/**
 * The governed objects whose rows record their writer in `granted_by` — a
 * `readonly` provenance column on both (ADR-0090 D12's dual audit: `granted_by`
 * = writer, `delegated_from` = authority source, `reason` = why).
 *
 * The writer is the value, so a caller does not get to name one: every
 * non-system insert that this gate admits is stamped with its own `userId`,
 * whatever the payload carried — tenant-level admins, delegates and
 * self-delegations alike. The stamp is assigned in place on the payload rows
 * BEFORE the engine's insert pipeline snapshots them; the engine's create-side
 * `readonly` strip does not judge `sys_` objects, so the stamp is what lands.
 * A non-system UPDATE gets no stamp: the column is `readonly`, so the engine's
 * update strip drops a caller's value and the row keeps its writer.
 *
 * System writers never reach this gate (`isSystem` short-circuits the security
 * middleware first) and keep the id or null they wrote: invitation placement
 * writes its issuer, the organization-admin reconcile the attributed human or
 * null, the platform-admin promotion null (ADR-0118 D1 — never a sentinel). A
 * flow run's system context writes no row here at all: it is refused ahead of
 * the bypass (`flow-system-identity-write-refusal.ts`).
 */
const GRANTED_BY_OBJECTS = new Set(['sys_user_position', 'sys_user_permission_set']);

/**
 * Stamp the writer into `granted_by` on every row of an admitted non-system
 * insert into a {@link GRANTED_BY_OBJECTS} table. Unconditional on purpose:
 * keeping a supplied value would let a caller name any user as the granter.
 */
function stampWriter(opCtx: any, userId: unknown): void {
  if (opCtx?.operation !== 'insert' || !GRANTED_BY_OBJECTS.has(opCtx?.object)) return;
  if (userId == null || userId === '') return;
  for (const row of rowsOf(opCtx)) {
    if (row && typeof row === 'object') row.granted_by = userId;
  }
}

export interface DelegatedAdminGateDeps {
  /** ObjectQL engine handle (pre-images and lookups). */
  ql: any;
  /** Shared permission-set resolution (same path as the CRUD middleware). */
  resolveSets: (context: any) => Promise<PermissionSet[]>;
  /**
   * [ruling of record 5985885287] The caller's own by-id read of the row an
   * update or delete addresses: the read door's answer to this caller. The
   * security plugin passes its per-operation pre-image read, so the gate and
   * the write gates after it read the row once between them. Absent, the gate
   * reads through `ql` under the caller's context.
   */
  readAsCaller?: (opCtx: any, id: string | number) => Promise<Record<string, unknown> | null>;
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
  /**
   * ADR-0066 superuser wildcard: unconstrained. The lists below then enumerate
   * everything the write path admits — never an audience anchor or a built-in
   * identity name, which no writer may assign.
   */
  isTenantAdmin: boolean;
  /** Every `adminScope` the caller holds, with its subtree resolved to ids. */
  scopes: Array<{
    setName: string;
    businessUnit: string;
    includeSubtree: boolean;
    manageAssignments: boolean;
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
  /**
   * The scope as `adminScopesCarriedBy` NORMALISES it, not as it was authored:
   * every flag there is forced to a boolean (`!== false` / `=== true`) and the
   * allowlist to a string[]. So this names the PARSED shape (ADR-0122) — the
   * authored one, which arrives as raw JSON and may state none of them, is
   * `AdminScope` and appears at the two `parseMaybeJson` sites below.
   */
  scope: AdminScopeParsed & { assignablePermissionSets: string[] };
  /** Resolved BU ids covered (root + descendants when includeSubtree). Empty = misconfigured → approves nothing. */
  subtree: Set<string>;
  /**
   * [ADR-0150 D3] The holders the allowlist names, each `permissionSetAddressKey`:
   * every name resolved from the package of the set that carries the scope — a
   * reference written inside a package resolves from it. A name that rule
   * refuses, or that no holder serves, allows nothing.
   */
  allowed: ReadonlySet<string>;
}

/** A permission set a position distributes, or a grant names, as the gate judges it. */
interface BoundSet {
  name: string;
  adminScope?: unknown;
  /**
   * [ADR-0150 D3] The holder the catalog resolved the name to (`null`: no
   * package holds it). Absent for a name that resolves to no holder: such a
   * name grants nothing, and is judged by name alone.
   */
  packageId?: string | null;
  /**
   * [ADR-0150 D3] The holders its own `adminScope`'s allowlist names, resolved
   * from its own package — what the containment check compares.
   */
  assignableHolders?: ReadonlySet<string>;
}

/**
 * [ADR-0150 D3] Does held scope `s` allowlist the set `set` — its name, and
 * the holder that name resolves to? Allowed to grant package A's `X` is never
 * allowed to grant package B's `X`. A set no holder serves (`packageId`
 * absent) grants nothing and is judged by its name, as before.
 */
function scopeAllows(s: Pick<HeldScope, 'scope' | 'allowed'>, set: { name: string; packageId?: string | null }): boolean {
  if (!s.scope.assignablePermissionSets.includes(set.name)) return false;
  return set.packageId === undefined || s.allowed.has(permissionSetAddressKey(set.packageId, set.name));
}

/** The `_packageId` a resolved definition carries — its holder — or `null` for one that names none. */
function definitionPackageOf(ps: unknown): string | null {
  const owner = (ps as { _packageId?: unknown } | null | undefined)?._packageId;
  return typeof owner === 'string' && owner !== '' ? owner : null;
}

/** A grant row's stored package column (ADR-0150 D8 R1), or `undefined` when it carries none. */
function grantPackageOf(row: any): string | undefined {
  const value = row?.permission_set_package;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
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

/**
 * Every `adminScope` the caller's resolved sets carry, normalised as
 * {@link HeldScope.scope} describes, with no business unit resolved: what the
 * caller holds, before the question of what it covers.
 */
function adminScopesCarriedBy(sets: PermissionSet[]): Array<Pick<HeldScope, 'setName' | 'scope'> & { carrier: string | null }> {
  const out: Array<Pick<HeldScope, 'setName' | 'scope'> & { carrier: string | null }> = [];
  for (const ps of sets) {
    const raw = parseMaybeJson((ps as any).adminScope ?? (ps as any).admin_scope);
    if (!raw || typeof raw !== 'object' || typeof raw.businessUnit !== 'string') continue;
    out.push({
      setName: (ps as any).name ?? '?',
      carrier: definitionPackageOf(ps),
      scope: {
        businessUnit: raw.businessUnit,
        includeSubtree: raw.includeSubtree !== false,
        manageAssignments: raw.manageAssignments === true,
        assignablePermissionSets: Array.isArray(raw.assignablePermissionSets)
          ? raw.assignablePermissionSets.filter((n: unknown): n is string => typeof n === 'string')
          : [],
      },
    });
  }
  return out;
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

/**
 * [ADR-0090 D12, amended 2026-10-17] The two sets that make their holder an
 * organization-level administrator — granted by `auto-org-admin-grant.ts` from
 * an owner or admin membership, for the organization of that membership. The
 * caller's sets are resolved for its active organization, so holding one here
 * means administering THAT organization.
 */
const ORGANIZATION_ADMIN_SETS: ReadonlySet<string> = new Set([ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS]);

/**
 * [ADR-0090 D12, amended 2026-10-17] The sets outside the organization boundary
 * BY NAME, whatever the three conditions say of them: `admin_full_access` and
 * both organization-administrator sets (administrator status is conferred by
 * membership grade only, never copied by an assignment), and the ADR's
 * denylist — the three D10 agent ceilings, whose bound is the delegating
 * principal's grants and not the organization wall.
 */
const ORGANIZATION_BOUNDARY_DENYLIST: ReadonlySet<string> = new Set([
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN,
  ORGANIZATION_ADMIN_NO_BYPASS,
  MCP_AGENT_PERMISSION_SET_READ,
  MCP_AGENT_PERMISSION_SET_WRITE,
  MCP_AGENT_PERMISSION_SET_RESTRICTED,
]);

/**
 * [ADR-0150 D3] Is `ps` one of the PLATFORM's organization-administrator sets
 * on `engine` — the name, from the platform's holder
 * (`permissionSetHolderIsPlatform`)? Another package's set of that name is
 * that package's set, granted as any other, and confers no administration.
 */
function isPlatformOrganizationAdminSet(engine: unknown, ps: PermissionSet): boolean {
  return ORGANIZATION_ADMIN_SETS.has(String((ps as any)?.name ?? ''))
    && permissionSetHolderIsPlatform(engine, definitionPackageOf(ps));
}

/** Does the caller hold an organization-administrator set for its active organization? */
function holdsOrganizationAdmin(engine: unknown, sets: PermissionSet[]): boolean {
  return sets.some((ps) => isPlatformOrganizationAdminSet(engine, ps));
}

/**
 * D12's tenant-level administrator: a superuser wildcard from any set but the
 * two organization-administrator sets. `organization_admin` carries the
 * wildcard too, bounded by the organization wall — under the 2026-10-17
 * amendment its holder is organization-level, judged by the boundary below.
 */
function isTenantLevelAdmin(engine: unknown, sets: PermissionSet[]): boolean {
  return isTenantAdmin(sets.filter((ps) => !isPlatformOrganizationAdminSet(engine, ps)));
}

/** A refusal reason from the organization-level branch, and the subject it names. */
interface OrganizationFailure {
  reason: string;
  meta: Record<string, unknown>;
  /**
   * The by-id update or delete addresses no row the caller's own read returns
   * — refused with {@link UnreadableAddressedRowRefusal}, not the boundary's
   * refusal.
   */
  unreadable?: boolean;
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

/**
 * [#26189] A per-scope rejection reason that describes the caller's OWN
 * delegated scope: a business unit outside the subtree, a set not in the
 * allowlist, a target user outside the subtree (ruling on #26059, Q3). Only
 * these answer {@link DelegationScopeViolationError}; a plain string reason
 * keeps {@link PermissionDeniedError}.
 */
interface ScopeViolation {
  readonly reason: string;
}

function outsideScope(reason: string): ScopeViolation {
  return { reason };
}

/** The refusal for an assignment or direct-grant write the held scopes all rejected. */
function refusalFor(
  failure: string | ScopeViolation,
  what: string,
  details: Record<string, unknown>,
): Error {
  if (typeof failure === 'string') {
    return new PermissionDeniedError(`[Security] Access denied: ${what} — ${failure}.`, details);
  }
  return new DelegationScopeViolationError(
    `[Security] Outside your delegated scope: ${what} — ${failure.reason}.`,
    details,
  );
}

/**
 * [ADR-0090 D12; ruling of record 5985885287] The gate's refusal of a by-id
 * update or delete whose row the caller's own read does not return: an id
 * naming no row and a row the caller cannot read, refused alike.
 *
 * Its own class only so the security middleware can tell it from every other
 * refusal of the gate. For the by-id write the caller addressed, the
 * middleware answers it the way the read door and step 2.7 answer every other
 * object — `recordNotFoundError` for that object and id
 * (`readDoorAnswerForGateRefusal`). Wherever no row was addressed — a cascade's
 * or a hook's nested write, the write-admission preview — it stays this
 * refusal: `403 PERMISSION_DENIED`, naming no row and no id.
 */
class UnreadableAddressedRowRefusal extends PermissionDeniedError {}

/** Is `refusal` the gate's {@link UnreadableAddressedRowRefusal}? */
export function isUnreadableAddressedRowRefusal(refusal: unknown): boolean {
  return refusal instanceof UnreadableAddressedRowRefusal;
}

/** The object a delegation's scope grants read on: the business-unit tree it is drawn over. */
const DELEGATED_READ_OBJECT = 'sys_business_unit';
/** The operations that read; the middleware dispatches no other read verb. */
const DELEGATED_READ_OPERATIONS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * [ADR-0090 D12, ruling of record 6663849489] A delegation's admin scope over
 * a business-unit subtree also grants read on the units inside that scope, so
 * delegated administration can name the units it administers (an assignment's
 * `business_unit_id` is a reference the caller must be able to read).
 *
 * The authz middleware asks this only for an operation the caller's sets do
 * NOT grant, and admits it only on a non-null answer: the `where` scope
 * `id IN <the covered units>` it then ANDs into the read. Null — the ordinary
 * refusal stands — unless every condition holds: a read carrying a query, and
 * every condition of {@link delegatedUnitReadAdmission}, the one judgment the
 * answers outside the middleware ask too.
 */
export async function delegatedUnitReadScope(
  gate: Pick<DelegatedAdminGate, 'scopedBusinessUnitIds'> | null | undefined,
  opCtx: { object?: string; operation?: string; ast?: unknown; context?: any },
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!opCtx.ast) return null;
  return delegatedUnitReadAdmission(gate, opCtx.object, opCtx.operation, opCtx.context, permissionSets, delegatorSets);
}

/**
 * [ADR-0090 D12, ruling of record 6663849489] The delegated business-unit read
 * itself, for an operation the caller's sets do NOT grant: the scope
 * `id IN <the covered units>` the read is confined to, or null when it
 * admits nothing. Asked by the read door ({@link delegatedUnitReadScope}) and
 * by every answer that must say what that door does — `canReadObject`,
 * `getReadFilter` and `security/explain` — so there is one judgment, never a
 * second copy of it.
 *
 * Non-null only when every condition holds: a read (`find`, `findOne`,
 * `count` or `aggregate`) of `sys_business_unit`, on the caller's own behalf
 * (no on-behalf-of delegator), with the gate composed, and at least one
 * covered unit ({@link DelegatedAdminGate.scopedBusinessUnitIds}). Nothing
 * wider: no other object, no write, no export, and no unit outside the scopes
 * the caller holds; a caller whose sets already grant the read is untouched.
 * A scope that cannot be resolved admits nothing (fail closed).
 */
export async function delegatedUnitReadAdmission(
  gate: Pick<DelegatedAdminGate, 'scopedBusinessUnitIds'> | null | undefined,
  object: string | undefined,
  operation: string | undefined,
  context: any,
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!gate || delegatorSets) return null;
  if (object !== DELEGATED_READ_OBJECT || !DELEGATED_READ_OPERATIONS.has(String(operation))) return null;
  let ids: ReadonlySet<string>;
  try {
    ids = await gate.scopedBusinessUnitIds(permissionSets, context);
  } catch {
    return null;
  }
  return ids.size > 0 ? { id: { $in: [...ids] } } : null;
}

/**
 * [ADR-0090 D12] A row an administrator's write targets — the delegated walk's
 * and the organization branch's alike — with what the caller may be told about
 * it: `prev` the stored row a by-id write addresses, `next` the row an insert
 * or an update writes, and the two column sets a refusal's guidance reads
 * ({@link mayName}).
 */
interface DelegatedTarget {
  next: any | null;
  prev: any | null;
  /**
   * The columns whose `next` value the caller supplied in its own payload;
   * `null` for an insert, whose every value is the caller's.
   */
  wrote: ReadonlySet<string> | null;
  /**
   * The columns of `prev` the caller's own read returned at their stored
   * value ({@link columnsReadAsStored}).
   */
  reads: ReadonlySet<string>;
}

/**
 * [ruling of record 6649064874] The columns of the stored row
 * `prev` that the caller's own read `seen` returned at their stored value.
 *
 * The read is the read door's answer to this caller, field rules and masking
 * included, so a column a field rule hides is absent from it and a masked one
 * differs: neither is here. Strict equality, so a value read in any other form
 * counts as not read. No read (`null`), no column.
 */
function columnsReadAsStored(seen: any | null, prev: any | null): Set<string> {
  const out = new Set<string>();
  if (!seen || typeof seen !== 'object' || !prev || typeof prev !== 'object') return out;
  for (const [column, value] of Object.entries(prev)) {
    if (Object.prototype.hasOwnProperty.call(seen, column) && seen[column] === value) out.add(column);
  }
  return out;
}

/**
 * [ruling of record 6649064874] May a refusal of `t` name the
 * value of `column` on its `side`?
 *
 * Only a value the caller already has: one it wrote (an insert's row, a
 * column its update payload carries), or one its own read returned at the
 * stored value. The verdict is still taken on the stored row; only the
 * wording follows this, and a value it may not name is left out of the
 * sentence and out of the details.
 */
function mayName(t: DelegatedTarget, side: 'next' | 'prev', column: string): boolean {
  if (side === 'next' && (t.wrote === null || t.wrote.has(column))) return true;
  return t.reads.has(column);
}

/** The object a target user is a row of: what a direct grant's `user_id` references. */
const TARGET_USER_OBJECT = 'sys_user';

/**
 * [ADR-0131 D4] A permission set a direct-grant write is judged on: its
 * catalog definition (`setRow`, `null` when there is none), its name, whether a
 * refusal may name it ({@link mayName}), and — when no delegate can be shown to
 * hold authority over it — why (`unresolved`).
 */
interface GrantSetJudgment {
  setRow: any | null;
  setName: string;
  setNamed: boolean;
  unresolved?: string;
}

/** The holder a direct-grant row names (`user_id`), or `null` when it names none. */
function grantHolderOf(row: any): string | null {
  return row?.user_id ? String(row.user_id) : null;
}

/**
 * [ADR-0090 D12; ruling on #26059, Q3] Does the gate judge a target user
 * through the caller's own read ({@link DelegatedAdminGate.callerReadsUser})?
 * Wherever that read can be asked at all: `sys_user` is registered on the
 * engine, and the engine offers a `find` to ask it with. Then a delegated
 * answer about a user the caller cannot read does not depend on that user's
 * existence or memberships: such a user holds no business unit a subtree
 * covers, exactly as an id naming no user holds none
 * ({@link DelegatedAdminGate.targetUserUnits}). Anywhere else, an engine that
 * hands over no schema included, no user is readable to ask about, and a
 * target user is judged on its memberships alone.
 *
 * The test is the gate's own reason, never the schema shape of a grant's
 * `user_id`, and it holds for every target user the gate judges: the holder a
 * direct-grant write names (an insert, an update pointing the grant at another
 * user), the holder a stored grant keeps (a delete, an update that leaves
 * `user_id` as stored), the holder an update pointing the grant at another
 * user takes it from, and the user the explain doors ask about
 * ({@link DelegatedAdminGate.scopesCoverUser}). Were it the column's shape,
 * the answer about one unreadable user would change with whether `user_id` is
 * still a writable lookup.
 *
 * Two other doors ask the caller's read about a grant's holder, each only for
 * a holder the write NAMES. The engine's reference check asks it of a
 * `user_id` a write names when the live schema's `user_id` is a
 * non-`readonly` `lookup` / `user` reference to a registered `sys_user`
 * (`assertReferencesResolve`, `@objectstack/objectql`), and forgives a value
 * the row already stores. The grant-holder membership hook asks it through
 * `callerReadsHolder` and steps aside for the reference check on that same
 * test (`referenceCheckAsksCaller`), and judges a holder the row stores on its
 * membership, as stored (`grant-holder-membership-refusal.ts`, `onUpdate`).
 * That "as stored" mirror does not hold for this gate. Those doors validate
 * the value a write stores, and a value already stored was validated when it
 * was written; this gate JUDGES the target user — is it inside the caller's
 * subtree? — and that answer is about the user, whichever write shape carries
 * it, so a holder the row stores is asked of the caller's read too.
 */
function judgesTargetUserThroughCallerRead(ql: any): boolean {
  return typeof ql?.find === 'function'
    && typeof ql?.getSchema === 'function'
    && Boolean(ql.getSchema(TARGET_USER_OBJECT));
}

/**
 * [ADR-0090 D12, amended 2026-10-17] Is permission set `setName` inside the
 * organization boundary? `null` when it is; otherwise the reason, naming the
 * set and the condition it fails:
 *
 * - by name — {@link ORGANIZATION_BOUNDARY_DENYLIST};
 * - (a) its `objects['*']` entry carries `viewAllRecords` or `modifyAllRecords`;
 * - (b) it carries an `adminScope`;
 * - (c) a name in its `systemPermissions` is not a capability declared
 *   `scope: 'org'` in the security catalog (a name no declaration carries is
 *   not an organization capability).
 *
 * A set the catalog does not hold cannot be shown inside, and is not. Nor
 * can one a position names that the position cannot resolve: `scope` names
 * that position, and the set resolves from the package that declared it
 * (ADR-0150 D3/D7) — a name that rule refuses grants a holder nothing, and the
 * reason carries the refusal with every candidate.
 *
 * Exported so a second save door that distributes permission sets judges them by
 * THIS predicate and never by a copy of its list: plugin-auth's identity-provider
 * group mapping refuses, at save, any set this answers a reason for.
 */
export async function organizationBoundaryFailure(
  catalog: SecurityCatalogReader | undefined,
  setName: string,
  scope?: SecurityCatalogReferenceScope,
): Promise<string | null> {
  if (ORGANIZATION_BOUNDARY_DENYLIST.has(setName)) {
    return `permission set '${setName}', which is outside the organization boundary by name (platform and organization administration and the agent ceilings are never assigned by an organization administrator)`;
  }
  const answer = catalog ? await resolveCatalogReference(catalog, 'permission', setName, scope) : undefined;
  if (answer?.status === 'refused') {
    return `permission set '${setName}', which the position cannot resolve, so it cannot be shown to be inside the organization boundary: ${answer.message}`;
  }
  const entry = answer?.status === 'resolved' ? answer.entry : undefined;
  if (!catalog || !entry) {
    return `permission set '${setName}', which is not in the security catalog, so it cannot be shown to be inside the organization boundary`;
  }
  const definition: any = entry.definition;
  const wildcard = (parseMaybeJson(definition.objects) ?? {})?.['*'];
  for (const bit of ['viewAllRecords', 'modifyAllRecords'] as const) {
    if (wildcard?.[bit] === true) {
      return `permission set '${setName}', which fails condition (a) of the organization boundary: its objects['*'] entry carries the superuser bit '${bit}'`;
    }
  }
  if (parseMaybeJson(definition.adminScope ?? definition.admin_scope)) {
    return `permission set '${setName}', which fails condition (b) of the organization boundary: it carries an adminScope`;
  }
  const capabilities = parseMaybeJson(definition.systemPermissions);
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const declared = await catalog.resolve('capability', String(capability));
    if (declared?.definition.scope !== 'org') {
      return `permission set '${setName}', which fails condition (c) of the organization boundary: its capability '${String(capability)}' is ${declared ? "not declared scope 'org'" : "declared nowhere, so it is not an organization capability"}`;
    }
  }
  return null;
}

export class DelegatedAdminGate {
  constructor(private readonly deps: DelegatedAdminGateDeps) {}

  /** Per-call caches (BU subtrees, position bindings) live on the instance
   *  only for the duration of one assert — recreated each call for freshness. */

  async assert(opCtx: any): Promise<void> {
    if (!GOVERNED_OBJECTS.has(opCtx?.object)) return;
    if (!GOVERNED_OPERATIONS.has(opCtx?.operation)) return;

    // Authority first: a refused write throws here and is never stamped.
    await this.authorize(opCtx);
    // Then provenance, on every admitted path — see {@link GRANTED_BY_OBJECTS}.
    stampWriter(opCtx, opCtx.context?.userId);
  }

  /** The authority decision for a governed write: returns when admitted, throws when refused. */
  private async authorize(opCtx: any): Promise<void> {
    const ctx = opCtx.context ?? {};
    // Every business-unit anchor this call resolves is resolved in the
    // caller's own organization — see {@link callerOrganizationId}.
    const organizationId = callerOrganizationId(ctx);

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

    if (isTenantLevelAdmin(this.deps.ql, sets)) return; // status quo — downstream CRUD/RLS decide

    // ── [#3697 follow-up] Organization membership is NOT delegable ────────
    // Every other governed object has an adminScope axis that can approve part
    // of it (a subtree, an action flag, an allowlist). `sys_member` has none:
    // no axis of `AdminScope` expresses "org membership", and the row's own
    // `role` column is an authority dial — admin-grade membership is
    // auto-elevated to `organization_admin`, i.e. to `isTenantAdmin()`. A
    // delegate who could write one would mint authority strictly greater than
    // their own, which is exactly what ADR-0090 D12 exists to prevent.
    //
    // So it is tenant-admin-only, full stop — reached only by a hypothetical
    // future direct-write surface (better-auth's own writes are `isSystem` and
    // never arrive here). Adding people to an organization already has a
    // delegable path: the INVITATION, whose placement is authorized against
    // the issuer's adminScope and whose role is held to the issuer's own grade.
    if (opCtx.object === 'sys_member') {
      throw new PermissionDeniedError(
        `[Security] Access denied: '${opCtx.operation}' on 'sys_member' is tenant-level only — ` +
          `organization membership is not a delegable capability (ADR-0090 D12), and an ` +
          `admin-grade membership row resolves to tenant administration. Add people through an ` +
          `invitation instead: its placement is authorized against your adminScope.`,
        { operation: opCtx.operation, object: opCtx.object, userId: ctx.userId },
      );
    }

    // ── [ADR-0091 D3] Self-service delegation of duty (职务代理) ──────────
    // A write that STAMPS `delegated_from` is a delegation: the holder passes
    // their OWN hat, judged by delegation rules — not by an adminScope. This
    // is the ONE authority path open to a non-admin, so it is tried before the
    // held-scope resolution that would otherwise fail closed. (Tenant admins
    // short-circuited above; a scope-holding delegate who stamps
    // `delegated_from` is still held to the delegation invariants — a
    // delegation is a delegation regardless of who writes it.)
    if (this.isDelegationWrite(opCtx)) {
      return this.assertSelfDelegation(opCtx, ctx, organizationId);
    }

    // ── [ADR-0090 D12, amended 2026-10-17] Organization-level administration ──
    // An organization administrator creates and removes its own organization's
    // assignment rows inside the organization boundary. A caller who is also a
    // delegate and fails the boundary is still judged by its adminScope below;
    // one who is not is refused with the boundary's own reason.
    let organizationFailure: OrganizationFailure | null = null;
    if (holdsOrganizationAdmin(this.deps.ql, sets)) {
      organizationFailure = await this.organizationAdminFailure(opCtx, organizationId);
      if (organizationFailure === null) return;
    }

    const held = await this.resolveHeldScopes(sets, organizationId);
    if (held.length === 0 && organizationFailure) {
      const Refusal = organizationFailure.unreadable ? UnreadableAddressedRowRefusal : PermissionDeniedError;
      throw new Refusal(
        `[Security] Access denied: organization administrator '${opCtx.operation}' on '${opCtx.object}' ` +
          `rejected — ${organizationFailure.reason} (ADR-0090 D12, the organization boundary).`,
        { operation: opCtx.operation, object: opCtx.object, ...organizationFailure.meta },
      );
    }
    // [ADR-0123 D2/D4] A delegated scope held in a context that names no
    // organization covers nothing (`resolveHeldScopes` resolved none of the
    // scopes the caller's sets carry), so its write is refused here, naming
    // the missing active organization — the organization-level branch's
    // refusal of the same state, in the same words and class.
    if (!organizationId && adminScopesCarriedBy(sets).length > 0) {
      throw new PermissionDeniedError(
        `[Security] Access denied: delegated administrator '${opCtx.operation}' on '${opCtx.object}' ` +
          `rejected — ${NO_ACTIVE_ORGANIZATION} (ADR-0090 D12; ADR-0123 D2 — a delegated scope covers ` +
          `units of the active organization only).`,
        { operation: opCtx.operation, object: opCtx.object, userId: ctx.userId },
      );
    }
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
        return this.assertAssignmentWrite(opCtx, held);
      case 'sys_user_permission_set':
        return this.assertDirectGrantWrite(opCtx, held);
    }
  }

  /**
   * [ADR-0090 D6 × D12] Does the actor (via their resolved sets) hold a
   * delegated `adminScope` whose BU subtree covers `targetUserId`? Used by
   * the explain API: an administrator who can already manage a user's
   * assignments inside their delegation boundary may also read WHY that
   * user's access resolves the way it does — without tenant-level
   * `manage_users`. Any held scope qualifies, whether or not it grants
   * `manageAssignments`: it administers capability inside the subtree, and
   * the report is read-only. Fail-closed: unresolvable scopes/memberships
   * cover nothing.
   *
   * `callerContext` supplies the organization the scopes resolve in. Omitted,
   * or naming no organization, it covers nobody: a delegated scope held in a
   * context that names no organization covers nothing ({@link resolveHeldScopes}).
   *
   * [ADR-0090 D12] It covers the user only through a business unit the write
   * gate would judge it by ({@link targetUserUnits}): a user the caller's own
   * read, under `callerContext`, does not return is covered by no scope, as an
   * id naming no user is not. So the answer about a user the caller cannot
   * read does not depend on that user's existence or memberships. That read is
   * asked only once a scope has resolved, so a context that names no
   * organization asks it nothing.
   */
  async scopesCoverUser(
    sets: PermissionSet[],
    targetUserId: string,
    callerContext?: any,
  ): Promise<boolean> {
    const held = await this.resolveHeldScopes(sets, callerOrganizationId(callerContext));
    if (held.length === 0) return false;
    const userBUs = await this.targetUserUnits(callerContext, targetUserId);
    if (userBUs.size === 0) return false;
    for (const s of held) {
      for (const bu of userBUs) if (s.subtree.has(bu)) return true;
    }
    return false;
  }

  /**
   * [ADR-0090 D12, ruling of record 6663849489] The business units a caller's
   * delegated scopes cover: the union of the subtrees of every `adminScope`
   * its resolved sets carry, resolved in the caller's own organization
   * ({@link callerOrganizationId}), exactly as the write path resolves them.
   * A delegation's scope also grants read on these units, so delegated
   * administration can name the units it administers; the authz middleware
   * admits that read on this answer alone. Any held scope counts, as for
   * {@link scopesCoverUser}.
   *
   * Fail closed: no scope, or a scope that resolves to no unit of the
   * caller's organization, covers nothing — an empty set.
   */
  async scopedBusinessUnitIds(sets: PermissionSet[], callerContext?: any): Promise<ReadonlySet<string>> {
    const held = await this.resolveHeldScopes(sets, callerOrganizationId(callerContext));
    const ids = new Set<string>();
    for (const s of held) for (const id of s.subtree) ids.add(id);
    return ids;
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
   * `callerContext` supplies the organization every unit id in the report is
   * resolved in — without it a business unit was named by NAME across
   * organizations, so a picker could offer (and this report could disclose)
   * another organization's unit ids. Omitted, or naming no organization, it
   * reports no delegated scope, no placeable unit for any caller and no
   * position assignable through a scope ({@link resolveHeldScopes}).
   *
   * A tenant-level admin (ADR-0066 superuser wildcard) is unconstrained inside
   * its organization; the report says so AND enumerates everything the write
   * path admits there — every unit of that organization — so a
   * consumer can render one uniform picker instead of special-casing. Every
   * branch reads one position listing, which never offers a name no writer
   * may assign (an audience anchor or a built-in identity). An organization
   * administrator (D12 as amended 2026-10-17) is not: `isTenantAdmin` is
   * false, every unit of its organization is placeable and the positions
   * inside the organization boundary are assignable — on the same report
   * shape, beside any delegated scopes it also holds.
   */
  async describeDelegableScope(
    sets: PermissionSet[],
    callerContext?: any,
  ): Promise<DelegableScopeReport> {
    const organizationId = callerOrganizationId(callerContext);
    // [ADR-0131 D3/D4] Every position the security catalog holds — the
    // environment registry, one namespace per deployment — never the
    // per-organization `sys_position` rows: a position declared only in the
    // registry is assignable, and a row with no definition grants nothing
    // (the resolver reads the catalog), so it is not offered.
    //
    // Two kinds of catalog name are never offered, by ANY branch below,
    // because no writer may assign them: the ADR-0090 D9 audience anchors
    // (refused by `authorize`'s unconditional invariant) and the ADR-0068 D2
    // built-in identity names (`sys_user_position.position` refuses them from
    // every writer, tenant-level administrators included — the shared
    // `isReservedIdentityName` predicate that validation is generated from).
    // They carry no sets, so no branch's own test would settle them: the
    // listing every branch reads leaves them out, once.
    const allPositions = async (): Promise<string[]> => {
      const catalog = this.catalog();
      if (!catalog) return [];
      try {
        return (await catalog.list('position'))
          .map((entry) => entry.name)
          .filter((n) => n && !ANCHOR_POSITIONS.has(n) && !isReservedIdentityName(n));
      } catch {
        return []; // a picker over an unreadable catalog offers nothing (fail closed)
      }
    };

    if (isTenantLevelAdmin(this.deps.ql, sets)) {
      return {
        isTenantAdmin: true,
        scopes: [],
        // A tenant admin is unconstrained INSIDE their organization, never
        // across organizations: the picker this feeds must not name a unit
        // the caller could not place anyone in. A context that names no
        // organization has no organization to place anyone in, so it is
        // offered no unit (ADR-0123 D2).
        placeableBusinessUnitIds: organizationId ? await this.organizationBusinessUnitIds(organizationId) : [],
        assignablePositions: await allPositions(),
      };
    }

    const held = await this.resolveHeldScopes(sets, organizationId);
    const scopes = held.map((h) => ({
      setName: h.setName,
      businessUnit: h.scope.businessUnit,
      includeSubtree: h.scope.includeSubtree,
      manageAssignments: h.scope.manageAssignments,
      assignablePermissionSets: [...h.scope.assignablePermissionSets],
      businessUnitIds: [...h.subtree],
    }));

    // Placement needs `manageAssignments` — a scope without it is an
    // allowlist that places nobody.
    const placing = held.filter((h) => h.scope.manageAssignments);
    const placeableBusinessUnitIds = [...new Set(placing.flatMap((h) => [...h.subtree]))];

    // A position is assignable when at least ONE placing scope allowlists
    // every set it distributes — exactly
    // `assertAssignmentWrite`'s test, containment check included.
    const assignablePositions: string[] = [];
    if (placing.length > 0) {
      for (const positionName of await allPositions()) {
        let boundSets: BoundSet[];
        try {
          boundSets = await this.setsBoundToPosition(positionName);
        } catch {
          continue; // a position whose binding cannot be read is not offered
        }
        const ok = placing.some((s) =>
          boundSets.every(
            (bound) =>
              scopeAllows(s, bound) &&
              this.assertScopeGrantContainment(bound, held, /*dryRun*/ true) === null,
          ),
        );
        if (ok) assignablePositions.push(positionName);
      }
    }

    // [ADR-0090 D12, amended 2026-10-17] An organization administrator places
    // into every unit of its organization and assigns every position inside
    // the organization boundary — `organizationAdminFailure`'s own test, so an
    // option offered here is one the write path admits. The ADR-0068 D2
    // identity names carry no sets, so the boundary does not settle them; the
    // shared listing has already left them out (see `allPositions`).
    if (holdsOrganizationAdmin(this.deps.ql, sets) && organizationId) {
      for (const id of await this.organizationBusinessUnitIds(organizationId)) {
        if (!placeableBusinessUnitIds.includes(id)) placeableBusinessUnitIds.push(id);
      }
      for (const positionName of await allPositions()) {
        if (assignablePositions.includes(positionName)) continue;
        let failure: unknown;
        try {
          failure = await this.positionBoundaryFailure(positionName);
        } catch {
          continue; // a position whose sets cannot be read is not offered
        }
        if (failure === null) assignablePositions.push(positionName);
      }
    }

    return {
      isTenantAdmin: false,
      scopes,
      placeableBusinessUnitIds,
      assignablePositions,
    };
  }

  /**
   * [ADR-0090 D6 × D12, amended 2026-10-17] Is the caller an organization
   * administrator of its active organization, and `targetUserId` a member of
   * it? Used by the explain API: an administrator who may assign a member's
   * positions and sets may also read why that member's access resolves as it
   * does. Fail-closed: no active organization, or an unreadable membership,
   * covers nobody.
   */
  async organizationAdminCoversUser(
    sets: PermissionSet[],
    targetUserId: string,
    callerContext?: any,
  ): Promise<boolean> {
    if (!holdsOrganizationAdmin(this.deps.ql, sets)) return false;
    const organizationId = callerOrganizationId(callerContext);
    const ql = this.deps.ql;
    if (!organizationId || !targetUserId || !ql?.find) return false;
    try {
      const rows = await ql.find('sys_member', {
        where: { user_id: targetUserId, organization_id: organizationId },
        limit: 1,
        context: SYSTEM_CTX,
      });
      return (Array.isArray(rows) ? rows : []).some((r: any) => rowOrganizationId(r) === organizationId);
    } catch {
      return false;
    }
  }

  // ── [ADR-0090 D12, amended 2026-10-17] Organization-level administration ──

  /**
   * Why the organization administrator of `organizationId` may NOT perform this
   * write — or `null` when the organization boundary admits it.
   *
   * The right is to create and remove `sys_user_position` /
   * `sys_user_permission_set` rows of the caller's own organization: an insert,
   * or a delete of one row by id. A row inserted with no organization is
   * stamped with the caller's here, once admitted, so the right never mints an
   * organization-less grant; a row naming another organization, or a removal
   * of a row that is not the caller's organization's, is refused. That the row's user is a member of the
   * organization is judged for every writer by the grant-holder membership
   * hooks (`grant-holder-membership-refusal.ts`), not again here.
   *
   * Every permission set the row distributes must be inside the boundary
   * ({@link organizationBoundaryFailure}); for a position, every set it carries
   * ({@link setsCarriedByPosition}). One set outside puts the row outside.
   *
   * Whether a removal has a row to judge is asked of the CALLER's own read
   * ({@link organizationTargets}), so a row the caller cannot read is answered
   * exactly as an id naming no row is (ruling of record 5985885287). A row the
   * caller reads is judged on the STORED row, as the delegated branch judges
   * it (ruling of record 6649064874): the caller's read is served through its
   * field rules and masking, and a verdict taken on what a rule hid would be
   * taken on less than the row. A refusal names a value only when the caller
   * reads it at its stored value or wrote it ({@link mayName}). An edit in
   * place is a verb the right never holds, so it is refused before any row is
   * looked up, whatever the id names: a row and no row get the same refusal
   * (the update-by-id refusal order). The not-found is the answer only for a
   * verb the caller holds, judged on the row.
   */
  private async organizationAdminFailure(
    opCtx: any,
    organizationId?: string,
  ): Promise<OrganizationFailure | null> {
    const op = String(opCtx.operation);
    if (!organizationId) {
      return { reason: NO_ACTIVE_ORGANIZATION, meta: {} };
    }
    if (op !== 'insert' && op !== 'delete') {
      return {
        reason: `'${op}' is not part of the right — an assignment row is created and removed, never edited in place`,
        meta: {},
      };
    }
    if (op === 'delete' && extractSingleId(opCtx) == null) {
      return {
        reason: 'a removal must target one assignment row by id — a filter delete cannot be checked against the organization boundary',
        meta: {},
      };
    }

    for (const t of await this.organizationTargets(opCtx)) {
      const side = t.next ? 'next' : 'prev';
      const row = t.next ?? t.prev;
      // No row answers an id naming none and a row the caller cannot read
      // alike: one refusal, and never a fall-through to the engine.
      if (!row) return { reason: 'the assignment row to remove could not be read', meta: {}, unreadable: op === 'delete' };

      // [ruling of record 6649064874] The verdict is the stored row's; each
      // value below is named only when the caller wrote or reads it
      // ({@link mayName}).
      const rowOrg = rowOrganizationId(row);
      if (t.next ? rowOrg !== null && rowOrg !== organizationId : rowOrg !== organizationId) {
        if (!mayName(t, side, 'organization_id')) {
          return { reason: 'the row does not belong to the organization you administer', meta: {} };
        }
        return {
          reason: rowOrg
            ? `the row belongs to organization '${rowOrg}', not the one you administer`
            : 'the row carries no organization, so it is not one of the organization you administer',
          meta: { organizationId: rowOrg },
        };
      }

      if (opCtx.object === 'sys_user_position') {
        const bu = t.next?.business_unit_id;
        if (bu != null && bu !== '' && !(await this.businessUnitInOrganization(String(bu), organizationId))) {
          return {
            reason: `business unit '${bu}' is not a unit of the organization you administer`,
            meta: { businessUnitId: bu },
          };
        }
        const positionName = String(row.position ?? '');
        const failure = await this.positionBoundaryFailure(positionName);
        if (failure) {
          // A set is named only beside the position it is read from.
          return mayName(t, side, 'position')
            ? { reason: failure.reason, meta: { position: positionName, permissionSet: failure.permissionSet } }
            : { reason: "the assignment's position is not inside the organization boundary", meta: {} };
        }
      } else {
        const setName = grantSetNameOf(row) ?? '';
        // [ADR-0150 D8 R1, #32538] The holder the grant names, and that holder
        // alone. The write seam (`stored-permission-set-package-stamp.ts`)
        // keeps a package the writer names when it holds the name and refuses
        // one that does not, at any holder count; it never re-stamps it from
        // the name (#32164). A column that names no holder of the name reads
        // as no package, so the set judged is the one the reader resolves,
        // and a grant naming none is judged by its name — two holders refused,
        // naming both.
        const column = grantPackageOf(row);
        const reason = !setName
          ? 'the grant names no permission set'
          : await this.organizationBoundaryFailure(setName, storedPermissionSetScope(column));
        if (reason) {
          return mayName(t, side, GRANT_SET_NAME_FIELD)
            ? { reason, meta: { permissionSet: setName } }
            : { reason: "the grant's permission set is not inside the organization boundary", meta: {} };
        }
      }
    }

    // Admitted: an insert that named no organization lands in the caller's.
    if (op === 'insert') {
      for (const row of rowsOf(opCtx)) {
        if (row && typeof row === 'object' && rowOrganizationId(row) === null) row.organization_id = organizationId;
      }
    }
    return null;
  }

  /**
   * [ADR-0090 D12; ruling of record 5985885287] The rows an organization
   * administrator's insert or removal targets, with what the caller may be
   * told of each ({@link DelegatedTarget}): an insert's payload rows, every
   * value the caller's own; or the one row a removal addresses.
   *
   * Whether a removal has a row is asked of the caller's own by-id read
   * ({@link callerRead}) — the read door's answer to this caller, every read
   * visibility and wall included: a row the caller cannot read answers what an
   * id naming no row answers, and no system read is made for it. A row it
   * reads is then judged on the stored row ({@link storedRow}), never on the
   * caller's read of it, which is served through the caller's field rules and
   * masking (ruling of record 6649064874); `reads` holds the columns that read
   * returned at their stored value ({@link columnsReadAsStored}). A read
   * refusal or a store fault, in either read, propagates as raised: an outage
   * is neither an answer nor a refusal, and the by-id write door answers a
   * caller the read door refuses with that refusal.
   */
  private async organizationTargets(opCtx: any): Promise<DelegatedTarget[]> {
    if (opCtx.operation === 'insert') {
      return rowsOf(opCtx).map((r) => ({ next: r, prev: null, wrote: null, reads: new Set<string>() }));
    }
    const id = extractSingleId(opCtx);
    const seen = id != null ? await this.callerRead(opCtx, id) : null;
    const prev = seen && id != null ? await this.storedRow(opCtx.object, id) : null;
    return [{ next: null, prev, wrote: new Set<string>(), reads: columnsReadAsStored(seen, prev) }];
  }

  /**
   * [ruling of record 5985885287] The caller's own by-id read of row `id` of
   * `opCtx.object`: the read door's answer to this caller, every read
   * visibility and wall included — through
   * {@link DelegatedAdminGateDeps.readAsCaller} when the host shares its
   * per-operation pre-image, else through the engine under the caller's
   * context. `null` for no row. A read refusal or a store fault propagates as
   * raised.
   */
  private async callerRead(opCtx: any, id: string | number): Promise<any | null> {
    const ql = this.deps.ql;
    const row = this.deps.readAsCaller
      ? await this.deps.readAsCaller(opCtx, id)
      : ql?.findOne
        ? await ql.findOne(opCtx.object, { where: { id }, context: opCtx.context })
        : null;
    return row && typeof row === 'object' ? row : null;
  }

  /**
   * Does the caller's own read door return user `userId`? The question the
   * engine's reference check asks of a `user_id` a write names
   * (`masterDetailHeadersCallerReads`, `@objectstack/objectql`) and the
   * grant-holder membership hook asks before it
   * (`grant-holder-membership-refusal.ts`, `callerReadsHolder`): one `sys_user`
   * read WHERE `id` equals the value, projected to `id`, under the caller's
   * own `context` — a write's `opCtx.context`, the explain doors'
   * `callerContext`, never the system's — so every read visibility and wall
   * answers it, and only a row whose id IS the value counts. A user it does
   * not return is a user the caller cannot read, answered as a user that does
   * not exist (the platform's rule for every user a non-system write names,
   * and the gate's for every target user it judges,
   * {@link judgesTargetUserThroughCallerRead}). A read the read door REFUSES
   * (a declared 4xx) returns no user either; a store fault propagates as
   * raised, as for the gate's other reads: an outage is neither an answer nor
   * a refusal.
   */
  private async callerReadsUser(context: any, userId: string): Promise<boolean> {
    const ql = this.deps.ql;
    if (!ql?.find) return false;
    let rows: unknown;
    try {
      rows = await ql.find(TARGET_USER_OBJECT, { where: { id: userId }, fields: ['id'], context });
    } catch (e) {
      const status = declaredHttpStatus(e);
      if (status !== undefined && status < 500) return false;
      throw e;
    }
    return (Array.isArray(rows) ? rows : []).some((r: any) => r?.id != null && String(r.id) === userId);
  }

  /**
   * [ADR-0090 D12; ruling on #26059, Q3] The business units through which a
   * delegated subtree may cover target user `userId`, as answered to the
   * caller whose own context is `context`: the user's memberships
   * ({@link businessUnitsOfUser}, read by the system) when the caller's own
   * read returns the user ({@link callerReadsUser}), and none when it does
   * not. A user the caller cannot read thus holds no unit any subtree covers,
   * exactly as an id naming no user holds none, so every delegated answer
   * about it — the write gate's refusal, the explain doors' coverage — is the
   * answer about no user. Asked wherever the gate judges a target through the
   * caller's read ({@link judgesTargetUserThroughCallerRead}); elsewhere the
   * memberships alone. A store fault in the caller's read propagates.
   */
  private async targetUserUnits(context: any, userId: string): Promise<Set<string>> {
    if (judgesTargetUserThroughCallerRead(this.deps.ql) && !(await this.callerReadsUser(context, userId))) {
      return new Set<string>();
    }
    return this.businessUnitsOfUser(userId);
  }

  /**
   * [ADR-0090 D12] The stored holder a direct-grant update takes the grant
   * from when it points the grant at another user (`t.prev`'s `user_id`), as
   * the gate judges it: its business units through the caller's own read
   * ({@link targetUserUnits}), exactly as the holder the write names is
   * judged, and whether a refusal may name it — only when the caller's own
   * read returned it at its stored value ({@link mayName}). A pre-image naming
   * no holder answers no holder and no units, and asks the read nothing.
   */
  private async storedHolderJudged(
    context: any,
    t: DelegatedTarget,
  ): Promise<{ userId: string | null; units: Set<string>; named: boolean }> {
    const userId = grantHolderOf(t.prev);
    return {
      userId,
      units: userId ? await this.targetUserUnits(context, userId) : new Set<string>(),
      named: mayName(t, 'prev', 'user_id'),
    };
  }

  /**
   * Is position `positionName` inside the organization boundary? `null` when
   * every set it carries is; otherwise the first failure, naming the set.
   * A position the catalog does not hold cannot be shown inside, and is not.
   */
  private async positionBoundaryFailure(
    positionName: string,
  ): Promise<{ reason: string; permissionSet?: string } | null> {
    if (!positionName) return { reason: 'the assignment names no position' };
    const carried = await this.setsCarriedByPosition(positionName);
    if (carried === null) {
      return { reason: `position '${positionName}' is not in the security catalog, so it cannot be shown to be inside the organization boundary` };
    }
    for (const setName of carried.names) {
      const reason = await this.organizationBoundaryFailure(setName, { position: carried.position });
      if (reason) return { reason: `position '${positionName}' carries ${reason}`, permissionSet: setName };
    }
    return null;
  }

  /**
   * [ADR-0090 D12, amended 2026-10-17; ADR-0131 D3/D4] Every permission set an
   * assignment of `positionName` grants: exactly the names its definition's
   * `permissionSets` lists. A set that merely shares the position's name is not
   * among them — the resolver no longer folds held position names into the
   * request (#24757) — so it is not walked. `null` when the catalog does not
   * hold the position. An unreadable catalog throws
   * (`AuthzStoreUnavailableError`) and the write is refused with it.
   *
   * The one answer to "which sets does this position carry" for both branches:
   * the delegated walk ({@link setsBoundToPosition}) reads it too. It answers
   * the position's catalog entry beside the names, because [ADR-0150 D7] each
   * name resolves from the package that declared the position.
   */
  private async setsCarriedByPosition(
    positionName: string,
  ): Promise<{ position: SecurityCatalogEntry; names: string[] } | null> {
    const catalog = this.catalog();
    if (!catalog) return null;
    const position = await catalog.resolve('position', positionName);
    if (!position) return null;
    const listed = Array.isArray(position.definition.permissionSets)
      ? (position.definition.permissionSets as unknown[]).filter((n): n is string => typeof n === 'string' && n !== '')
      : [];
    return { position, names: [...new Set(listed)] };
  }

  /** [ADR-0090 D12] {@link organizationBoundaryFailure}, against this gate's catalog. */
  private organizationBoundaryFailure(setName: string, scope?: SecurityCatalogReferenceScope): Promise<string | null> {
    return organizationBoundaryFailure(this.catalog(), setName, scope);
  }

  /** Is business unit `id` a unit of `organizationId`? Fail-closed on an unreadable unit. */
  private async businessUnitInOrganization(id: string, organizationId: string): Promise<boolean> {
    return (await this.organizationBusinessUnitIds(organizationId, id)).includes(id);
  }

  /**
   * The ids of `organizationId`'s business units (narrowed to `onlyId` when
   * given) — never another organization's, whatever a driver returns.
   * `organizationId` is required: every caller names the caller's active
   * organization, and a context that names none is offered no unit before it
   * gets here (ADR-0123 D2) — there is no read of every organization's units.
   * Not a `single`-posture exception either: since ADR-0131 C1 every `single`
   * session carries the Default Organization (D11: "`single` is never a
   * reason for a row to be org-less"). Fail-closed: an unreadable table
   * yields none.
   */
  private async organizationBusinessUnitIds(organizationId: string, onlyId?: string): Promise<string[]> {
    const ql = this.deps.ql;
    if (!ql?.find) return [];
    try {
      const rows = await ql.find('sys_business_unit', {
        ...(onlyId !== undefined ? { where: { id: onlyId } } : {}),
        limit: 5000,
        context: organizationScopedCtx(organizationId),
      });
      return (Array.isArray(rows) ? rows : [])
        .filter((r: any) => rowOrganizationId(r) === organizationId)
        .map((r: any) => String(r?.id ?? ''))
        .filter(Boolean);
    } catch {
      return [];
    }
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
   * The writer is stamped into `granted_by` by {@link DelegatedAdminGate.assert}
   * once this returns (dual audit: `granted_by` = writer, `delegated_from` =
   * authority source).
   */
  private async assertSelfDelegation(opCtx: any, ctx: any, organizationId?: string): Promise<void> {
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
      const holdings = await this.activeHoldings(String(ctx.userId), positionName, now, organizationId);
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
          organizationId,
        );
        if (!allowed.has(rowAnchor)) {
          deny(
            allowed.size === 0
              ? `business unit anchor '${rowAnchor}' cannot be validated against your own '${positionName}' anchor — an anchor that cannot be proven within your own range is refused, because the anchor roots the delegate's business-unit visibility and may only narrow yours`
              : `business unit anchor '${rowAnchor}' is outside your own effective anchor for '${positionName}' — a delegation may only narrow visibility, never widen it, because the anchor roots the delegate's business-unit visibility`,
            { position: positionName, businessUnitId: rowAnchor },
          );
        }
      }

      // 5. The position must opt in to delegation.
      if (!(await this.positionIsDelegatable(positionName))) {
        deny(`position '${positionName}' is not delegatable — set delegatable: true on the position to allow it`, { position: positionName });
      }

      // 6. A delegatable position must not distribute administration — through
      //    any set an assignment of it grants.
      const boundSets = await this.setsBoundToPosition(positionName);
      for (const b of boundSets) {
        if (parseMaybeJson((b as any).admin_scope ?? (b as any).adminScope)) {
          deny(`position '${positionName}' distributes the admin set '${b.name}' — administration cannot be self-delegated (D12 containment)`, { position: positionName, permissionSet: b.name });
        }
      }
    }
  }

  /** The actor's holdings of `positionName` that are inside their validity
   *  window, tagged `direct` when the holding itself did NOT arrive via
   *  delegation (only a direct holding is re-delegatable) and carrying each
   *  holding's own `businessUnitId` anchor (null = unanchored). The anchor of a
   *  direct holding bounds what a self-delegation of that position may hand out
   *  (cloud#830 — the anchor is visibility load-bearing).
   *
   *  Only holdings that take effect in the caller's organization count
   *  ({@link holdingTakesEffectIn}): a holding stamped for another organization
   *  never answers "you currently hold it" — nor, through its anchor or its
   *  directness, widens what the caller may delegate here. */
  private async activeHoldings(
    userId: string,
    positionName: string,
    now: number,
    organizationId?: string,
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
      .filter((r) => holdingTakesEffectIn(r, organizationId))
      .filter((r) => isGrantActive(r, now))
      .map((r) => ({
        direct: r?.delegated_from == null || r.delegated_from === '',
        businessUnitId:
          r?.business_unit_id != null && r.business_unit_id !== '' ? String(r.business_unit_id) : null,
      }));
  }

  /** The security catalog bound to this gate's engine (ADR-0131 D3), or `undefined` when none was bound. */
  private catalog(): SecurityCatalogReader | undefined {
    return securityCatalogReaderOf(this.deps.ql);
  }

  /**
   * [ADR-0091 D3 rule 5] Does the position's DEFINITION opt in to delegation
   * (`PositionSchema.delegatable`)? Read from the security catalog by name
   * (ADR-0131 D3/D4) — the environment registry, one definition per name per
   * deployment — never from a per-organization `sys_position` row. A name the
   * catalog does not hold, an unbound or unreadable catalog: not delegatable
   * (fail closed).
   */
  private async positionIsDelegatable(positionName: string): Promise<boolean> {
    try {
      const entry = await this.catalog()?.resolve('position', positionName);
      return entry?.definition.delegatable === true;
    } catch {
      return false;
    }
  }

  // ── sys_user_position: user ↔ position assignments ──────────────────

  private async assertAssignmentWrite(opCtx: any, held: HeldScope[]): Promise<void> {
    const targets = await this.delegatedTargets(opCtx);
    for (const t of targets) {
      const buId = t.next?.business_unit_id ?? null;
      const positionSide = t.next && (t.next.position != null || !t.prev) ? 'next' : 'prev';
      const positionName = String(t.next?.position ?? t.prev?.position ?? '');
      const boundSets = positionName ? await this.setsBoundToPosition(positionName) : [];
      // [ruling of record 6649064874] Each value below is named
      // only when the caller wrote or reads it ({@link mayName}); the verdict
      // is the stored row's either way.
      const positionNamed = mayName(t, positionSide, 'position');

      const failure = this.firstApprovalFailure(held, (s) => {
        if (!s.scope.manageAssignments) return 'the scope does not grant manageAssignments';
        // New/updated rows must be anchored inside the delegate's subtree.
        if (t.next) {
          if (!buId) return 'the assignment has no business_unit_id anchor — delegated assignments must target your subtree (ADR-0090 Addendum)';
          if (!s.subtree.has(String(buId))) {
            return outsideScope(mayName(t, 'next', 'business_unit_id')
              ? `business unit '${buId}' is outside the delegated subtree`
              : "the assignment's business unit is outside the delegated subtree");
          }
        }
        // Pre-image (update/delete) must also lie inside the subtree — a
        // delegate can neither capture nor evict assignments beyond it.
        if (t.prev) {
          const prevBu = t.prev.business_unit_id ?? null;
          if (!prevBu) return 'the existing assignment is unanchored (no business_unit_id) — only a tenant admin may modify it';
          if (!s.subtree.has(String(prevBu))) {
            return outsideScope(mayName(t, 'prev', 'business_unit_id')
              ? `the existing assignment's business unit '${prevBu}' is outside the delegated subtree`
              : "the existing assignment's business unit is outside the delegated subtree");
          }
        }
        // Every set the position distributes must be allowlisted
        // ({@link setsBoundToPosition}). A set is named only beside the
        // position it is read from.
        for (const bound of boundSets) {
          if (!scopeAllows(s, bound)) {
            return outsideScope(positionNamed
              ? `position '${positionName}' distributes permission set '${bound.name}', which is not in the scope's allowlist`
              : "the assignment's position distributes a permission set which is not in the scope's allowlist");
          }
          const contained = this.assertScopeGrantContainment(
            bound,
            held,
            /*dryRun*/ true,
            positionNamed ? undefined : "a permission set the assignment's position distributes",
          );
          if (contained) return contained;
        }
        return null;
      });
      if (failure) {
        throw refusalFor(
          failure,
          `delegated '${opCtx.operation}' on sys_user_position rejected`,
          { operation: opCtx.operation, object: opCtx.object, ...(positionNamed ? { position: positionName } : {}) },
        );
      }
    }
  }

  // ── sys_user_permission_set: direct user ↔ set grants ───────────────

  private async assertDirectGrantWrite(opCtx: any, held: HeldScope[]): Promise<void> {
    const targets = await this.delegatedTargets(opCtx);
    for (const t of targets) {
      const side = t.next ? 'next' : 'prev';
      const row = t.next ?? t.prev ?? {};
      const { setRow, setName, unresolved, setNamed, stored, alsoStored } = await this.directGrantSet(t, row);
      const targetUserId = grantHolderOf(row);
      // A target user — one the write names, or one the grant stores — is first
      // asked of the caller's own read door ({@link targetUserUnits}): a user it
      // does not return is answered as a user that does not exist, which holds
      // no business unit the subtree can cover. So an unreadable target is
      // outside the subtree, whatever it is and whichever write carries it.
      const userBUs = targetUserId
        ? await this.targetUserUnits(opCtx.context, targetUserId)
        : new Set<string>();
      // [ruling of record 6649064874] Named only when the caller
      // wrote or reads it ({@link mayName}); the verdict is the stored row's.
      const userNamed = mayName(t, side, 'user_id');
      // [ADR-0090 D12] An update that points a stored grant at another user
      // touches two holders: the one it gives the grant to (above) and the one
      // it takes the grant from — the pre-image's. Both must lie inside the
      // subtree, so a delegate can neither capture nor evict a direct grant
      // beyond it, as `assertAssignmentWrite` judges an assignment's pre-image
      // beside its new value. The stored holder is judged exactly as the holder
      // the write names: through the caller's own read ({@link targetUserUnits}),
      // with the same reason, class, sentence and details, and named only when
      // the caller reads it at its stored value ({@link mayName}). A pre-image
      // naming no holder is one only a tenant admin may move, as an unanchored
      // assignment is one only a tenant admin may modify.
      const fromHolder = t.next && t.prev && grantHolderOf(t.prev) !== targetUserId
        ? await this.storedHolderJudged(opCtx.context, t)
        : null;
      // [ADR-0090 D12] Likewise an update that re-names a stored grant takes
      // the grant's own set away (`stored`, {@link directGrantSet}): that set is
      // judged exactly as the removal of the grant judges it — the same
      // reasons, sentences and details, the set named only when the caller
      // reads it. Which set a refusal is about is the set its details name:
      // `refusedSet` is set by the check of the LAST scope tried, the one whose
      // failure {@link firstApprovalFailure} surfaces.
      let refusedSet: GrantSetJudgment = { setRow, setName, setNamed };
      const judgedOn = (judged: GrantSetJudgment, reason: string | ScopeViolation): string | ScopeViolation => {
        refusedSet = judged;
        return reason;
      };

      const failure = this.firstApprovalFailure(held, (s) => {
        refusedSet = { setRow, setName, setNamed };
        if (!s.scope.manageAssignments) return 'the scope does not grant manageAssignments';
        if (unresolved) return unresolved;
        // [ADR-0150 D3] The holder the grant will name, and — where the write
        // seam re-stamps the column (an insert, a re-name) — the holder the
        // name resolves to with no caller: each must be allowlisted.
        for (const judged of [setRow ?? { name: setName }, ...(alsoStored ?? [])]) {
          if (!scopeAllows(s, judged)) {
            // The package is named only when the allowlist names the set's
            // name at another holder — the one case the name alone misleads.
            const atHolder = judged.packageId && s.scope.assignablePermissionSets.includes(setName)
              ? ` of package '${judged.packageId}'` : '';
            return outsideScope(setNamed
              ? `permission set '${setName}'${atHolder} is not in the scope's allowlist`
              : "the grant's permission set is not in the scope's allowlist");
          }
        }
        // The set the update takes away, judged as the removal judges it.
        if (stored) {
          if (stored.unresolved) return judgedOn(stored, stored.unresolved);
          if (!scopeAllows(s, stored.setRow ?? { name: stored.setName })) {
            return judgedOn(stored, outsideScope(stored.setNamed
              ? `permission set '${stored.setName}' is not in the scope's allowlist`
              : "the grant's permission set is not in the scope's allowlist"));
          }
        }
        if (!targetUserId) return 'the grant names no target user';
        // [ADR-0090 D12; ruling on #26059, Q3] A target user is inside the
        // subtree only through a business unit of the subtree. A user holding
        // no business-unit membership has none, and neither has an id naming
        // no user, nor a user the caller cannot read, named or stored (above):
        // each is outside the subtree, exactly as a user whose units all lie
        // elsewhere is. So the refusal is one reason, one class, one sentence
        // and one set of details for all of them, whether or not the target
        // exists or holds a membership.
        if (![...userBUs].some((bu) => s.subtree.has(bu))) {
          return outsideScope(userNamed
            ? `target user '${targetUserId}' is outside the delegated subtree`
            : "the grant's target user is outside the delegated subtree");
        }
        // The holder the update takes the grant from, judged as the one it
        // gives it to: the same reason, sentence and details.
        if (fromHolder) {
          if (!fromHolder.userId) return 'the existing grant names no target user — only a tenant admin may move it';
          if (![...fromHolder.units].some((bu) => s.subtree.has(bu))) {
            return outsideScope(fromHolder.named
              ? `target user '${fromHolder.userId}' is outside the delegated subtree`
              : "the grant's target user is outside the delegated subtree");
          }
        }
        for (const judged of [...(setRow ? [setRow] : []), ...(alsoStored ?? [])]) {
          const contained = this.assertScopeGrantContainment(judged, held, true, setNamed ? undefined : "the grant's permission set");
          if (contained) return contained;
        }
        if (stored?.setRow) {
          const contained = this.assertScopeGrantContainment(stored.setRow, held, true, stored.setNamed ? undefined : "the grant's permission set");
          if (contained) return judgedOn(stored, contained);
        }
        return null;
      });
      if (failure) {
        throw refusalFor(
          failure,
          `delegated '${opCtx.operation}' on sys_user_permission_set rejected`,
          {
            operation: opCtx.operation,
            object: opCtx.object,
            ...(refusedSet.setNamed ? { permissionSet: refusedSet.setName } : {}),
          },
        );
      }
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────

  /** First scope that fully approves wins; otherwise the FIRST failure reason
   *  from the LAST scope tried is surfaced (all scopes rejected), keeping
   *  whether it is a {@link ScopeViolation}. */
  private firstApprovalFailure(
    held: HeldScope[],
    check: (s: HeldScope) => string | ScopeViolation | null,
  ): string | ScopeViolation | null {
    let lastReason: string | ScopeViolation | null = null;
    for (const s of held) {
      const reason = check(s);
      if (reason == null) return null;
      lastReason = typeof reason === 'string'
        ? `${reason} (scope from '${s.setName}')`
        : outsideScope(`${reason.reason} (scope from '${s.setName}')`);
    }
    return lastReason ?? 'no delegated scope applies';
  }

  /**
   * If `setRowOrDef` itself carries an adminScope, verify strict containment
   * against the actor's held scopes. Returns a failure description or null.
   * (`dryRun` callers use the string as a per-scope rejection reason.)
   * `unnamed`, when given, is how the description refers to the set instead of
   * by name — for a set read from a value the caller may not be told
   * ({@link mayName}).
   */
  private assertScopeGrantContainment(setRowOrDef: any, held: HeldScope[], _dryRun: boolean, unnamed?: string): string | null {
    const carried: AdminScope | undefined =
      parseMaybeJson(setRowOrDef.admin_scope ?? setRowOrDef.adminScope) ?? undefined;
    if (!carried) return null;
    // NOTE: containment needs resolved subtrees — checked synchronously against
    // the pre-resolved held scopes. Grant paths compare conservatively by
    // definition (name + flags + allowlist).
    for (const s of held) {
      if (this.definitionContainsStrictly({ ...s.scope, allowed: s.allowed }, carried, setRowOrDef.assignableHolders)) return null;
    }
    return `granting ${unnamed ?? `set '${setRowOrDef.name ?? '?'}'`} would hand out an adminScope not strictly contained by yours`;
  }

  /** Definition-level strict containment (no tree resolution): same-root-or-
   *  narrower BU (equal root only when outer includes subtree and inner is the
   *  same or a descendant — without the tree we accept equal root + subtree),
   *  rights ⊇, allowlist ⊇, and NOT identical. Conservative: unknown ⇒ not
   *  contained.
   *
   *  [#23488] The rights axis is `manageAssignments` alone. The retired
   *  `manageBindings` / `authorEnvironmentSets` granted nothing (no door
   *  honoured either), so they are not read on EITHER side: a stored scope
   *  that still carries one — a row the D2 conversion has not yet rewritten —
   *  neither out-reaches a delegate nor counts as the axis that makes an
   *  otherwise equal scope "strictly smaller". The second was a live
   *  loosening: an inert `true` on the delegate's side let it hand out a
   *  scope equal to its own through the equal-scope refusal. */
  private definitionContainsStrictly(
    outer: HeldScope['scope'] & Pick<HeldScope, 'allowed'>,
    inner: AdminScope,
    innerHolders?: ReadonlySet<string>,
  ): boolean {
    const innerFull = {
      includeSubtree: inner.includeSubtree !== false,
      manageAssignments: inner.manageAssignments === true,
      assignable: (inner.assignablePermissionSets ?? []) as string[],
    };
    // BU axis (definition level): identical root, and inner must not cover
    // MORE of the tree than outer.
    if (inner.businessUnit !== outer.businessUnit) return false;
    if (innerFull.includeSubtree && outer.includeSubtree === false) return false;
    // Rights axis: inner ⊆ outer.
    if (innerFull.manageAssignments && !outer.manageAssignments) return false;
    // Allowlist axis: inner ⊆ outer — by name, and [ADR-0150 D3] by holder:
    // every holder the inner allowlist names (resolved from its own set's
    // package) must be one the outer allowlist names.
    for (const name of innerFull.assignable) {
      if (!outer.assignablePermissionSets.includes(name)) return false;
    }
    if (innerHolders) {
      for (const key of innerHolders) {
        if (!outer.allowed.has(key)) return false;
      }
    }
    // Strictness: some axis must be strictly smaller.
    const equalRights = innerFull.manageAssignments === (outer.manageAssignments === true);
    const equalTree = innerFull.includeSubtree === (outer.includeSubtree !== false);
    const equalAllow =
      innerFull.assignable.length === outer.assignablePermissionSets.length &&
      innerFull.assignable.every((n) => outer.assignablePermissionSets.includes(n)) &&
      (!innerHolders || innerHolders.size === outer.allowed.size);
    return !(equalRights && equalTree && equalAllow);
  }

  /** Resolve every adminScope carried by the actor's resolved sets, inside the
   *  caller's own organization ({@link callerOrganizationId}).
   *
   *  [ADR-0123 D1/D2] A delegated scope held in a context that names no
   *  organization covers nothing: with no organization, no scope is resolved
   *  and no business unit is read — so no subtree, no covered unit
   *  ({@link scopedBusinessUnitIds}), no delegable scope or placeable unit
   *  ({@link describeDelegableScope}), no user covered
   *  ({@link scopesCoverUser}), and the write gate refuses naming the missing
   *  active organization ({@link NO_ACTIVE_ORGANIZATION}). A subtree is one
   *  organization's units, and a context that names none has no organization
   *  to resolve one in — the rule the resolver applies to the grants that
   *  carry the scope (`grantAppliesInTenant`, `@objectstack/core`). */
  private async resolveHeldScopes(
    sets: PermissionSet[],
    organizationId?: string,
  ): Promise<HeldScope[]> {
    if (!organizationId) return [];
    const out: HeldScope[] = [];
    for (const { setName, scope, carrier } of adminScopesCarriedBy(sets)) {
      const subtree = await this.resolveSubtree(scope.businessUnit, scope.includeSubtree, organizationId);
      out.push({ setName, scope, subtree, allowed: await this.allowlistHolders(scope.assignablePermissionSets, carrier) });
    }
    return out;
  }

  /**
   * BU name → covered BU-id set (root + descendants when includeSubtree),
   * resolved INSIDE the caller's own organization.
   *
   * The name is not a unique key (`ANCHOR_CANDIDATE_LIMIT`), so two things
   * narrow the read, and they are not redundant:
   *
   * 1. the read carries the caller's organization, so `applyTenantScope`
   *    composes a predicate instead of returning early on a bare
   *    `{ isSystem: true }`;
   * 2. the candidates that come back are reduced to the caller's OWN row by
   *    {@link resolveOwnOrganizationRow}. That arm is load-bearing on its own:
   *    a driver with no native tenant scoping returns every organization's
   *    rows, organization-less ones included (the SQL driver's NULL arm, which
   *    also returned organization-less rows, is retired — ADR-0131 D8), and an
   *    organization-less business unit is invalid state
   *    (`organization-scope.ts`), so neither class may answer a delegation
   *    boundary.
   *
   * Fail closed on both axes: a name that resolves to no row of the caller's
   * own organization approves nothing, exactly as a misconfigured scope does.
   * `organizationId` is required: a context that names no organization holds
   * no scope ({@link resolveHeldScopes}) and never reaches this read, so every
   * by-name read here carries the caller's organization.
   */
  private async resolveSubtree(
    businessUnitName: string,
    includeSubtree: boolean,
    organizationId: string,
  ): Promise<Set<string>> {
    const ql = this.deps.ql;
    if (!ql?.find) return new Set<string>();
    let root: any = null;
    try {
      const roots = await ql.find('sys_business_unit', {
        where: { name: businessUnitName },
        limit: ANCHOR_CANDIDATE_LIMIT,
        context: organizationScopedCtx(organizationId),
      });
      root = resolveOwnOrganizationRow(Array.isArray(roots) ? roots : [], organizationId).own;
    } catch { root = null; }
    // Unresolvable, or resolvable only in another organization → approves
    // nothing (fail closed).
    if (!root?.id) return new Set<string>();
    if (!includeSubtree) return new Set<string>([String(root.id)]);
    // The subtree is bounded to the caller's organization, the one the root
    // was resolved inside above — never "any organization".
    return this.resolveSubtreeById(String(root.id), organizationId);
  }

  /** BU id → covered BU-id set (root id + all descendants). Subtree is always
   *  walked: the delegator's readScope depth is not known on the delegation
   *  path, so the whole subtree is the containment bound — matching the D12
   *  admin subtree check. Fail-closed on unresolvable ids (empty set).
   *
   *  Bounded to ONE organization, `organizationId`, which every caller names:
   *  a descendant stamped with any other organization is outside the subtree
   *  and is not walked through, whether or not the caller's context names an
   *  organization. `null` is the bound of an organization-less root (invalid
   *  state on a stamped store, `organization-scope.ts`, so met only on a store
   *  whose units carry no organization at all): organization-less descendants
   *  only, so a stamped unit is never reached from one, nor one from a stamped
   *  root.
   *
   *  [ADR-0105 D6, red line 2: BU trees remain org-internal] The ROOT is held
   *  to the same bound as its descendants: it is read under the bound's own
   *  context, and a root whose row is not a unit of `organizationId` (`null`:
   *  an organization-less unit) covers nothing — a walk never starts at a unit
   *  outside the organization it is bounded to, whichever caller names the
   *  id. */
  private async resolveSubtreeById(rootId: string, organizationId: string | null): Promise<Set<string>> {
    const ids = new Set<string>();
    const ql = this.deps.ql;
    if (!ql?.find || !rootId) return ids;
    let roots: any[] = [];
    try {
      roots = await ql.find('sys_business_unit', {
        where: { id: String(rootId) },
        limit: 1, // `id` is the key: one unit or none
        context: organizationScopedCtx(organizationId ?? undefined),
      });
    } catch { roots = []; }
    // The descendants' predicate, applied to the root: whatever a driver
    // returned, a unit outside the bound's organization roots no subtree.
    const rootInOrganization = (Array.isArray(roots) ? roots : [])
      .some((r: any) => String(r?.id ?? '') === String(rootId) && rowOrganizationId(r) === organizationId);
    if (!rootInOrganization) return ids;
    ids.add(String(rootId));
    let frontier: string[] = [String(rootId)];
    for (let depth = 0; depth < MAX_TREE_DEPTH && frontier.length > 0; depth++) {
      let children: any[] = [];
      try {
        children = await ql.find('sys_business_unit', {
          where: { parent_business_unit_id: { $in: frontier } },
          limit: 5000,
          context: organizationScopedCtx(organizationId ?? undefined),
        });
      } catch { children = []; }
      const next: string[] = [];
      for (const c of Array.isArray(children) ? children : []) {
        // A parent link is not an organization predicate: whatever a driver
        // returned, a descendant outside the subtree's organization never
        // widens the subtree a delegation is judged against.
        if (rowOrganizationId(c) !== organizationId) continue;
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
   *  can't be proven inside the delegator's range is refused upstream.
   *
   *  Every subtree in the union is one organization's, the caller's, its root
   *  included ({@link resolveSubtreeById}): a holding's anchor or a membership
   *  that is not a unit of the caller's organization contributes nothing. */
  private async delegatorAnchorSubtree(
    userId: string,
    directHoldings: Array<{ businessUnitId: string | null }>,
    organizationId?: string,
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    // A holding takes effect only in its own organization
    // ({@link holdingTakesEffectIn}), so a context naming none holds nothing
    // to anchor a delegation in, and there is no organization to bound a walk to.
    if (!organizationId) return allowed;
    let memberSubtreeResolved = false;
    for (const h of directHoldings) {
      if (h.businessUnitId) {
        for (const id of await this.resolveSubtreeById(h.businessUnitId, organizationId)) allowed.add(id);
      } else if (!memberSubtreeResolved) {
        // An unanchored direct holding resolves to the delegator's own member
        // BU(s); resolve those once (they don't vary by holding).
        memberSubtreeResolved = true;
        for (const bu of await this.businessUnitsOfUser(userId)) {
          for (const id of await this.resolveSubtreeById(bu, organizationId)) allowed.add(id);
        }
      }
    }
    return allowed;
  }

  /**
   * [ADR-0090 D12; ruling of record 5985885287] The rows a delegate's write
   * targets: `{ next, prev }` per row — an insert's payload rows, or the one row
   * a by-id write addresses (`authorize` refused a write naming no single row
   * before the walk), `prev` its pre-image and an update's `next` its payload
   * over that pre-image.
   *
   * Whether there is a row to judge is asked of the CALLER's own read
   * ({@link callerRead}): a row the caller cannot read answers exactly what an
   * id naming no row answers — one refusal, here at the gate, never a
   * fall-through to the engine. A row the caller reads is judged on the stored
   * row, never on the caller's read of it (ruling of record 6649064874): that
   * read is served through the caller's field-level security, and a judgement
   * made on what a field rule hid would be made on less than the row. So a row
   * the caller reads keeps its verdict, and its guidance names only what the
   * caller may be told ({@link mayName}).
   *
   * A read the read door REFUSES (a declared 4xx — the object's read grant
   * withheld) hides no row: the stored row is judged as before, and a refusal
   * the gate then answers for the by-id write the caller addressed is answered
   * with that read refusal by the security middleware
   * (`readDoorAnswerForGateRefusal`), for every id alike. A store fault, in
   * either read, propagates as raised: an outage is neither an answer nor a
   * refusal.
   *
   * No row is {@link UnreadableAddressedRowRefusal}, which the middleware
   * answers for the by-id write the caller addressed with the read door's
   * not-found. Each target also carries what the caller may be told of it
   * ({@link DelegatedTarget}): the columns its payload wrote, and the columns
   * its own read returned at the stored value — none, when that read was
   * refused.
   */
  private async delegatedTargets(opCtx: any): Promise<DelegatedTarget[]> {
    const op = opCtx.operation;
    const payload = rowsOf(opCtx);
    if (op === 'insert') return payload.map((r) => ({ next: r, prev: null, wrote: null, reads: new Set<string>() }));

    const id = extractSingleId(opCtx) as string | number;
    const read = await this.callerReadUnlessRefused(opCtx, id);
    const prev = !read.refused && read.row === null ? null : await this.storedRow(opCtx.object, id);
    if (!prev) {
      throw new UnreadableAddressedRowRefusal(
        `[Security] Access denied: delegated '${op}' on ${opCtx.object} rejected — the assignment row it addresses could not be read.`,
        { operation: op, object: opCtx.object },
      );
    }
    const reads = columnsReadAsStored(read.refused ? null : read.row, prev);
    if (op === 'update') {
      const next = payload.length > 0 ? payload[0] : null;
      // Merge unchanged pre-image values so boundary checks see the full row
      // (an update payload may carry only the changed columns).
      return [{
        next: next ? { ...prev, ...next } : prev,
        prev,
        wrote: new Set(next && typeof next === 'object' ? Object.keys(next) : []),
        reads,
      }];
    }
    // delete / transfer / restore / purge — judged on the pre-image alone.
    return [{ next: null, prev, wrote: new Set<string>(), reads }];
  }

  /**
   * The caller's own read of row `id` ({@link callerRead}), or `refused` when
   * the read door refuses it (a declared 4xx). A store fault propagates.
   */
  private async callerReadUnlessRefused(
    opCtx: any,
    id: string | number,
  ): Promise<{ refused: true } | { refused: false; row: any | null }> {
    try {
      return { refused: false, row: await this.callerRead(opCtx, id) };
    } catch (e) {
      const status = declaredHttpStatus(e);
      if (status !== undefined && status < 500) return { refused: true };
      throw e;
    }
  }

  /** The stored row `id` of `object`, read by the system; `null` for no row. A store fault propagates. */
  private async storedRow(object: string, id: string | number): Promise<any | null> {
    const ql = this.deps.ql;
    if (!ql?.findOne) return null;
    const row = await ql.findOne(object, { where: { id }, context: SYSTEM_CTX });
    return row && typeof row === 'object' ? row : null;
  }

  /**
   * [ADR-0131 D3/D4, ADR-0090 D12 as amended 2026-10-17] The permission sets a
   * position distributes, as the delegated walk judges them: every set an
   * assignment of it grants — {@link setsCarriedByPosition}, the one answer the
   * organization-level branch reads too: the names its DEFINITION carries
   * (`PositionSchema.permissionSets`), each with the `adminScope` of the
   * catalog's definition of that name. That is the binding
   * the authorization resolver grants through, read from the same security
   * catalog, never from a `sys_position_permission_set` junction row (which
   * grants nothing since the resolver stopped reading it). So the allowlist
   * check, the D12 strict containment, the self-delegation rule against
   * distributing administration and the assignable-positions listing all judge
   * exactly what an assignment will grant. A set that only shares the
   * position's name is granted by nothing (#24757), so it is not judged.
   *
   * A name the definition carries that the catalog does not hold is still
   * returned, with no `adminScope`: it grants nothing today, but the binding is
   * declared, and a set authored under that name later starts granting with no
   * further write — so a delegate must have it allowlisted too (refuses more,
   * never less). A position the catalog does not hold distributes nothing.
   *
   * ⛔ A catalog that cannot be read is not "distributes nothing": that would
   * approve every assignment's allowlist check. The read's own loud failure
   * (`AuthzStoreUnavailableError`) propagates, and the write is refused with it.
   */
  private async setsBoundToPosition(positionName: string): Promise<BoundSet[]> {
    const catalog = this.catalog();
    if (!catalog || !positionName) return [];
    const carried = await this.setsCarriedByPosition(positionName);
    if (!carried) return [];
    const out: BoundSet[] = [];
    for (const name of carried.names) {
      // [ADR-0150 D7] Resolved from the position's package: a name it cannot
      // resolve grants nothing, so it is returned with no `adminScope`, like a
      // name the catalog does not hold (refuses more, never less).
      const set = await catalog.resolve('permission', name, { position: carried.position });
      out.push(set ? await this.boundSetOf(set) : { name });
    }
    return out;
  }

  /**
   * [ADR-0131 D4] The permission set a direct-grant write is judged on.
   *
   * - **The grant's own set** — a delete, or an update that keeps the grant's
   *   set: read BY NAME from the grant's `permission_set` (the pre-image's, or
   *   the name the update supplies), in the security catalog (ADR-0131 D3) —
   *   the definition the resolver grants. A grant that names nothing, or names
   *   a set the catalog does not hold, is not one a delegate can be shown to
   *   hold authority over, so the write is refused (`unresolved`) — fail
   *   closed; a tenant admin is not judged here at all.
   * - **The set the write points the grant AT** — an insert, or an update that
   *   re-names the grant: the caller's own `permission_set`, judged as the
   *   catalog's definition of that name. A name the catalog does not hold is
   *   still judged against the allowlist (the write is then refused 400 by the
   *   grant's own name refusal, `grant-permission-set-name.ts`); no
   *   `sys_permission_set` row and no `permission_set_id` is read.
   * - **The set an update re-names the grant AWAY from** (`stored`) — the
   *   stored grant's own set, judged too, exactly as the removal of that grant
   *   judges it ({@link grantOwnSet}). [ADR-0090 D12] A re-name takes that set
   *   away from its holder, so a delegate can neither capture nor evict a
   *   direct grant beyond its scope: a grant it could not remove it cannot
   *   re-name either.
   *
   * `setNamed` says whether a refusal may name the set ({@link mayName}): the
   * name the write points the grant at always (the caller's own); the grant's
   * own name — the one a keep-set update or a removal judges, and the one a
   * re-name takes away — only when the caller's read returned it.
   */
  private async directGrantSet(
    t: DelegatedTarget,
    row: any,
  ): Promise<GrantSetJudgment & { stored?: GrantSetJudgment; alsoStored?: BoundSet[] }> {
    const renamed = !!t.next && (!t.prev || grantSetNameOf(t.next) !== grantSetNameOf(t.prev));
    // [ADR-0150 D8 R1] A write that re-binds the grant's package column points
    // it at another holder, as a re-name points it at another set.
    const rebound = !!t.next && !!t.prev && grantPackageOf(t.next) !== grantPackageOf(t.prev);
    if (renamed || rebound) {
      const nextName = grantSetNameOf(t.next) ?? '';
      const setRow = nextName ? await this.catalogSet(nextName, grantPackageOf(t.next)) : null;
      // The write seam (`stored-permission-set-package-stamp.ts`) re-stamps the
      // column of an insert and a re-name from the name with no caller: that
      // holder is judged too, so the one stored is judged either way.
      const restamped = renamed && nextName ? await this.catalogSet(nextName) : null;
      const alsoStored = restamped && restamped.packageId !== setRow?.packageId ? [restamped] : [];
      const stored = t.prev ? await this.grantOwnSet(grantSetNameOf(t.prev), mayName(t, 'prev', 'permission_set'), grantPackageOf(t.prev)) : null;
      return { setRow, setName: nextName, setNamed: true, ...(stored ? { stored } : {}), ...(alsoStored.length > 0 ? { alsoStored } : {}) };
    }
    return this.grantOwnSet(grantSetNameOf(row), mayName(t, t.next ? 'next' : 'prev', 'permission_set'), grantPackageOf(row));
  }

  /**
   * [ADR-0131 D4] A grant's own set, `name` (the name it stores, or the name a
   * keep-set update supplies), as a delegated write on that grant judges it:
   * read BY NAME in the security catalog. A grant naming nothing, or naming a
   * set the catalog does not hold, is `unresolved` — fail closed. `setNamed`
   * says whether a refusal may name it ({@link mayName}).
   */
  private async grantOwnSet(name: string | undefined, setNamed: boolean, packageColumn?: string): Promise<GrantSetJudgment> {
    if (!name) {
      return {
        setRow: null,
        setName: '',
        setNamed,
        unresolved: 'the grant names no permission set (it is not yet named, or could not be) — only a tenant admin may change it',
      };
    }
    const setRow = await this.catalogSet(name, packageColumn);
    if (!setRow) {
      return {
        setRow: null,
        setName: name,
        setNamed,
        unresolved: `${setNamed ? `permission set '${name}'` : "the grant's permission set"} is not in the security catalog, so this grant confers nothing — only a tenant admin may change it`,
      };
    }
    return { setRow, setName: name, setNamed };
  }

  /**
   * The security catalog's definition of the permission set `name`, as the
   * containment check reads it (`{ name, adminScope }`), or `null` when the
   * catalog holds no such set, none is bound, or the read fails (fail closed:
   * the caller refuses a delegate's write it cannot judge).
   */
  private async catalogSet(name: string, packageColumn?: string): Promise<BoundSet | null> {
    try {
      // [ADR-0150 D8 R1] Read as the resolver reads the grant: its package
      // column names the exact holder; none resolves with no caller (D3).
      const entry = await this.catalog()?.resolve('permission', name, storedPermissionSetScope(packageColumn));
      if (!entry) return null;
      return await this.boundSetOf(entry);
    } catch {
      return null;
    }
  }

  /** [ADR-0150 D3] A resolved set as the gate judges it: its holder, and the holders its own allowlist names. */
  private async boundSetOf(entry: SecurityCatalogEntry): Promise<BoundSet> {
    const packageId = catalogEntryAddress(entry).packageId;
    const adminScope = entry.definition.adminScope;
    const raw = parseMaybeJson(adminScope);
    const assignable = raw && typeof raw === 'object' && Array.isArray(raw.assignablePermissionSets)
      ? (raw.assignablePermissionSets as unknown[]).filter((n): n is string => typeof n === 'string')
      : undefined;
    return {
      name: entry.name,
      packageId,
      ...(adminScope ? { adminScope } : {}),
      ...(assignable ? { assignableHolders: await this.allowlistHolders(assignable, packageId) } : {}),
    };
  }

  /**
   * [ADR-0150 D3] The holders an allowlist written inside a set of package
   * `carrier` names: each name resolved from that package (`null`: as a caller
   * with no package), keyed by `permissionSetAddressKey`. A name the rule
   * refuses, or no holder serves, adds none — it allows nothing.
   */
  private async allowlistHolders(names: readonly string[], carrier: string | null): Promise<Set<string>> {
    const out = new Set<string>();
    const catalog = this.catalog();
    if (!catalog) return out;
    for (const name of new Set(names)) {
      const answer = await resolveCatalogReference(catalog, 'permission', name, storedPermissionSetScope(undefined, carrier));
      if (answer.status === 'resolved') {
        out.add(permissionSetAddressKey(catalogEntryAddress(answer.entry).packageId, answer.entry.name));
      }
    }
    return out;
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
