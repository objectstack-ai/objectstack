// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `external` organization role's two write-side invariants (ruling of
 * record 6355206139, letter B, stage 1).
 *
 * An `external` holder (a portal user: a supplier's or a customer's person) is
 * a member of the organization — it has a `sys_member` row — but it is a
 * separate population: it resolves `org_external` and not the `everyone`
 * anchor, so the deployment's member defaults never reach it
 * (`resolve-authz-context.ts`, `@objectstack/core`). Two things keep that
 * population well-formed at the write, for every writer (`isSystem` included:
 * better-auth's own adapter writes, an invitation's acceptance and SCIM group
 * remaps are all system contexts):
 *
 *  - **E5, exclusivity.** A role list carrying `external` together with any
 *    other role is refused, on `sys_member` and on `sys_invitation`. A mixed
 *    list would make one row both populations at once: `external` withholds the
 *    member baseline, `member` / `admin` confer it, and which one a reader
 *    honours would depend on the reader.
 *  - **E6, no placement.** An external is never placed in the organization's
 *    department tree (maintainer, 2026-10-23: 「不属于客户的部门组织架构，但是可以
 *    加入到客户的组织中」). So an external holder gets no
 *    `sys_business_unit_member` row and no `sys_user_position` row anchored at
 *    one of that organization's business units; an invitation conferring
 *    `external` carries no `business_unit_id`; and a membership does not
 *    become external while such a placement stands. An organization-wide
 *    position (no `business_unit_id`) is an explicit grant, not a placement,
 *    and stays admitted — it is how an external reaches application data.
 *
 * Both refusals are `400 VALIDATION_FAILED` with one `fields[]` entry, code
 * `invalid_value` (the closed ADR-0114 catalog), built by `validationFailure`.
 */

import { MEMBERSHIP_ROLE_EXTERNAL } from '@objectstack/spec';
import { SystemObjectName } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';

const MEMBER_OBJECT = SystemObjectName.MEMBER;
const INVITATION_OBJECT = SystemObjectName.INVITATION;
const BUSINESS_UNIT_OBJECT = 'sys_business_unit';
const BUSINESS_UNIT_MEMBER_OBJECT = 'sys_business_unit_member';
const POSITION_ASSIGNMENT_OBJECT = 'sys_user_position';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The distinct, trimmed, lower-cased tokens of a stored role list. */
function roleTokens(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Does this role list carry the `external` role at all? */
export function carriesExternalRole(raw: unknown): boolean {
  return roleTokens(raw).includes(MEMBERSHIP_ROLE_EXTERNAL);
}

/** Is this role list exactly `external` — the one admitted spelling of the population? */
export function isExternalMembershipRole(raw: unknown): boolean {
  const tokens = roleTokens(raw);
  return tokens.length === 1 && tokens[0] === MEMBERSHIP_ROLE_EXTERNAL;
}

function refuse(field: string, message: string): Error {
  return validationFailure(message, [{ field, code: 'invalid_value', message }]);
}

/** E5: refuse `external` beside any other role. */
export function assertExternalRoleExclusive(raw: unknown): void {
  if (carriesExternalRole(raw) && !isExternalMembershipRole(raw)) {
    throw refuse(
      'role',
      `The '${MEMBERSHIP_ROLE_EXTERNAL}' role cannot be combined with another role (got '${String(raw)}'). ` +
        `An external member holds '${MEMBERSHIP_ROLE_EXTERNAL}' alone; give an internal member the other roles instead.`,
    );
  }
}

/** The row a before-hook judges: the payload over the engine's pre-image on an update. */
function judgedRow(ctx: any): Record<string, unknown> | undefined {
  const data = ctx?.input?.data;
  if (!data || typeof data !== 'object') return undefined;
  const previous = ctx?.previous && typeof ctx.previous === 'object' ? ctx.previous : {};
  return { ...previous, ...data };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

async function rows(engine: any, object: string, where: Record<string, unknown>, limit?: number): Promise<any[]> {
  if (typeof engine?.getSchema === 'function' && !engine.getSchema(object)) return [];
  const found = await engine.find(object, { where, ...(limit ? { limit } : {}), context: SYSTEM_CTX });
  return Array.isArray(found) ? found : [];
}

/** Is `userId` an external member of `organizationId`? */
async function isExternalIn(engine: any, userId: string, organizationId: string): Promise<boolean> {
  const members = await rows(engine, MEMBER_OBJECT, { user_id: userId, organization_id: organizationId });
  return members.some((m) => isExternalMembershipRole(m?.role));
}

/** The organization a business unit belongs to. */
async function businessUnitOrganization(engine: any, businessUnitId: string): Promise<string | undefined> {
  const [unit] = await rows(engine, BUSINESS_UNIT_OBJECT, { id: businessUnitId }, 1);
  return str(unit?.organization_id);
}

/** Does `userId` stand placed in any business unit of `organizationId`? */
async function hasPlacementIn(engine: any, userId: string, organizationId: string): Promise<boolean> {
  const units = await rows(engine, BUSINESS_UNIT_OBJECT, { organization_id: organizationId });
  const unitIds = units.map((u) => str(u?.id)).filter((id): id is string => !!id);
  if (unitIds.length === 0) return false;
  const placed = await rows(engine, BUSINESS_UNIT_MEMBER_OBJECT, { user_id: userId, business_unit_id: { $in: unitIds } }, 1);
  if (placed.length > 0) return true;
  const anchored = await rows(engine, POSITION_ASSIGNMENT_OBJECT, { user_id: userId, business_unit_id: { $in: unitIds } }, 1);
  return anchored.length > 0;
}

const placementRefusal = (field: string) =>
  refuse(
    field,
    `An external member is not placed in the organization's business units. ` +
      `Grant it access with an organization-wide position or a permission set instead.`,
  );

export interface ExternalMembershipGuardOptions {
  packageId: string;
}

/**
 * Register the E5 / E6 refusals on an ObjectQL engine. Priority 6: right after
 * the `sys_member.role` canonicalisation (5), so the judgement reads the
 * value's normal form, and ahead of the identity write guard (10) and the
 * last-admin guard (20).
 */
export function registerExternalMembershipGuard(engine: any, opts: ExternalMembershipGuardOptions): void {
  const { packageId } = opts;
  const on = (object: string, handler: (ctx: any) => Promise<void>) => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      engine.registerHook(event, handler, { object, priority: 6, packageId });
    }
  };

  on(MEMBER_OBJECT, async (ctx) => {
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'role')) return;
    assertExternalRoleExclusive(data.role);
    if (!isExternalMembershipRole(data.role)) return;
    const row = judgedRow(ctx)!;
    const userId = str(row.user_id);
    const organizationId = str(row.organization_id);
    if (userId && organizationId && (await hasPlacementIn(engine, userId, organizationId))) {
      throw placementRefusal('role');
    }
  });

  on(INVITATION_OBJECT, async (ctx) => {
    const row = judgedRow(ctx);
    if (!row) return;
    assertExternalRoleExclusive(row.role);
    if (isExternalMembershipRole(row.role) && str(row.business_unit_id)) {
      throw placementRefusal('business_unit_id');
    }
  });

  on(BUSINESS_UNIT_MEMBER_OBJECT, async (ctx) => {
    const row = judgedRow(ctx);
    const userId = str(row?.user_id);
    const businessUnitId = str(row?.business_unit_id);
    if (!userId || !businessUnitId) return;
    const organizationId = await businessUnitOrganization(engine, businessUnitId);
    if (organizationId && (await isExternalIn(engine, userId, organizationId))) {
      throw placementRefusal('user_id');
    }
  });

  on(POSITION_ASSIGNMENT_OBJECT, async (ctx) => {
    const row = judgedRow(ctx);
    const userId = str(row?.user_id);
    const businessUnitId = str(row?.business_unit_id);
    if (!userId || !businessUnitId) return;
    const organizationId = await businessUnitOrganization(engine, businessUnitId);
    if (organizationId && (await isExternalIn(engine, userId, organizationId))) {
      throw placementRefusal('business_unit_id');
    }
  });
}
