// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12160] ADR-0126 §5 — WRITE AUTHORITY for the packaged-ACTION activation
// switch, `POST /actions/_activation/:object/:action`, plus the door's own
// contract (shape, body, existence, ambiguity, durability).
//
// ## The rule, and why it is posture-conditional
//
// The row this route writes is INSTALL-LEVEL (`organization_id NULL`): one row,
// one environment, every tenant. So the authority it demands scales with how
// far that reach goes:
//
//   - `single`   — one logical tenant, so install-level and org-level are the
//                  SAME scope. The org admin who already passed the
//                  `manage_metadata` gate is the right authority.
//   - `group` /
//     `isolated` — a real multi-organization deployment, where the switch
//                  crosses tenants. The platform OPERATOR is required.
//
// This is the flow leg's matrix (#12157), run against the action door, because
// ADR-0126 §8 item 2 puts actions under the SAME §5 authority — and since
// 2026-08-25 both doors run ONE gate implementation (`./activation-gate.ts`).
// Testing it per door is what proves each door actually calls it: a shared
// helper nobody invokes is the same hole as no helper at all.
//
// ## What the refusal cases assert
//
// `status` AND `code` (the ADR-0112 envelope), AND that the engine's
// `setActionActive` was never entered — a gate that refused after the ledger
// was written would still be #10243, with persistence.

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const OBJECT = 'crm_lead';
const ACTION = 'convert_lead';
const DECLARATION = { name: ACTION, label: 'Convert Lead', objectName: OBJECT, type: 'script', _packageId: 'crm' };

interface Harness {
    dispatcher: HttpDispatcher;
    setActionActive: ReturnType<typeof vi.fn>;
    executeAction: ReturnType<typeof vi.fn>;
}

/**
 * A dispatcher whose `tenancy` service reports the given posture.
 *
 * `posture: null` is a deployment with NO tenancy service — the shape
 * `resolve-execution-context.ts` resolves to "no posture-conditional refusal",
 * and (ADR-0093 D4/D5) the same deployment shape as `single`.
 */
function boot(
    posture: 'single' | 'group' | 'isolated' | null,
    opts: { extraObjects?: any[]; setActionActive?: ReturnType<typeof vi.fn>; omitLedger?: boolean } = {},
): Harness {
    const setActionActive = opts.setActionActive ?? vi.fn(async () => undefined);
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const objectDef = { name: OBJECT, actions: [DECLARATION], _packageId: 'crm' };
    const objects = [objectDef, ...(opts.extraObjects ?? [])];

    const ql: any = {
        executeAction,
        getSchema: (name: string) => objects.find((o) => o.name === name),
        registry: { getObject: (name: string) => objects.find((o) => o.name === name), getItem: () => undefined },
        isActionEnabled: () => true,
        describeDisabledAction: (n: string) => `Action '${n}' is disabled`,
        find: vi.fn(async () => []), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    if (!opts.omitLedger) ql.setActionActive = setActionActive;

    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => objects),
        getObject: vi.fn(async () => objectDef),
    };

    const services: Record<string, unknown> = { objectql: ql, data: ql, metadata };
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };

    return { dispatcher: new HttpDispatcher(kernel as never), setActionActive, executeAction };
}

/**
 * A tenant org admin who DOES hold `manage_metadata` — so the capability tier
 * passes and the §5 gate is the only thing left. That is the whole point: the
 * two gates ask different questions, and this must not pass merely because the
 * other one refused.
 */
const TENANT_ADMIN = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        organizationId: 'org_northwind',
    },
} as unknown as HttpProtocolContext);

/** The same admin WITHOUT the authoring capability — the first tier's subject. */
const PLAIN_MEMBER = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_member', positions: ['org_member'], systemPermissions: [] },
} as unknown as HttpProtocolContext);

/** The platform operator (ADR-0068 D2: `platform_admin`, NOT a tenant role). */
const PLATFORM_OPERATOR = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_saas_operator',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        organizationId: null,
    },
} as unknown as HttpProtocolContext);

/** Engine self-invocation — never settable from the wire. */
const SYSTEM = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'usr_system', isSystem: true },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;
const messageOf = (r: any): string => String(r?.response?.body?.error?.message ?? '');

const flip = (h: Harness, ctx: HttpProtocolContext, enabled = false, path = `/_activation/${OBJECT}/${ACTION}`) =>
    h.dispatcher.handleActions(path, 'POST', { enabled }, ctx);

describe('ADR-0126 §5 — the action activation write is operator-gated in walled postures', () => {
    describe('`single` posture — the org admin suffices', () => {
        it('a tenant admin with `manage_metadata` may flip the switch', async () => {
            const h = boot('single');

            const res = await flip(h, TENANT_ADMIN());

            expect(statusOf(res)).toBe(200);
            expect(h.setActionActive).toHaveBeenCalledWith({ name: ACTION, packageId: 'crm', active: false });
        });

        it('so may the platform operator', async () => {
            const h = boot('single');

            expect(statusOf(await flip(h, PLATFORM_OPERATOR()))).toBe(200);
            expect(h.setActionActive).toHaveBeenCalled();
        });

        it('no tenancy service at all behaves like `single` (ADR-0093 D4/D5)', async () => {
            const h = boot(null);

            // Refusing here would lock every single-tenant operator out of
            // their own switch, and an unenforceable wall resolves to `single`.
            expect(statusOf(await flip(h, TENANT_ADMIN()))).toBe(200);
            expect(h.setActionActive).toHaveBeenCalled();
        });

        it('REFUSES a caller without `manage_metadata`, in every posture', async () => {
            const h = boot('single');

            const res = await flip(h, PLAIN_MEMBER());

            expect(statusOf(res)).toBe(403);
            expect(codeOf(res)).toBe('PERMISSION_DENIED');
            expect(messageOf(res)).toContain('manage_metadata');
            expect(h.setActionActive).not.toHaveBeenCalled();
        });
    });

    for (const posture of ['group', 'isolated'] as const) {
        describe(`\`${posture}\` posture — the install-wide switch needs the operator`, () => {
            it('REFUSES a tenant org admin, loudly, and never writes the row', async () => {
                const h = boot(posture);

                const res = await flip(h, TENANT_ADMIN());

                expect(statusOf(res)).toBe(403);
                expect(codeOf(res)).toBe('PERMISSION_DENIED');
                // The load-bearing assertion: refused BEFORE the write.
                expect(h.setActionActive).not.toHaveBeenCalled();
            });

            it('the refusal names the posture, the reason, and what the caller CAN do', async () => {
                const h = boot(posture);

                const message = messageOf(await flip(h, TENANT_ADMIN()));

                expect(message).toContain(posture);
                expect(message).toContain('INSTALL-WIDE');
                expect(message).toContain('ADR-0126 §5');
                // ⛔ NOT the flow leg's remedy. Action-clone is unchartered
                // (§8 item 2), so this refusal points at the operator and at
                // authoring a sibling action — never at a clone door that does
                // not exist.
                expect(message).not.toMatch(/clone/i);
                expect(message).toMatch(/platform operator/i);
                // #7450 — a denial says nothing about the caller's own
                // positions or permission-set names.
                expect(message).not.toContain('org_owner');
                expect(message).not.toContain('organization_admin');
            });

            it('ALLOWS the platform operator', async () => {
                const h = boot(posture);

                expect(statusOf(await flip(h, PLATFORM_OPERATOR()))).toBe(200);
                expect(h.setActionActive).toHaveBeenCalled();
            });

            it('ALLOWS engine self-invocation', async () => {
                const h = boot(posture);

                expect(statusOf(await flip(h, SYSTEM()))).toBe(200);
                expect(h.setActionActive).toHaveBeenCalled();
            });

            it('gates ENABLE as well as disable — the switch is install-wide in both directions', async () => {
                const h = boot(posture);

                const res = await flip(h, TENANT_ADMIN(), true);

                expect(statusOf(res)).toBe(403);
                expect(h.setActionActive).not.toHaveBeenCalled();
            });

            it('does NOT gate ordinary invocation — this is an activation gate, not an execution one', async () => {
                const h = boot(posture);

                const res = await h.dispatcher.handleActions(`/${OBJECT}/${ACTION}`, 'POST', {}, TENANT_ADMIN());

                // Sweeping a run surface into a metadata gate would lock every
                // ordinary user out of the actions built for them — the one
                // thing the #10243 ruling did not do.
                expect(statusOf(res)).toBe(200);
                expect(h.executeAction).toHaveBeenCalled();
            });
        });
    }
});

describe('the activation door\'s own contract', () => {
    it('`_activation` cannot be read as an invocation — it is not a legal machine name', async () => {
        const h = boot('single');

        // Two segments would be `/:object/:action` on any other path. Machine
        // names are `^[a-z][a-z0-9_]*$`, so `_activation` can never BE an
        // object; the door owns the whole prefix and says what shape it wants.
        const res = await h.dispatcher.handleActions('/_activation/convert_lead', 'POST', {}, TENANT_ADMIN());

        expect(statusOf(res)).toBe(400);
        expect(messageOf(res)).toContain('/actions/_activation/:object/:action');
        expect(h.executeAction).not.toHaveBeenCalled();
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('a deeper path under `_activation` is still GATED, not silently invoked', async () => {
        const h = boot('isolated');

        const res = await h.dispatcher.handleActions(
            `/_activation/${OBJECT}/${ACTION}/extra`, 'POST', { enabled: false }, TENANT_ADMIN(),
        );

        // A gate narrower than its route is a bypass: the predicate has no
        // depth bound, so this is refused by the §5 gate rather than reaching
        // the shape check as an ungated call.
        expect(statusOf(res)).toBe(403);
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('refuses an unknown key rather than silently inverting the caller\'s intent (#3899)', async () => {
        const h = boot('single');

        const res = await h.dispatcher.handleActions(
            `/_activation/${OBJECT}/${ACTION}`, 'POST', { enable: false }, TENANT_ADMIN(),
        );

        // `{"enable": false}` — one letter off — must not read as "enable it".
        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('refuses a non-boolean `enabled`', async () => {
        const h = boot('single');

        const res = await h.dispatcher.handleActions(
            `/_activation/${OBJECT}/${ACTION}`, 'POST', { enabled: 'false' }, TENANT_ADMIN(),
        );

        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('an empty body ENABLES — the documented legacy shape, same as the flow toggle', async () => {
        const h = boot('single');

        const res = await h.dispatcher.handleActions(`/_activation/${OBJECT}/${ACTION}`, 'POST', {}, TENANT_ADMIN());

        expect(statusOf(res)).toBe(200);
        expect(h.setActionActive).toHaveBeenCalledWith({ name: ACTION, packageId: 'crm', active: true });
    });

    it('an UNDECLARED action is 404, and writes no row', async () => {
        const h = boot('single');

        const res = await h.dispatcher.handleActions(
            `/_activation/${OBJECT}/no_such_action`, 'POST', { enabled: false }, TENANT_ADMIN(),
        );

        // A typo must not read as a server fault (the #7535 shape), and it must
        // certainly not mint a ledger row for an artifact that does not exist.
        expect(statusOf(res)).toBe(404);
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('REFUSES an ambiguous name instead of switching off artifacts the caller did not name', async () => {
        const twin = {
            name: 'crm_account',
            actions: [{ name: ACTION, label: 'Convert Lead', objectName: 'crm_account', type: 'script' }],
        };
        const h = boot('single', { extraObjects: [twin] });

        const res = await h.dispatcher.handleActions(
            `/_activation/${OBJECT}/${ACTION}`, 'POST', { enabled: false }, TENANT_ADMIN(),
        );

        expect(statusOf(res)).toBe(409);
        // The standard-catalog member for a state conflict — ⛔ no new code is
        // minted for a case the catalog already names.
        expect(codeOf(res)).toBe('RESOURCE_CONFLICT');
        expect(messageOf(res)).toContain('crm_account');
        expect(h.setActionActive).not.toHaveBeenCalled();
    });

    it('reports a write that could not be made durable, instead of a 200', async () => {
        const failing = vi.fn(async () => {
            throw Object.assign(new Error('no activation ledger is attached to this engine'), {
                code: 'SERVICE_UNAVAILABLE', status: 503,
            });
        });
        const h = boot('single', { setActionActive: failing });

        const res = await flip(h, TENANT_ADMIN());

        // Reporting a durable install-wide switch that never persisted is the
        // exact failure ADR-0126 §6 wall 3 exists to close.
        expect(statusOf(res)).toBe(503);
        expect(codeOf(res)).toBe('SERVICE_UNAVAILABLE');
    });

    it('says so plainly when the engine has no activation ledger at all', async () => {
        const h = boot('single', { omitLedger: true });

        const res = await flip(h, TENANT_ADMIN());

        expect(statusOf(res)).toBe(501);
        expect(messageOf(res)).toContain('ADR-0126 §8');
    });
});
