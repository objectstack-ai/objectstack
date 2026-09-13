// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/admin/set-user-manager` — the admin write surface for
 * `sys_user.manager_id` (#16678 Phase 3, ruled as option B on the Phase 2
 * design: the manager is the relation an ADMIN sets explicitly on the user,
 * and `sys_business_unit.manager_user_id` — the unit head — stays independent
 * of it; nothing here derives one from the other).
 *
 * ## The hole this closes, measured on the tree it was written against
 *
 * `sys_user.manager_id` drives two shipped behaviours — the approvals
 * `{ type: 'manager' }` rung (`lookupManager`) and the `own_and_reports` read
 * scope (ADR-0057) — and until this endpoint **no product surface could write
 * it**:
 *
 *   - the generic data path refuses it: `sys_user` is `managedBy:
 *     'better-auth'` and the ADR-0092 D2 managed-update whitelist is
 *     `{name, image, locale}` (`SYS_USER_PROFILE_EDIT_FIELDS`);
 *   - the admin bulk import does not carry it: `admin-import-users.ts` matches
 *     `manager_id` 0 times, against a control of `phone_number` 8;
 *   - the Console renders no field for it (`readonly: true` on the column).
 *
 * So the rung expanded to nobody on every record in any install without a
 * directory sync, and the only population route was a seed or another
 * system-context write.
 *
 * ## Why a dedicated operation rather than a column on a profile payload
 *
 * The measured precedents make this write its own operation — a dedicated
 * reference endpoint with the property read-only on the user resource. This
 * repo already has that shape: `POST /api/v1/auth/admin/unlock-user` and
 * `POST /api/v1/auth/admin/import-users`, both ObjectStack mounts on the raw
 * app ahead of the better-auth catch-all, both platform-admin gated
 * (ADR-0068), both ledgered in `auth-route-ledger.ts`.
 *
 * ⛔ It is NOT admitted to ADR-0092 Tier 1, and the design turns on that:
 * since the ADR-0092 D5 amendment, Tier-1 membership implies SELF-editability
 * (the `sys_user_self` policy widened from `select` to `all`), so admitting
 * `manager_id` there would hand every member their own first-rung approver
 * and a widening of their own `own_and_reports` read scope in one move.
 * ⇒ `SYS_USER_PROFILE_EDIT_FIELDS` is untouched,
 * `MANAGED_EXTENSION_EDITABLE_FIELDS.sys_user` stays `{locale}`, the column
 * keeps `readonly: true`, and ADR-0092 D4 ("every non-Tier-1 field renders
 * non-editable in the standard edit form") stays true by construction. This
 * endpoint reaches the column **by system context**, the same way
 * `admin-import-users` already reaches `phone_number` and `role`: both write
 * guards gate on `isUserContextWrite`, spelled `Boolean(userId) && isSystem
 * !== true`, so a system-context write bypasses the whitelist by
 * construction and no whitelist entry is added anywhere.
 *
 * ## The refusals, and why each one is HERE
 *
 * Every refusal below is enforced AT THE WRITE. That is not belt-and-braces
 * for the cycle check, it is the only enforcement that exists: the only
 * manager-chain walkers in the open tree are single-hop
 * (`ApprovalService.lookupManager` reads one row; `TeamGraphService.managerOf`
 * reads one row), and the multi-hop `subordinate_user_ids` resolver ships
 * only in `@objectstack/security-enterprise`, outside this repo. Nothing
 * downstream will catch a loop this endpoint lets in.
 *
 *  1. **Self-assignment** (`userId === managerId`) — refused outright. An
 *     approver rung that resolves to the submitter is the whole failure this
 *     tier exists to prevent.
 *  2. **Cycle** — the proposed manager's own chain is walked upward and the
 *     link is refused when it closes a loop. The walk is itself cycle-safe (a
 *     `seen` set), so a loop that ALREADY exists upstream is reported rather
 *     than hung on.
 *  3. **Depth** — refused past {@link MAX_MANAGER_CHAIN_DEPTH}. ADR-0057 D3
 *     requires the hierarchy rollups it feeds to be "bounded (hard cap +
 *     cache, mirroring the `org_user_ids` cap)"; an unbounded chain written
 *     here is an unbounded rollup there. The reference resolver in
 *     `packages/qa/dogfood` bounds itself at 20 levels, and this cap is the
 *     same number so a chain this endpoint accepts cannot exceed what that
 *     resolver walks.
 *  4. **Cross-organization** — refused when the two identities are PROVABLY
 *     in disjoint organizations. `sys_user` carries no `organization_id` (it
 *     is a global identity table), so `sys_member` rows are the only tenancy
 *     fact either identity has; this mirrors `managerIsProvablyOutsideOrg`,
 *     which already drops such a manager at ROUTING time with a warning. Both
 *     halves are wanted: data drifts after a write, so the read-time screen
 *     stays the last line, and the write-time refusal is the only one an
 *     operator can act on at the moment they made the mistake.
 *  5. **Directory-owned identity** — refused when the target is
 *     `source: 'idp_provisioned'`. The ruling picked "directory wins, per
 *     identity", keyed on the `sys_user.source` column the platform already
 *     stamps and already uses to hide three self-service identity actions.
 *     The rejected alternative was last-writer-wins, which stores a value the
 *     next sync silently reverts — a write that reports success and does not
 *     persist, which is exactly what ADR-0049 exists to refuse.
 *
 * ## Why these `error.code` values and not dedicated ones
 *
 * `error.code` is a CLOSED vocabulary — `StandardErrorCode` union
 * `ERROR_CODE_LEDGER` — and both live in `packages/spec`, which this change
 * is fenced out of. So every code below is one this package may already emit,
 * and the machine-readable discrimination between refusals that share a code
 * is carried by `error.details.reason`, whose values are pinned by this
 * module's tests. A dedicated code per refusal would be the better shape and
 * is recorded as a follow-up for the seat that owns the spec vocabulary; it
 * is ⛔ not worth reaching over the fence for.
 *
 *   | refusal                   | code                | status | details.reason        |
 *   |---------------------------|---------------------|--------|-----------------------|
 *   | body shape                | INVALID_REQUEST     | 400    | invalid_body          |
 *   | target user missing       | RESOURCE_NOT_FOUND  | 404    | user_not_found        |
 *   | proposed manager missing  | INVALID_REFERENCE   | 400    | manager_not_found     |
 *   | self-assignment           | INVALID_FIELD       | 400    | self_assignment       |
 *   | cycle                     | RESOURCE_CONFLICT   | 409    | cycle                 |
 *   | depth cap                 | VALUE_OUT_OF_RANGE  | 400    | max_depth_exceeded    |
 *   | cross-organization        | INVALID_REFERENCE   | 400    | cross_organization    |
 *   | directory-owned identity  | PERMISSION_DENIED   | 403    | idp_provisioned       |
 *
 * Authorization is the caller's, not this module's: the mount runs the
 * ADR-0068 platform-admin gate (`judgePlatformAdmin`) and hands the actor in
 * already judged, identical to every other `/api/v1/auth/admin/*` route in
 * the ledger. The finer "maintain the org chart in my subtree" axis is a
 * recorded follow-up and ⛔ is deliberately NOT declared here: ADR-0049
 * forbids declaring a permission that is not enforced, and the three axes
 * `delegated-admin-gate.ts` ships today express no such thing.
 */

import { authSystemWriteContext } from './auth-actor-attribution.js';
import type { AdminActor, EndpointResult } from './admin-user-endpoints.js';

/**
 * Hard cap on the reporting chain this endpoint will create, counted in links
 * from the edited user upward. See refusal 3 above for why a cap exists at
 * all and why this is the number.
 */
export const MAX_MANAGER_CHAIN_DEPTH = 20;

/** The machine-readable discriminator carried on every refusal. */
export type SetUserManagerRefusalReason =
  | 'invalid_body'
  | 'user_not_found'
  | 'manager_not_found'
  | 'self_assignment'
  | 'cycle'
  | 'max_depth_exceeded'
  | 'cross_organization'
  | 'idp_provisioned'
  | 'engine_unavailable';

/** The slice of the ObjectQL engine this endpoint needs. */
export interface SetUserManagerEngine {
  find(objectName: string, query?: unknown): Promise<unknown[]>;
  update(objectName: string, data: unknown, options?: unknown): Promise<unknown>;
}

export interface SetUserManagerDeps {
  /** Resolves the live data engine; `undefined` when none is wired. */
  getDataEngine(): SetUserManagerEngine | undefined | null;
  /**
   * Functional-degradation channel. A tenancy read that FAILS leaves the
   * cross-organization screen unable to answer, and this endpoint then routes
   * as it would with no tenancy fact recorded — the same fail-open posture the
   * routing-time screen states for itself. It says so once rather than
   * degrading in silence.
   */
  logger?: { warn(msg: string, meta?: unknown): void };
}

/** Result shape: `EndpointResult` plus the refusal discriminator. */
export interface SetUserManagerResult {
  status: number;
  body: {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string; details?: { reason: SetUserManagerRefusalReason } };
  };
}

// A `SetUserManagerResult` is an `EndpointResult` with one optional extra
// field, so the mount can answer with either shape. Asserted structurally
// rather than declared, so the two cannot drift apart unnoticed.
const _assignableToEndpointResult: (r: SetUserManagerResult) => EndpointResult = (r) => r;
void _assignableToEndpointResult;

type UserRow = { id?: unknown; manager_id?: unknown; source?: unknown };

function refuse(
  status: number,
  code: string,
  reason: SetUserManagerRefusalReason,
  message: string,
): SetUserManagerResult {
  return { status, body: { success: false, error: { code, message, details: { reason } } } };
}

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Both spellings are read for each field, matching the sibling ObjectStack
 * mounts: the Console posts the camelCase one (`recordIdParam: 'userId'`) and
 * `unlock-user` has always also read the snake_case one.
 */
function readId(body: Record<string, unknown>, camel: string, snake: string): unknown {
  return body[camel] !== undefined ? body[camel] : body[snake];
}

const SYSTEM_READ_CTX = { isSystem: true, positions: [], permissions: [] } as const;

async function findUser(
  engine: SetUserManagerEngine,
  userId: string,
): Promise<UserRow | null> {
  const rows = await engine.find('sys_user', {
    where: { id: userId },
    fields: ['id', 'manager_id', 'source'],
    limit: 1,
    context: SYSTEM_READ_CTX,
  });
  const row = Array.isArray(rows) ? (rows[0] as UserRow | undefined) : undefined;
  return row && row.id ? row : null;
}

/**
 * The organization ids an identity PROVABLY holds membership in. An empty
 * array means "no tenancy fact recorded", which is not the same as "member of
 * nothing" — see {@link screenCrossOrganization}.
 */
async function membershipOrgIds(
  deps: SetUserManagerDeps,
  engine: SetUserManagerEngine,
  userId: string,
): Promise<string[] | null> {
  try {
    const rows = await engine.find('sys_member', {
      where: { user_id: userId },
      fields: ['user_id', 'organization_id'],
      limit: 1000,
      context: SYSTEM_READ_CTX,
    });
    return (Array.isArray(rows) ? rows : [])
      .map((r) => String((r as { organization_id?: unknown })?.organization_id ?? ''))
      .filter(Boolean);
  } catch (e) {
    // Distinguishable by design: `null` is "the read did not happen", never an
    // invented empty membership list that would read as a negative tenancy
    // fact and refuse a legitimate link.
    deps.logger?.warn(
      'AuthPlugin set-user-manager: the cross-organization screen could not read sys_member, so '
        + 'the link was accepted without it. The routing-time screen still applies at approval '
        + 'time. Remedy: make the sys_member read succeed and re-apply the link to have it '
        + 'screened at the write.',
      { userId, error: e instanceof Error ? e.message : String(e) },
    );
    return null;
  }
}

/**
 * Is the proposed manager PROVABLY outside every organization the edited user
 * belongs to?
 *
 * "Provably" is the whole shape, and it is the routing-time screen's shape
 * deliberately: both identities must have tenancy facts recorded, and those
 * facts must be disjoint. Either side having none leaves the question
 * unanswered, and an unanswered question routes as before — a stack that
 * stamps organizations on requests but never materializes `sys_member` rows
 * would otherwise have every manager link refused at once, which is a bigger
 * behaviour change than the hole being closed.
 */
async function screenCrossOrganization(
  deps: SetUserManagerDeps,
  engine: SetUserManagerEngine,
  userId: string,
  managerId: string,
): Promise<{ outside: true; userOrgs: string[]; managerOrgs: string[] } | { outside: false }> {
  const userOrgs = await membershipOrgIds(deps, engine, userId);
  if (!userOrgs || userOrgs.length === 0) return { outside: false };
  const managerOrgs = await membershipOrgIds(deps, engine, managerId);
  if (!managerOrgs || managerOrgs.length === 0) return { outside: false };
  const shared = managerOrgs.some((o) => userOrgs.includes(o));
  if (shared) return { outside: false };
  return { outside: true, userOrgs, managerOrgs };
}

/**
 * Walk the proposed manager's own chain upward.
 *
 * Returns the ordered ancestor ids, or a verdict when the walk cannot end in
 * an acceptable link. The walk carries its own `seen` set, so a loop that
 * already exists upstream terminates the walk instead of hanging it, and is
 * reported as the data defect it is rather than being silently accepted.
 */
async function walkChain(
  engine: SetUserManagerEngine,
  managerId: string,
  userId: string,
): Promise<
  | { kind: 'ok'; links: number }
  | { kind: 'cycle'; closesOn: string }
  | { kind: 'existing_loop'; repeated: string }
  | { kind: 'too_deep' }
> {
  const seen = new Set<string>([managerId]);
  let cursor: string | null = managerId;
  // One link is the edge being written (userId -> managerId); each ancestor
  // above the proposed manager adds another.
  let links = 1;

  while (cursor) {
    const row: UserRow | null = await findUser(engine, cursor);
    const next: string = row?.manager_id ? String(row.manager_id) : '';
    if (!next) return { kind: 'ok', links };
    if (next === userId) return { kind: 'cycle', closesOn: next };
    if (seen.has(next)) return { kind: 'existing_loop', repeated: next };
    seen.add(next);
    links += 1;
    if (links > MAX_MANAGER_CHAIN_DEPTH) return { kind: 'too_deep' };
    cursor = next;
  }
  return { kind: 'ok', links };
}

/**
 * `POST /api/v1/auth/admin/set-user-manager` — the caller is ALREADY gated by
 * the mount's ADR-0068 platform-admin check, and `actor` is that judged admin.
 *
 * Body: `{ userId, managerId }`. `managerId: null` clears the link; the key
 * being ABSENT is refused rather than read as a clear, so a payload that
 * misspells it cannot silently unset an org chart.
 */
export async function runSetUserManager(
  deps: SetUserManagerDeps,
  actor: AdminActor,
  request: Request,
): Promise<SetUserManagerResult> {
  const body = await parseJson(request);

  const rawUserId = readId(body, 'userId', 'user_id');
  if (typeof rawUserId !== 'string' || rawUserId.length === 0) {
    return refuse(400, 'INVALID_REQUEST', 'invalid_body', 'userId is required');
  }
  const userId = rawUserId;

  const rawManagerId = readId(body, 'managerId', 'manager_id');
  if (rawManagerId === undefined) {
    return refuse(
      400,
      'INVALID_REQUEST',
      'invalid_body',
      'managerId is required — send null to clear the link, never omit the key',
    );
  }
  if (rawManagerId !== null && (typeof rawManagerId !== 'string' || rawManagerId.length === 0)) {
    return refuse(
      400,
      'INVALID_REQUEST',
      'invalid_body',
      'managerId must be a non-empty user id, or null to clear the link',
    );
  }
  const managerId: string | null = rawManagerId;

  const engine = deps.getDataEngine();
  if (!engine) {
    return refuse(
      503,
      'SERVICE_UNAVAILABLE',
      'engine_unavailable',
      'No data engine is wired, so the manager link cannot be written',
    );
  }

  const user = await findUser(engine, userId);
  if (!user) {
    return refuse(404, 'RESOURCE_NOT_FOUND', 'user_not_found', 'User not found');
  }

  // Refusal 5 — the directory owns this identity. Applied to the CLEAR as
  // well as the set: both are writes the next sync would overwrite.
  if (String(user.source ?? '') === 'idp_provisioned') {
    return refuse(
      403,
      'PERMISSION_DENIED',
      'idp_provisioned',
      "This identity is provisioned by an external directory (sys_user.source is 'idp_provisioned'), "
        + 'so its manager is maintained by that directory and a value written here would be '
        + 'reverted on the next sync. Set the manager in the directory instead.',
    );
  }

  if (managerId !== null) {
    // Refusal 1 — self-assignment.
    if (managerId === userId) {
      return refuse(
        400,
        'INVALID_FIELD',
        'self_assignment',
        'A user cannot be their own manager: an approval routed to the manager rung would resolve '
          + 'to the submitter, which is the approval this tier exists to prevent.',
      );
    }

    const manager = await findUser(engine, managerId);
    if (!manager) {
      return refuse(
        400,
        'INVALID_REFERENCE',
        'manager_not_found',
        'The proposed manager does not exist',
      );
    }

    // Refusal 4 — cross-organization.
    const screen = await screenCrossOrganization(deps, engine, userId, managerId);
    if (screen.outside) {
      return refuse(
        400,
        'INVALID_REFERENCE',
        'cross_organization',
        `The proposed manager holds membership in ${screen.managerOrgs.length} organization(s), `
          + `none of them an organization this user belongs to. Routing approvals to him would put `
          + `approval authority over the record outside its tenant. Grant him a membership in one `
          + `of this user's organizations, or pick a manager inside them.`,
      );
    }

    // Refusals 2 and 3 — cycle and depth, in one walk.
    const walk = await walkChain(engine, managerId, userId);
    if (walk.kind === 'cycle') {
      return refuse(
        409,
        'RESOURCE_CONFLICT',
        'cycle',
        'That link would close a loop in the reporting chain: this user already appears above the '
          + 'proposed manager, so the chain would never reach a top. Clear the intermediate link '
          + 'first, then set this one.',
      );
    }
    if (walk.kind === 'existing_loop') {
      return refuse(
        409,
        'RESOURCE_CONFLICT',
        'cycle',
        `The proposed manager's own reporting chain already contains a loop (it revisits user `
          + `'${walk.repeated}'), so attaching this user beneath it would produce a chain with no `
          + `top. Repair that loop first.`,
      );
    }
    if (walk.kind === 'too_deep') {
      return refuse(
        400,
        'VALUE_OUT_OF_RANGE',
        'max_depth_exceeded',
        `That link would make this user's reporting chain longer than the maximum of `
          + `${MAX_MANAGER_CHAIN_DEPTH} links. The hierarchy scopes that walk this chain are `
          + `bounded, so a longer chain is not resolved in full. Shorten the chain above the `
          + `proposed manager first.`,
      );
    }
  }

  // The write. `authSystemWriteContext()` builds both halves together:
  // `isSystem: true` is the AUTHORIZATION half that carries this past the
  // ADR-0092 identity write guard without any whitelist entry, and
  // `attributedUserId` is the ATTRIBUTION half, so the row records the admin
  // who made the change rather than the system.
  const context = await authSystemWriteContext();
  await engine.update('sys_user', { id: userId, manager_id: managerId }, { context });

  return {
    status: 200,
    body: { success: true, data: { userId, managerId, setBy: actor.id } },
  };
}
