// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#15981] A `sys_user_position` row SPELLING `platform_admin` confers no
// operator authority on the ADR-0126 §5 activation gate.
//
// ## The defect this pins
//
// `refuseUngrantedActivationWrite` derived operator standing from a NAME:
//
//     const positions: string[] = Array.isArray(ec?.positions) ? ec.positions : [];
//     if (positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN)) return undefined;
//
// The gate's own doc block argued for reading the position on the grounds that
// it is "unscoped, sourced from the unscoped `admin_full_access` grant". That
// premise stopped holding when `positions[]` became the security axis: it now
// also carries ADR-0057 D4 `sys_user_position` names, and that table is
// `apiEnabled` with unconstrained `position` values. So a tenant could mint a
// row spelling the built-in name, `resolveUserAuthzGrants` §4 pushed it into
// `grants.positions`, and this gate opened.
//
// ⭐ WHAT THE ESCALATION BUYS, driven rather than argued: this gate is the ONLY
// thing standing between a tenant org admin and the install-wide activation
// row under a walled posture. It is #10243 exactly — a tenant org owner
// switching a shipped flow off ENVIRONMENT-WIDE — except that ADR-0126 made
// the row DURABLE, so the same leak now survives a cold boot. The arms below
// drive the real `POST /automation/:name/toggle` route and assert on whether
// `toggleFlow` was entered, which is the write itself.
//
// ## POPULATION OF THIS PIN — stated because a pin proves only what it covers
//
// Covers: the `group` and `isolated` (wall-enforcing) postures, on the
// automation toggle door, for a tenant org admin who already holds
// `manage_metadata` — so the tier-above gate passes and THIS gate is the only
// thing left. Three shapes: a D4 row spelling the built-in name with no
// capability grant (`name-only`), a genuine unscoped `admin_full_access` grant
// (`genuine`), and a plain tenant admin (`plain`, the floor). All three
// contexts are produced by inserting rows and resolving them through the REAL
// `resolveUserAuthzGrants`, so `positions` / `posture` come from the shipping
// resolver rather than being hand-asserted.
//
// Does NOT cover: the `single` posture (where the gate is inert by design and
// this change cannot reach it), the actions door (same gate, same call —
// covered by `action-activation-posture-gate.test.ts`'s own population), the
// `manage_metadata` tier above, or engine self-invocation. Those are other
// suites' populations and their passing is NOT evidence about this one.

import { describe, it, expect, vi } from 'vitest';
import { BUILTIN_IDENTITY_PLATFORM_ADMIN, ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { hasPlatformAdminStanding, resolveUserAuthzGrants } from '@objectstack/core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const FLOW = 'vendor_lead_router';
const DEFINITION = { name: FLOW, label: 'Vendor Lead Router', type: 'autolaunched', nodes: [], edges: [] };

const TENANT_ORG = 'org_northwind';
const ACTOR = 'usr_tenant_admin';
const PS_ADMIN = 'ps_admin_full_access';
const PS_METADATA = 'ps_metadata_author';

interface Harness {
    dispatcher: HttpDispatcher;
    toggleFlow: ReturnType<typeof vi.fn>;
}

/** A dispatcher whose `tenancy` service reports the given posture. */
function boot(posture: 'group' | 'isolated'): Harness {
    const toggleFlow = vi.fn(async () => undefined);
    const services: Record<string, unknown> = {
        automation: {
            handlerReady: true,
            toggleFlow,
            getFlow: vi.fn(async (name: string) => (name === FLOW ? DEFINITION : undefined)),
        },
        tenancy: { posture },
    };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), toggleFlow };
}

/**
 * A minimal ObjectQL double for the AUTHZ resolver — the shape (and the
 * top-level `$` refusal) of `resolve-authz-context.platform-admin-config.test.ts`.
 */
function makeAuthzQl(tables: Record<string, Array<Record<string, unknown>>>) {
    const matches = (row: Record<string, unknown>, where: any): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
            return row[k] === v;
        });
    return {
        async find(object: string, opts: any) {
            const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
    };
}

type Shape = 'name-only' | 'genuine' | 'plain';

function authzTables(shape: Shape) {
    const userSets: Array<Record<string, unknown>> = [
        // The ORG-scoped authoring capability every shape holds, so the
        // `manage_metadata` tier above always passes and this gate is the only
        // thing under test. Scoped to the org, never unscoped.
        { user_id: ACTOR, permission_set_id: PS_METADATA, organization_id: TENANT_ORG },
    ];
    if (shape === 'genuine') {
        userSets.push({ user_id: ACTOR, permission_set_id: PS_ADMIN, organization_id: null });
    }
    return {
        sys_user: [{ id: ACTOR, email: 'tenant-admin@example.com', email_verified: true }],
        sys_member: [{ organization_id: TENANT_ORG, user_id: ACTOR, role: 'owner' }],
        sys_user_position:
            shape === 'name-only'
                ? [
                      // Exactly what a tenant admin can write through the
                      // `apiEnabled` `sys_user_position` surface.
                      { user_id: ACTOR, position: BUILTIN_IDENTITY_PLATFORM_ADMIN, organization_id: null },
                  ]
                : [],
        // An ACTIVE catalogue row, so ADR-0049's deactivated-position filter is
        // not what carries the arm.
        sys_position:
            shape === 'name-only'
                ? [{ id: 'pos_pa', name: BUILTIN_IDENTITY_PLATFORM_ADMIN, label: 'Platform Admin', active: true }]
                : [],
        sys_position_permission_set: [],
        sys_user_permission_set: userSets,
        sys_permission_set: [
            { id: PS_METADATA, name: 'metadata_author', system_permissions: ['manage_metadata'], active: true },
            { id: PS_ADMIN, name: ADMIN_FULL_ACCESS, active: true },
        ],
    };
}

/** Resolve one principal through the REAL resolver into the protocol context. */
async function resolve(shape: Shape) {
    const ql = makeAuthzQl(authzTables(shape));
    const grants = await resolveUserAuthzGrants(ql as any, ACTOR, { tenantId: TENANT_ORG });
    const context = {
        request: {},
        executionContext: {
            userId: ACTOR,
            tenantId: TENANT_ORG,
            organizationId: TENANT_ORG,
            positions: grants.positions,
            permissions: grants.permissions,
            systemPermissions: grants.systemPermissions,
            ...(grants.posture ? { posture: grants.posture } : {}),
        },
    } as HttpProtocolContext;
    return { context, grants, rung: await hasPlatformAdminStanding(ql as any, ACTOR) };
}

const statusOf = (response: unknown): unknown => (response as any)?.status;
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};
const messageOf = (response: unknown): string => String((response as any)?.body?.error?.message ?? '');

const toggle = (h: Harness, ctx: HttpProtocolContext) =>
    h.dispatcher.handleAutomation(`/${FLOW}/toggle`, 'POST', { enabled: false }, ctx, undefined);

for (const posture of ['group', 'isolated'] as const) {
    describe(`[#15981] \`${posture}\` — a D4 row spelling \`platform_admin\` does NOT open the install-wide switch`, () => {
        it('the name IS in positions[] while the rung says TENANT_ADMIN — the premise, without which the rest is vacuous', async () => {
            const { context, grants, rung } = await resolve('name-only');
            const ec = (context as any).executionContext;

            expect(ec.positions, JSON.stringify(ec.positions)).toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
            expect(grants.posture).not.toBe('PLATFORM_ADMIN');
            expect(rung).toBe(false);
            // The tier above really does pass, so a refusal below is this
            // gate's and not `manage_metadata`'s.
            expect(ec.systemPermissions).toContain('manage_metadata');
        });

        it('THREE-WAY AGREEMENT — the name says yes; the site gate and the rung both say no, and agree', async () => {
            const { context, rung } = await resolve('name-only');
            const h = boot(posture);
            const ec = (context as any).executionContext;

            const nameRead = (ec.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
            const { response } = await toggle(h, context);
            const gate = statusOf(response) === 200;

            expect({ nameRead, gate, rung }).toEqual({ nameRead: true, gate: false, rung: false });
        });

        it('REFUSES 403 PERMISSION_DENIED and never enters toggleFlow', async () => {
            const { context } = await resolve('name-only');
            const h = boot(posture);

            const { response } = await toggle(h, context);

            expect(statusOf(response)).toBe(403);
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            // The load-bearing assertion: refused BEFORE the write. A gate that
            // wrote the install-wide row and then refused would satisfy the two
            // above and still be #10243.
            expect(h.toggleFlow).not.toHaveBeenCalled();
        });

        it('the refusal still says nothing about the caller’s own positions (#7450)', async () => {
            const { context } = await resolve('name-only');
            const h = boot(posture);

            const message = messageOf((await toggle(h, context)).response);

            expect(message).toContain(posture);
            expect(message).toContain('ADR-0126 §5');
            expect(message).not.toContain(BUILTIN_IDENTITY_PLATFORM_ADMIN);
            expect(message).not.toContain('org_owner');
        });

        it('answers the same as a PLAIN tenant admin — the minted row buys nothing', async () => {
            const nameOnly = await resolve('name-only');
            const plain = await resolve('plain');

            const hName = boot(posture);
            const hPlain = boot(posture);
            const viaName = statusOf((await toggle(hName, nameOnly.context)).response);
            const viaPlain = statusOf((await toggle(hPlain, plain.context)).response);

            // The floor: if this stops being 403, the comparison measures nothing.
            expect(viaPlain).toBe(403);
            expect(viaName).toBe(viaPlain);
            expect(hName.toggleFlow).not.toHaveBeenCalled();
        });

        it('CONTROL — a genuine unscoped admin_full_access grant still flips the switch', async () => {
            const { context, rung } = await resolve('genuine');
            const h = boot(posture);
            const ec = (context as any).executionContext;

            const nameRead = (ec.positions ?? []).includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
            const { response } = await toggle(h, context);

            expect({ nameRead, gate: statusOf(response) === 200, rung }).toEqual({
                nameRead: true, gate: true, rung: true,
            });
            expect(h.toggleFlow).toHaveBeenCalledWith(FLOW, false);
        });
    });
}
