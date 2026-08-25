// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12157] ADR-0126 §5 — WRITE AUTHORITY for the packaged-flow activation
// switch, `POST /automation/:name/toggle`.
//
// ## The rule, and why it is posture-conditional
//
// The row this route writes is INSTALL-LEVEL (`organization_id NULL`): one
// row, one environment, every tenant. So the authority it demands scales with
// how far that reach goes:
//
//   - `single`   — one logical tenant, so install-level and org-level are the
//                  SAME scope. The org admin who already passed the #10145
//                  `manage_metadata` gate is the right authority.
//   - `group` /
//     `isolated` — a real multi-organization deployment, where the switch
//                  crosses tenants. The platform OPERATOR is required.
//
// ## What this is made durable against
//
// #10243, measured over HTTP: on a real `isolated` posture a tenant org owner
// switched a shipped flow off through this very route and an unrelated tenant
// in a DIFFERENT organization read it off — environment-wide reach from a
// tenant caller. That leak went through a PROCESS-LOCAL map, so a cold boot
// undid it ("mitigating but not exculpating"). ADR-0126 makes the switch
// DURABLE, which removes that accidental limit — so a tenant-writable
// install-wide row would be the same leak WITH persistence, i.e. strictly
// worse than what was measured. This gate is what stops that.
//
// ## What the refusal cases assert
//
// `status` AND `code` (the ADR-0112 envelope), AND that `toggleFlow` was never
// entered — a gate that refused after the ledger was already written would
// still be the defect and would still satisfy a status-only assertion.

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const FLOW = 'vendor_lead_router';
const DEFINITION = { name: FLOW, label: 'Vendor Lead Router', type: 'autolaunched', nodes: [], edges: [] };

interface Harness {
    dispatcher: HttpDispatcher;
    toggleFlow: ReturnType<typeof vi.fn>;
}

/**
 * A dispatcher whose `tenancy` service reports the given posture.
 *
 * `posture: null` is a deployment with NO tenancy service — the shape
 * `resolve-execution-context.ts` resolves to "no posture-conditional refusal",
 * and (ADR-0093 D4/D5) the same deployment shape as `single`.
 */
function boot(posture: 'single' | 'group' | 'isolated' | null): Harness {
    const toggleFlow = vi.fn(async () => undefined);

    const services: Record<string, unknown> = {
        automation: {
            handlerReady: true,
            toggleFlow,
            getFlow: vi.fn(async (name: string) => (name === FLOW ? DEFINITION : undefined)),
        },
    };
    if (posture) services.tenancy = { posture };

    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };

    return { dispatcher: new HttpDispatcher(kernel as never), toggleFlow };
}

/**
 * A tenant org admin who DOES hold `manage_metadata` — so the #10145 gate one
 * tier up passes and this gate is the only thing left. That is the whole point:
 * the two gates ask different questions, and this test must not pass merely
 * because the other one refused.
 */
const TENANT_ADMIN = (): HttpProtocolContext => ({
    request: {},
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        organizationId: 'org_northwind',
    },
} as HttpProtocolContext);

/** The platform operator (ADR-0068 D2: `platform_admin`, NOT a tenant role). */
const PLATFORM_OPERATOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: {
        userId: 'u_saas_operator',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        organizationId: null,
    },
} as HttpProtocolContext);

/** Engine self-invocation — never settable from the wire. */
const SYSTEM = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'usr_system', isSystem: true },
} as HttpProtocolContext);

const statusOf = (response: unknown): unknown => (response as any)?.status;
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};
const messageOf = (response: unknown): string => {
    const r = response as any;
    return String(r?.body?.error?.message ?? '');
};

const toggle = (h: Harness, ctx: HttpProtocolContext) =>
    h.dispatcher.handleAutomation(`/${FLOW}/toggle`, 'POST', { enabled: false }, ctx, undefined);

describe('ADR-0126 §5 — the activation write is operator-gated in walled postures', () => {
    describe('`single` posture — the org admin suffices', () => {
        it('a tenant admin with `manage_metadata` may flip the switch', async () => {
            const h = boot('single');

            const { response } = await toggle(h, TENANT_ADMIN());

            expect(statusOf(response)).toBe(200);
            expect(h.toggleFlow).toHaveBeenCalledWith(FLOW, false);
        });

        it('so may the platform operator', async () => {
            const h = boot('single');

            const { response } = await toggle(h, PLATFORM_OPERATOR());

            expect(statusOf(response)).toBe(200);
            expect(h.toggleFlow).toHaveBeenCalledWith(FLOW, false);
        });

        it('no tenancy service at all behaves like `single` (ADR-0093 D4/D5)', async () => {
            const h = boot(null);

            const { response } = await toggle(h, TENANT_ADMIN());

            // Refusing here would lock every single-tenant operator out of
            // their own switch, and an unenforceable wall resolves to `single`.
            expect(statusOf(response)).toBe(200);
            expect(h.toggleFlow).toHaveBeenCalled();
        });
    });

    for (const posture of ['group', 'isolated'] as const) {
        describe(`\`${posture}\` posture — the install-wide switch needs the operator`, () => {
            it('REFUSES a tenant org admin, loudly, and never enters toggleFlow', async () => {
                const h = boot(posture);

                const { response } = await toggle(h, TENANT_ADMIN());

                expect(statusOf(response)).toBe(403);
                expect(codeOf(response)).toBe('PERMISSION_DENIED');
                // The load-bearing assertion: refused BEFORE the write. A gate
                // that wrote the row and then refused would satisfy the two
                // above and still be #10243.
                expect(h.toggleFlow).not.toHaveBeenCalled();
            });

            it('the refusal names the posture, the reason, and the sanctioned path', async () => {
                const h = boot(posture);

                const { response } = await toggle(h, TENANT_ADMIN());
                const message = messageOf(response);

                expect(message).toContain(posture);
                expect(message).toContain('INSTALL-WIDE');
                expect(message).toContain('ADR-0126 §5');
                // ADR-0126 §7: a refusal names what the caller CAN do. Here
                // that is the clone path (§7.1), which needs no operator.
                expect(message).toMatch(/clone/i);
                // #7450 — a denial says nothing about the caller's own
                // positions or permission-set names.
                expect(message).not.toContain('org_owner');
                expect(message).not.toContain('organization_admin');
            });

            it('ALLOWS the platform operator', async () => {
                const h = boot(posture);

                const { response } = await toggle(h, PLATFORM_OPERATOR());

                expect(statusOf(response)).toBe(200);
                expect(h.toggleFlow).toHaveBeenCalledWith(FLOW, false);
            });

            it('ALLOWS engine self-invocation', async () => {
                const h = boot(posture);

                const { response } = await toggle(h, SYSTEM());

                expect(statusOf(response)).toBe(200);
                expect(h.toggleFlow).toHaveBeenCalled();
            });

            it('gates ENABLE as well as disable — the switch is install-wide in both directions', async () => {
                const h = boot(posture);

                const { response } = await h.dispatcher.handleAutomation(
                    `/${FLOW}/toggle`, 'POST', { enabled: true }, TENANT_ADMIN(), undefined,
                );

                expect(statusOf(response)).toBe(403);
                expect(h.toggleFlow).not.toHaveBeenCalled();
            });

            it('does NOT gate the clone door — cloning is the path the refusal recommends', async () => {
                const h = boot(posture);

                const { response } = await h.dispatcher.handleAutomation(
                    `/${FLOW}/clone`, 'POST', { name: 'my_lead_router', label: 'My Lead Router' },
                    TENANT_ADMIN(), undefined,
                );

                // Whatever the clone route answers, it must not be THIS gate:
                // a clone creates an ordinary new artifact and takes nothing
                // away from any tenant (§7.1).
                expect(codeOf(response)).not.toBe('PERMISSION_DENIED');
            });

            it('does not over-block the legacy execution door for a flow named `toggle`', async () => {
                const h = boot(posture);

                await h.dispatcher.handleAutomation('/trigger/toggle', 'POST', {}, TENANT_ADMIN(), undefined);

                // `POST /automation/trigger/toggle` RUNS a flow literally named
                // `toggle`; gating it would over-block an execution door, which
                // is the one thing the #10243 ruling did not do.
                expect(h.toggleFlow).not.toHaveBeenCalled();
            });
        });
    }
});
