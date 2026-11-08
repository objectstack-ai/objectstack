// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SCIM group → permission-set projection: what an identity provider's
 * group membership grants on this deployment (ADR-0134 D4's group seam,
 * filled for ordinary permission sets only).
 *
 * ## The vendor seam
 *
 * `@better-auth/scim` (1.7.12) calls `scim({ projection })` on every user
 * mutation and every group membership change, inside the SCIM transaction:
 *
 * - `roles.map` turns one (connection, group) into opaque role slugs. Here a
 *   slug is the id of a `sys_idp_group_mapping` row whose source is that
 *   connection and whose group key matches the group: its `group_external_id`
 *   against the group's `externalId` when the row names one, else its
 *   `group_display_name` against the group's `displayName`. An unmapped group
 *   maps to nothing and grants nothing.
 * - `roles.exists` confirms a slug still names a mapping row of that
 *   connection whose set is still inside the organization boundary. A set
 *   whose definition grew an administrator bit after the mapping was saved is
 *   not granted (said once, at `warn`): an identity provider's group never
 *   confers administrator standing.
 * - `reconcileUser` receives the user's COMPLETE desired grant set and makes
 *   `sys_user_permission_set` agree with it, idempotently.
 *
 * ## Which grants are the projection's
 *
 * A grant the projection writes carries `reason` = {@link scimGroupProjectionReason}
 * for its provisioning domain, the same way the organization-admin reconcile
 * marks its own (`auto-org-admin-grant.ts`). Reconcile removes only rows that
 * carry that exact marker, so a grant an administrator made by hand is never
 * touched, even when it names the same set. A desired set the user already
 * holds in that organization through any other row is not written again (the
 * grant table is unique on user, set and organization).
 *
 * ## Why the engine and not `context.database`
 *
 * The vendor's transaction adapter cannot address `sys_user_permission_set`
 * (BetterAuthError "Model not found in schema", which turned every SCIM write
 * into a 500 when tried). The ObjectQL engine can, and its writes join the SCIM
 * request's engine transaction (`objectql-adapter.ts`, `scimRequestScope`), so
 * a refused grant rolls the whole SCIM mutation back. Writes run as the system
 * with the SCIM connection as actor (`authSystemWriteContext()`, so the audit
 * row says `svc:scim:CONNECTION_ID`), and an engine refusal is rethrown as the
 * vendor's `APIError` with its own status (`withValidationErrorMapping`): the
 * vendor passes an `APIError` through to the identity provider and turns any
 * other throw into a SCIM 500, which an IdP retries forever.
 */

import type { IDataEngine } from '@objectstack/core';
import type { SCIMProjection, SCIMProjectedUserState } from '@better-auth/scim';
import { withSystemContext, withValidationErrorMapping } from './objectql-adapter.js';

/** The mapping object the projection reads (platform-objects/identity). */
export const IDP_GROUP_MAPPING_OBJECT = 'sys_idp_group_mapping';

/** The grant table the projection writes (plugin-security). */
const GRANT_OBJECT = 'sys_user_permission_set';

/** The `source_kind` of a mapping row pushed by a SCIM connection. */
export const SCIM_MAPPING_SOURCE_KIND = 'scim';

/** The machine prefix of every grant the projection writes. */
export const SCIM_GROUP_PROJECTION_REASON_PREFIX = 'scim-group-projection';

/** The `reason` a projected grant carries: the marker plus the provisioning domain it was projected for. */
export function scimGroupProjectionReason(provisioningDomainId: string): string {
  return `${SCIM_GROUP_PROJECTION_REASON_PREFIX}: provisioning domain '${provisioningDomainId}'`;
}

/** The security service member that judges a set against the organization boundary. */
export interface OrganizationBoundaryJudge {
  organizationBoundaryFailure(setName: string): Promise<string | null>;
}

export interface ScimGroupProjectionDeps {
  getEngine: () => IDataEngine | null | undefined;
  /** Resolved per call: the security plugin starts after this one. */
  boundary: () => Promise<OrganizationBoundaryJudge | undefined>;
  warn: (message: string) => void;
}

interface MappingRow {
  id?: unknown;
  source_id?: unknown;
  group_external_id?: unknown;
  group_display_name?: unknown;
  permission_set?: unknown;
  organization_id?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

async function rowsOf(result: unknown): Promise<Record<string, unknown>[]> {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

/** The mapping rows of one SCIM connection. */
async function connectionMappings(engine: IDataEngine, connectionId: string): Promise<MappingRow[]> {
  if (!registered(engine, IDP_GROUP_MAPPING_OBJECT)) return [];
  return rowsOf(
    await withSystemContext(engine).find(IDP_GROUP_MAPPING_OBJECT, {
      where: { source_kind: SCIM_MAPPING_SOURCE_KIND, source_id: connectionId },
    }),
  );
}

/** Does mapping `row` name `group`? By external id when the row names one, else by display name. */
export function mappingMatchesGroup(row: MappingRow, group: { externalId?: string; displayName: string }): boolean {
  const externalId = text(row.group_external_id);
  if (externalId) return externalId === (group.externalId ?? '');
  const displayName = text(row.group_display_name);
  return displayName !== '' && displayName === group.displayName;
}

/** Build the `projection` member of `scim({ … })`. */
export function createScimGroupProjection(deps: ScimGroupProjectionDeps): SCIMProjection {
  const warned = new Set<string>();
  const engineOrThrow = (): IDataEngine => {
    const engine = deps.getEngine();
    if (!engine) throw new Error('[auth] SCIM group projection: no data engine to read mappings or write grants through');
    return engine;
  };

  return {
    roles: {
      async map(input) {
        const rows = await connectionMappings(engineOrThrow(), input.connectionId);
        return rows.filter((row) => mappingMatchesGroup(row, input.source)).map((row) => text(row.id));
      },
      async exists(input) {
        const rows = await connectionMappings(engineOrThrow(), input.connectionId);
        const row = rows.find((r) => text(r.id) === input.role);
        if (!row) return false;
        const set = text(row.permission_set);
        const judge = await deps.boundary();
        const failure = judge
          ? await judge.organizationBoundaryFailure(set)
          : 'the security service is not composed, so no set can be shown to be inside the organization boundary';
        if (failure === null) return true;
        if (!warned.has(input.role)) {
          warned.add(input.role);
          deps.warn(
            `[auth] SCIM group mapping ${input.role} (connection '${input.connectionId}') grants nothing: ${failure}. `
              + 'An identity provider group never grants administrator standing. Delete the mapping, or map an '
              + 'ordinary permission set.',
          );
        }
        return false;
      },
    },
    reconcileUser: (state) => reconcileProjectedGrants(engineOrThrow(), state),
  };
}

/**
 * Make the user's projected grants for this provisioning domain equal the
 * vendor's desired set. Reads first, then inserts, then deletes; every write
 * joins the SCIM request's transaction.
 */
export async function reconcileProjectedGrants(engine: IDataEngine, state: SCIMProjectedUserState): Promise<void> {
  const reason = scimGroupProjectionReason(state.provisioningDomainId);
  const mappingIds = [...new Set(state.grants.map((grant) => grant.role))];
  const grantTable = registered(engine, GRANT_OBJECT);
  if (!grantTable) {
    if (mappingIds.length === 0) return; // nothing desired, nothing of ours can exist
    throw new Error(`[auth] SCIM group projection: ${GRANT_OBJECT} is not registered, so mapped permission sets cannot be granted`);
  }
  const reader = withSystemContext(engine);
  const writer = withValidationErrorMapping(withSystemContext(engine) as unknown as Record<string, any>) as unknown as IDataEngine;

  const key = (set: string, org: string) => `${set}\u0000${org}`;
  const desired = new Map<string, { set: string; org: string }>();
  if (mappingIds.length > 0) {
    const mappings = await rowsOf(await reader.find(IDP_GROUP_MAPPING_OBJECT, { where: { id: { $in: mappingIds } } }));
    for (const row of mappings as MappingRow[]) {
      const set = text(row.permission_set);
      const org = text(row.organization_id);
      if (set) desired.set(key(set, org), { set, org });
    }
  }

  const held = await rowsOf(
    await reader.find(GRANT_OBJECT, {
      where: { user_id: state.userId },
      fields: ['id', 'permission_set', 'organization_id', 'reason'],
    }),
  );
  const heldKeys = new Set(held.map((row) => key(text(row.permission_set), text(row.organization_id))));

  for (const [k, { set, org }] of desired) {
    if (heldKeys.has(k)) continue;
    await writer.insert(GRANT_OBJECT, {
      user_id: state.userId,
      permission_set: set,
      ...(org ? { organization_id: org } : {}),
      reason,
    });
  }
  for (const row of held) {
    if (text(row.reason) !== reason) continue;
    if (desired.has(key(text(row.permission_set), text(row.organization_id)))) continue;
    await writer.delete(GRANT_OBJECT, { where: { id: text(row.id) } });
  }
}
