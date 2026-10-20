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

import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';

/** The default fixture user id — matches what the suites already asserted on. */
export const INSTALLER_USER_ID = 'admin';

/**
 * [ADR-0131 D3/D4] The installer's set as the security catalog declares it —
 * the resolver reads a set's body from its definition, never from the row.
 */
export const INSTALLER_SET = { name: 'admin_full_access', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] };

/**
 * [ADR-0131 D5] The Default Organization the installer's grant is owned by —
 * the organization `resolveAuthzContext` names by `slug = 'default'`. Only the
 * `admin_full_access` grant that organization owns anchors platform standing,
 * and an anchoring grant applies whatever organization the request acts in
 * (none included), so these fixtures stay independent of the active tenant.
 */
export const INSTALLER_ORGANIZATION = { id: 'org_default', slug: 'default' };

/**
 * The `sys_*` rows that make `userId` a holder of `manage_metadata`, shaped the
 * way `resolveAuthzContext` reads them (a `sys_user_permission_set` grant owned
 * by {@link INSTALLER_ORGANIZATION}, pointing at a `sys_permission_set` whose
 * `system_permissions` carry the capability — the shipped `admin_full_access`
 * shape the first-user promotion writes). An organization-less grant would
 * apply nowhere and anchor nothing.
 *
 * `sys_organization` is deliberately NOT among them: suites wire their own
 * organizations. {@link answerDefaultOrganizationRead} supplies the Default
 * Organization only where the suite's engine names none.
 */
export function installerGrantRows(userId: string = INSTALLER_USER_ID): Record<string, unknown[]> {
    return {
        sys_user: [{ id: userId, email: `${userId}@objectstack.test` }],
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_metadata_activation: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [
            { id: 'ups_installer', user_id: userId, permission_set_id: 'ps_installer', permission_set: 'admin_full_access', organization_id: INSTALLER_ORGANIZATION.id },
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

/**
 * The resolver's Default Organization read — `sys_organization` where
 * `{ slug: 'default' }` — answered with {@link INSTALLER_ORGANIZATION} when the
 * suite's own engine answered it with nothing. `undefined` for every other read
 * (and for a suite that does hold a `default` organization), so a suite's own
 * `sys_organization` rows and probes are never overridden.
 */
export function answerDefaultOrganizationRead(object: string, options: unknown, innerRows: unknown): unknown[] | undefined {
    if (object !== 'sys_organization') return undefined;
    const where = (options as { where?: Record<string, unknown> } | undefined)?.where;
    if (!where || Object.keys(where).length !== 1 || where.slug !== 'default') return undefined;
    const rows = innerRows && (innerRows as { value?: unknown }).value !== undefined ? (innerRows as { value: unknown }).value : innerRows;
    if (Array.isArray(rows) && rows.length > 0) return undefined;
    return [{ ...INSTALLER_ORGANIZATION }];
}

/** The `auth` service shape the plugin resolves a session through. */
export function installerAuthService(userId: string = INSTALLER_USER_ID) {
    return { api: { getSession: async () => ({ user: { id: userId }, session: {} }) } };
}

/**
 * Wrap an existing `objectql` fake so the authorization tables answer from
 * {@link installerGrantRows}, the resolver's Default Organization read answers
 * {@link INSTALLER_ORGANIZATION} when the suite names none
 * ({@link answerDefaultOrganizationRead}), and EVERY other object falls through
 * to whatever the suite already wired.
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
    const wrapped = {
        ...engine,
        find: async (object: string, options?: unknown) => {
            if (Object.prototype.hasOwnProperty.call(rows, object)) return rows[object];
            const answered = inner ? await inner(object, options) : [];
            return answerDefaultOrganizationRead(object, options, answered) ?? answered;
        },
    } as T;
    // What the security plugin binds to a real engine: the catalog the
    // installer's grant names its set in.
    bindSecurityCatalogReader(wrapped, createSecurityCatalogReader({
        registry: {
            getItem: (type, name) => (type === 'permission' && name === INSTALLER_SET.name ? INSTALLER_SET : undefined),
            listItems: (type) => (type === 'permission' ? [INSTALLER_SET] : []),
            isPackageDisabled: () => false,
        },
        metadata: { get: () => undefined, list: () => [] },
    }));
    return wrapped;
}
