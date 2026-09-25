// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19874 — the run-lifecycle refusal names a remedy that WORKS on the
 * deployment it is emitted on.
 *
 * `POST /automation/:name/runs/:runId/cancel` and `…/restore-suspension` admit
 * only the ADR-0095 `PLATFORM_ADMIN` rung, and their refusal tells the caller
 * how that standing is obtained. Which routes to it exist is decided in ONE
 * place, `resolveUserAuthzGrants` in `@objectstack/core`, and it answers per
 * REQUESTED tenancy posture: the declared administrator list
 * (`OS_PLATFORM_OWNER_EMAIL`) on every posture, the unscoped
 * `admin_full_access` grant under `single` only. The sentence used to name the
 * grant everywhere, so on a walled deployment it sent the operator to do a
 * thing that then failed silently at the permission layer.
 *
 * So this file does not pin wording. It pins an EQUIVALENCE, per posture, and
 * drives the resolver for real rather than restating it:
 *
 *   the refusal NAMES a remedy  ⇔  the resolver HONOURS that remedy
 *
 * For every candidate remedy a caller is arranged whose ONLY route to standing
 * is that remedy, resolved through this package's own `resolveExecutionContext`
 * (the real core resolver underneath, the requested posture read from the
 * environment exactly as in production), and handed to the real dispatcher:
 *
 *  - left to right — never a remedy the posture does not honour (the defect);
 *  - right to left — every remedy it does honour is named, so the `single` arm
 *    describes what ships today rather than quietly narrowing to the walled
 *    story (the other card, #11979, owns that half's disposition);
 *  - the LIT control — the caller holding a named remedy is ADMITTED by the
 *    gate, so "honoured" is measured at the door and not only at the resolver;
 *    the mirror — the walled grant holder is REFUSED with the same sentence.
 *
 * ⛔ The gate's own answer is not what moved: every refusal here is still
 * `PERMISSION_DENIED` + 403 (ADR-0112), and the verb is never reached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { PLATFORM_OWNER_EMAIL_ENV, resolveTenancyPosture } from '@objectstack/types';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { resolveExecutionContext } from '../security/resolve-execution-context.js';

/**
 * The environment inputs the derivation reads: the two posture variables in
 * `resolveTenancyPosture()`'s own order, the declared administrator list, and
 * the grants-cache TTL (cleared so every resolution is a fresh derivation).
 */
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const GRANTS_CACHE_ENV = 'OS_AUTHZ_GRANTS_CACHE_TTL_MS';
const HARNESS_ENV = [POSTURE_ENV, MULTI_ORG_ENV, PLATFORM_OWNER_EMAIL_ENV, GRANTS_CACHE_ENV] as const;

type Posture = 'single' | 'group' | 'isolated';
type Tables = Record<string, Array<Record<string, unknown>>>;

/**
 * A minimal ObjectQL `find` double for the authorization reads — the spelling
 * of the sibling double in core's `resolve-authz-context.platform-admin-config`
 * suite. It REFUSES every top-level `$` combinator rather than reading one as a
 * field name, supports `$in` in value position (a per-field operator the
 * resolver really issues), and applies the caller's `limit` by PRESENCE after
 * the filter. An object it holds no rows for answers empty, as an empty table
 * would.
 */
function makeQl(tables: Tables) {
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

/** A verified `sys_user` row and nothing else — no membership, position or grant. */
function userOnly(id: string, email: string): Tables {
    return {
        sys_user: [{ id, email, email_verified: true }],
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [],
        sys_permission_set: [],
    };
}

interface Arranged {
    userId: string;
    email: string;
    tables: Tables;
    /** What `OS_PLATFORM_OWNER_EMAIL` declares for this caller's deployment; `undefined` = unset. */
    declared: string | undefined;
}

/** One candidate route to platform standing, and how to tell whether the refusal names it. */
interface Remedy {
    label: string;
    /** Is this remedy NAMED by the refusal? Any mention counts — stricter than "recommended". */
    named(message: string): boolean;
    /** A caller whose ONLY route to platform standing is this remedy. */
    arrange(): Arranged;
}

const REMEDIES: readonly Remedy[] = [
    {
        label: `the declared administrator list (${PLATFORM_OWNER_EMAIL_ENV})`,
        named: (message) => message.includes(PLATFORM_OWNER_EMAIL_ENV),
        arrange: () => ({
            userId: 'usr_declared',
            email: 'ops@corp.example',
            tables: userOnly('usr_declared', 'ops@corp.example'),
            declared: 'ops@corp.example',
        }),
    },
    {
        label: `the unscoped ${ADMIN_FULL_ACCESS} grant`,
        named: (message) => message.includes(ADMIN_FULL_ACCESS),
        arrange: () => {
            const tables = userOnly('usr_granted', 'legacy@corp.example');
            tables.sys_user_permission_set = [
                { id: 'ups_1', user_id: 'usr_granted', permission_set_id: 'pst_1', organization_id: null },
            ];
            tables.sys_permission_set = [{ id: 'pst_1', name: ADMIN_FULL_ACCESS, active: true }];
            return { userId: 'usr_granted', email: 'legacy@corp.example', tables, declared: undefined };
        },
    },
];

/**
 * What the resolver honours today, per posture — the CONTROL that makes each
 * walled `false` a statement about the retired anchor rather than about a
 * fixture that never resolved anything: the very same grant fixture resolves
 * `PLATFORM_ADMIN` under `single`. The equivalence assertions do not read this
 * table; they read the resolver.
 */
const HONOURED_TODAY: Record<Posture, readonly boolean[]> = {
    single: [true, true],
    group: [true, false],
    isolated: [true, false],
};

/** A caller holding no route to platform standing at all. */
const NOBODY: Arranged = {
    userId: 'usr_member',
    email: 'member@corp.example',
    tables: userOnly('usr_member', 'member@corp.example'),
    declared: undefined,
};

let ambient: Record<string, string | undefined>;

beforeEach(() => {
    ambient = Object.fromEntries(HARNESS_ENV.map((name) => [name, process.env[name]]));
    for (const name of HARNESS_ENV) delete process.env[name];
    resetPlatformAdminEmailMemo();
});

afterEach(() => {
    for (const name of HARNESS_ENV) {
        if (ambient[name] === undefined) delete process.env[name];
        else process.env[name] = ambient[name];
    }
    resetPlatformAdminEmailMemo();
});

/** Request a tenancy posture the way an operator does — the canonical variable, the legacy one cleared. */
function requestPosture(posture: string): void {
    delete process.env[MULTI_ORG_ENV];
    process.env[POSTURE_ENV] = posture;
}

function declare(value: string | undefined): void {
    if (value === undefined) delete process.env[PLATFORM_OWNER_EMAIL_ENV];
    else process.env[PLATFORM_OWNER_EMAIL_ENV] = value;
    resetPlatformAdminEmailMemo();
}

/**
 * Resolve the caller through this package's own request-path resolver — a
 * session for `arranged.userId`, no API key, no `tenancy` service (so the
 * posture the derivation reads is the REQUESTED one, from the environment).
 */
async function resolveCaller(arranged: Arranged): Promise<HttpProtocolContext> {
    declare(arranged.declared);
    const ql = makeQl(arranged.tables);
    const auth = {
        api: {
            getSession: async () => ({
                user: { id: arranged.userId, email: arranged.email },
                session: { id: `ses_${arranged.userId}` },
            }),
        },
    };
    const executionContext = await resolveExecutionContext({
        getService: async (name: string) => (name === 'auth' ? auth : undefined),
        getQl: async () => ql,
        request: { headers: {} },
    });
    return { request: {}, executionContext } as HttpProtocolContext;
}

interface Harness {
    dispatcher: HttpDispatcher;
    cancelRun: ReturnType<typeof vi.fn>;
    restoreConsumedSuspension: ReturnType<typeof vi.fn>;
}

function makeDispatcher(): Harness {
    const cancelRun = vi.fn(async () => true);
    const restoreConsumedSuspension = vi.fn(async () => ({
        restored: true, runId: 'run_7', reason: 'Suspension restored.',
    }));
    const automation = {
        handlerReady: true,
        cancelRun,
        restoreConsumedSuspension,
        listFlows: async () => ['approval_flow'],
        getFlow: async (name: string) => ({ name, nodes: [] }),
    };
    const resolve = (name: string): unknown => (name === 'automation' ? automation : undefined);
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve, trigger: async () => {} },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), cancelRun, restoreConsumedSuspension };
}

const CANCEL_PATH = 'approval_flow/runs/run_7/cancel';
const RESTORE_PATH = 'approval_flow/runs/run_7/restore-suspension';

const statusOf = (response: unknown): unknown => (response as any)?.status;
const codeOf = (response: unknown): unknown => {
    const r = response as any;
    return r?.body?.error?.code ?? r?.body?.error?.details?.code;
};
const messageOf = (response: unknown): string => String((response as any)?.body?.error?.message ?? '');

async function cancelAs(h: Harness, ctx: HttpProtocolContext): Promise<unknown> {
    const { response } = await h.dispatcher.handleAutomation(CANCEL_PATH, 'POST', undefined, ctx, undefined);
    return response;
}

describe('#19874 — the run-lifecycle refusal names exactly the remedies the posture honours', () => {
    for (const posture of ['single', 'group', 'isolated'] as const) {
        describe(`under the '${posture}' tenancy posture`, () => {
            it('refuses a caller with no standing — PERMISSION_DENIED + 403, the verb never reached — naming the posture', async () => {
                requestPosture(posture);
                const h = makeDispatcher();
                const nobody = await resolveCaller(NOBODY);
                expect((nobody.executionContext as any)?.posture).not.toBe('PLATFORM_ADMIN');

                const response = await cancelAs(h, nobody);

                expect(codeOf(response)).toBe('PERMISSION_DENIED');
                expect(statusOf(response)).toBe(403);
                expect(h.cancelRun).not.toHaveBeenCalled();
                expect(messageOf(response)).toContain(`'${posture}' tenancy posture`);
                // The door a refused caller does have is still named.
                expect(messageOf(response)).toContain('/runs/:runId/resume');
            });

            it('names a remedy if and only if the resolver honours it — and a named remedy opens the door', async () => {
                requestPosture(posture);
                const refusal = await cancelAs(makeDispatcher(), await resolveCaller(NOBODY));
                const message = messageOf(refusal);

                const honoured: boolean[] = [];
                for (const remedy of REMEDIES) {
                    const h = makeDispatcher();
                    const caller = await resolveCaller(remedy.arrange());
                    const holds = (caller.executionContext as any)?.posture === 'PLATFORM_ADMIN';
                    honoured.push(holds);

                    // ⭐ The equivalence, both directions.
                    expect(remedy.named(message), `${posture} · ${remedy.label}: named ⇔ honoured`).toBe(holds);

                    const response = await cancelAs(h, caller);
                    if (holds) {
                        // LIT: the named remedy is admitted by the gate itself.
                        expect(statusOf(response), `${posture} · ${remedy.label}`).toBe(200);
                        expect(h.cancelRun).toHaveBeenCalledTimes(1);
                    } else {
                        // Mirror: the unhonoured remedy is refused, with the very
                        // sentence that does not name it.
                        expect(codeOf(response), `${posture} · ${remedy.label}`).toBe('PERMISSION_DENIED');
                        expect(statusOf(response), `${posture} · ${remedy.label}`).toBe(403);
                        expect(messageOf(response)).toBe(message);
                        expect(h.cancelRun).not.toHaveBeenCalled();
                    }
                }

                // Control: what each fixture resolves to is the posture split as
                // it ships — so a walled `false` is the retired anchor, not a
                // fixture that resolves nothing.
                expect(honoured).toEqual(HONOURED_TODAY[posture]);
                // Non-vacuity: the refusal names at least one working remedy.
                expect(REMEDIES.some((r) => r.named(message))).toBe(true);
            });
        });
    }

    it('both doors answer the same sentence — the restore door is not a second policy', async () => {
        requestPosture('isolated');
        const h = makeDispatcher();
        const nobody = await resolveCaller(NOBODY);
        const cancel = await cancelAs(h, nobody);
        const { response: restore } = await h.dispatcher.handleAutomation(
            RESTORE_PATH, 'POST', undefined, nobody, undefined,
        );

        expect(codeOf(restore)).toBe('PERMISSION_DENIED');
        expect(statusOf(restore)).toBe(403);
        expect(messageOf(restore)).toBe(messageOf(cancel));
        expect(h.restoreConsumedSuspension).not.toHaveBeenCalled();
    });

    it('an UNREADABLE requested posture changes the wording, never the answer', async () => {
        requestPosture('no-such-posture');
        // Control: the arm is really reached — the posture read throws here.
        expect(() => resolveTenancyPosture()).toThrow();

        const h = makeDispatcher();
        // Synthetic: the resolver itself cannot run on this environment, and the
        // gate reads only the rung off whatever context it is handed.
        const member = { request: {}, executionContext: { userId: 'usr_member', posture: 'MEMBER' } } as HttpProtocolContext;
        const response = await cancelAs(h, member);

        expect(codeOf(response)).toBe('PERMISSION_DENIED');
        expect(statusOf(response)).toBe(403);
        expect(h.cancelRun).not.toHaveBeenCalled();
        // Only the remedy every posture honours, and the environment value is
        // not echoed back to the caller.
        expect(messageOf(response)).toContain(PLATFORM_OWNER_EMAIL_ENV);
        expect(messageOf(response)).not.toContain(ADMIN_FULL_ACCESS);
        expect(messageOf(response)).not.toContain('no-such-posture');
    });
});
