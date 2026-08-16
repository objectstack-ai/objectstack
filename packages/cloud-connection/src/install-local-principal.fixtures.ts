// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8976] The capable-operator principal every install-local fixture needs.
 *
 * ## Why this file exists
 *
 * Before #8976 the four mutating install-local routes admitted anyone with a
 * session, so a fixture that wanted to exercise install BEHAVIOUR only had to
 * hand the plugin an `auth` service that answered `getSession`. The routes now
 * demand ADR-0066 D1's `manage_metadata` authoring capability, resolved through
 * `resolveAuthzContext` — the platform's single authorization resolver — which
 * reads the caller's grants out of `sys_user_permission_set` /
 * `sys_permission_set` via the `objectql` service.
 *
 * So "a legitimate installer" is no longer expressible as a session alone, and
 * every fixture whose subject is something OTHER than authorization (bundle
 * normalization, the D5e ceremony, seeding, storage paths, healing…) needs its
 * principal upgraded from "logged in" to "logged in and allowed". This module is
 * that upgrade, in one place, so the grant shape cannot drift file by file.
 *
 * ## Deliberately real rows, not a short-circuit
 *
 * `installerGrantRows` returns actual permission-set rows rather than a
 * pre-computed capability list, and the fixtures serve them through the same
 * `find` the resolver calls in production. A fixture that instead stubbed the
 * capability directly would keep passing if the gate were rewired to read some
 * other aggregate — which is exactly the kind of green-over-nothing this card
 * was filed about.
 *
 * ⚠️ This is a fixture for suites that are NOT about authorization. The suite
 * that IS about authorization —
 * `marketplace-install-local-capability-enumeration.test.ts` — builds its own
 * principals, including the refused ones, on purpose: a shared "make me
 * allowed" helper has no business being in the file whose whole job is to prove
 * that some callers are not.
 */

/** The default fixture user id — matches what the suites already asserted on. */
export const INSTALLER_USER_ID = 'admin';

/**
 * The `sys_*` rows that make `userId` a holder of `manage_metadata`, shaped the
 * way `resolveAuthzContext` reads them (an UNSCOPED `sys_user_permission_set`
 * grant pointing at a `sys_permission_set` whose `system_permissions` carry the
 * capability — the shipped `admin_full_access` shape).
 */
export function installerGrantRows(userId: string = INSTALLER_USER_ID): Record<string, unknown[]> {
    return {
        sys_user: [{ id: userId, email: `${userId}@objectstack.test` }],
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [
            { id: 'ups_installer', user_id: userId, permission_set_id: 'ps_installer', organization_id: null },
        ],
        sys_permission_set: [
            {
                id: 'ps_installer',
                name: 'admin_full_access',
                system_permissions: ['manage_metadata', 'studio.access', 'setup.access'],
            },
        ],
    };
}

/** The `auth` service shape the plugin resolves a session through. */
export function installerAuthService(userId: string = INSTALLER_USER_ID) {
    return { api: { getSession: async () => ({ user: { id: userId }, session: {} }) } };
}

/**
 * Wrap an existing `objectql` fake so the authorization tables answer from
 * {@link installerGrantRows} and EVERY other object falls through to whatever
 * the suite already wired.
 *
 * Wrapping rather than replacing is the point: these suites' engines carry
 * behaviour their own assertions depend on (seed lookups, ledger probes,
 * registry reads), and an authorization fixture that quietly took those over
 * would break the suites it is meant to leave alone. An engine with no `find`
 * at all gets one that answers only the grant tables.
 */
export function withInstallerGrants<T extends Record<string, any>>(
    engine: T,
    userId: string = INSTALLER_USER_ID,
): T {
    const rows = installerGrantRows(userId);
    const inner = typeof engine?.find === 'function' ? engine.find.bind(engine) : undefined;
    return {
        ...engine,
        find: async (object: string, options?: unknown) => {
            if (Object.prototype.hasOwnProperty.call(rows, object)) return rows[object];
            return inner ? inner(object, options) : [];
        },
    } as T;
}
