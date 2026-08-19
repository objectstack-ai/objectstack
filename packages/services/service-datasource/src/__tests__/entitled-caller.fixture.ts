// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one definition of "an entitled datasource-admin caller", shared by every
 * suite in this package that drives the HTTP family.
 *
 * ## Why it is shared rather than copied
 *
 * The family's guard (#9391 authentication, #9593 capability) admits a caller
 * only when the platform's shared `resolveAuthzContext` resolves an identity
 * AND aggregates `manage_platform_settings` out of that identity's permission
 * sets. That is a four-table read, and three suites in this package need a
 * caller who survives it: the guard's own both-sides pin, which asserts the
 * refusals and the success, and two suites — routing/failure-attribution and
 * the envelope conformance — for which an entitled caller is the PREMISE, not
 * the subject.
 *
 * Copied into three files, that chain drifts: a later change to the resolver
 * would be met by three fixtures updated at three times, and the two premise
 * suites would start failing for a reason that has nothing to do with what they
 * measure. One definition, three importers.
 *
 * ## What it is NOT
 *
 * Not a bypass. Nothing here injects a permission list into the registrar —
 * `sessionResolver` is the same `auth`-service shape a real deployment
 * registers and `createGrantsEngine` answers the same `sys_*` reads the
 * resolver issues against a real store. A guard that stopped consulting the
 * platform's resolution would fail these fixtures, which is the property that
 * makes them worth having.
 */

import { DATASOURCE_ADMIN_CAPABILITY } from '../admin-routes.js';

/** The credential that resolves to a caller holding the capability. */
export const ENTITLED_CREDENTIAL = 'Bearer entitled-session';

/**
 * A second credential resolving to a real, authenticated identity that holds
 * NO capabilities — the posture this family used to serve in full, when
 * authentication was the whole gate.
 */
export const UNENTITLED_CREDENTIAL = 'Bearer unentitled-session';

/** The user ids the two credentials resolve to. */
export const ENTITLED_USER = 'u_entitled';
export const UNENTITLED_USER = 'u_plain';

/** The permission set that carries the grant. */
const GRANT_SET_ID = 'ps_datasource_operator';

/**
 * ⚠️ Deliberately NOT `admin_full_access`.
 *
 * That platform set carries `manage_platform_settings` among six other
 * capabilities, so granting it would leave a gate keyed on platform-admin
 * POSTURE — rather than on the capability — passing every suite here unchanged.
 * A single-capability set named for nothing in particular can only pass a guard
 * that reads the capability itself. It is also the honest shape: a deployment
 * is free to grant this capability to an operator who is not a full admin.
 */
const GRANT_SET_NAME = 'datasource_operator';

/**
 * The `auth` service double: a `getSession` over the two credentials above,
 * spelled on the legacy `api` member the contract still declares.
 */
export function createSessionAuthService() {
  const sessions: Record<string, string> = {
    [ENTITLED_CREDENTIAL]: ENTITLED_USER,
    [UNENTITLED_CREDENTIAL]: UNENTITLED_USER,
  };
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = sessions[headers?.get?.('authorization') ?? ''];
        return id ? { user: { id } } : null;
      },
    },
  };
}

/**
 * The RBAC tables `resolveAuthzContext` reads, as a minimal engine double.
 *
 * Only the two objects carrying the grant answer rows; every other read — the
 * memberships, positions and identity tables the resolver also consults —
 * returns empty, which is what a deployment with no orgs and no custom roles
 * really looks like. The rows carry no `active` flag and no validity window on
 * purpose: absent means active/unbounded by the resolver's own predicates
 * (`isRowActive` / `isGrantActive`), so these fixtures pin the CAPABILITY path
 * rather than a validity edge case that belongs to `@objectstack/core`'s suite.
 */
export function createGrantsEngine() {
  return {
    find: async (object: string, opts: any) => {
      if (object === 'sys_user_permission_set') {
        return opts?.where?.user_id === ENTITLED_USER
          ? [{
              id: 'ups_datasource_operator',
              user_id: ENTITLED_USER,
              permission_set_id: GRANT_SET_ID,
              // Unscoped (null org) — the grant is platform-scoped, matching
              // `manage_platform_settings`'s own `scope: 'platform'`.
              organization_id: null,
            }]
          : [];
      }
      if (object === 'sys_permission_set') {
        const ids: unknown = opts?.where?.id?.$in;
        return Array.isArray(ids) && ids.includes(GRANT_SET_ID)
          ? [{
              id: GRANT_SET_ID,
              name: GRANT_SET_NAME,
              // Stored as a JSON string — the spelling SQLite hands back, which
              // the resolver parses. Pinning the stored shape keeps the fixture
              // on the real read path rather than a convenient in-memory one.
              system_permissions: JSON.stringify([DATASOURCE_ADMIN_CAPABILITY]),
              object_permissions: '{}',
            }]
          : [];
      }
      return [];
    },
  };
}
