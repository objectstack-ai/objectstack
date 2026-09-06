// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#15900] The two dispatcher DOMAIN gates that read the tenancy posture must
// tell "no tenancy service was ever registered" apart from "the tenancy service
// is wired and could not be built".
//
// ## The ruling these pins hold up
//
// Director seat, decision batch #55, 2026-09-06T13:51Z; maintainer's reply
// verbatim and untranslated: 「同意」. Option A — the narrow, two-site fix:
//
//   - `./keys.ts` (the `POST /keys` minting gate) and `./activation-gate.ts`
//     (the install-wide activation write gate) stop reading the posture through
//     the collapsing `resolveService('tenancy')` capability probe and read it
//     through the classified lookup instead;
//   - **never registered ⇒ no posture** — today's answer is preserved exactly,
//     so a single-organization deployment is never refused and an org-less key
//     is still minted;
//   - **registered but failed to build, or any other resolution failure ⇒
//     re-throw ⇒ 503** on the door, never a mint and never a permit.
//
// It is the SAME reading #13906 decision 1 option A already ruled at the
// authorization-input seam — 「A posture that could not be READ is not a posture
// that is ABSENT.」 — and that PR #15909 landed for the identity step. The
// severity these gates carried is the INCONSISTENCY: in one deployment, one
// failure made the identity step answer 503 while these two gates served the
// request, so "what is this deployment's state on the wall question" had two
// answers at once.
//
// ⛔ NOT ruled, and deliberately not here: rerouting `'tenancy'` for every
// domain through the loud lookup (option C). That would change every gate that
// reads it in one stroke, and nobody has enumerated those gates.
//
// ## Why these pins call the DOMAIN doors directly
//
// Driving `dispatcher.dispatch()` would prove nothing about these gates: the
// identity step runs FIRST on that path and already answers 503 for this exact
// fault (PR #15909, merged). A pin routed through `dispatch()` would go green on
// #15909's fix with these two gates left exactly as they were — a phantom
// check. So each pin enters at the door body (`handleKeys` / `handleActions`),
// which is where the gate it is about actually runs.
//
// ## Why the fixture builds a REAL kernel
//
// The two classes this file separates are produced by ONE place — the plugin
// loader — and only there: `serviceNotRegisteredError` is package-internal to
// `@objectstack/core`, so a hand-rolled brand in a double would be this file's
// opinion of the classification rather than the classification. In this tree
// `tenancy` is registered as an INSTANCE by `plugin-auth`, so "registered and
// failed to build" has no in-repo producer to lean on and has to be
// CONSTRUCTED: a real `ObjectKernel` with a real `registerServiceFactory`
// whose factory throws. Both legs then resolve through the real
// `PluginLoader.getService`, which is what makes the branded/unbranded split a
// measurement instead of a restatement.

import { describe, it, expect, vi } from 'vitest';

import { ObjectKernel, isAuthzStoreUnavailableError } from '@objectstack/core';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';

/** ADR-0112 envelope for the outage answer — the brand's own two fields. */
const OUTAGE_STATUS = 503;
const OUTAGE_CODE = 'SERVICE_UNAVAILABLE';

/** The message a `tenancy` factory fails with. Never a classification signal. */
const FACTORY_FAULT = 'tenancy factory: datasource unreachable';

type TenancyWiring = 'never-registered' | 'throwing-factory';

/**
 * Register `tenancy` on a real kernel in the requested wiring.
 *
 * `never-registered` registers nothing, so `getServiceAsync('tenancy')` rejects
 * with the loader's BRANDED rejection; `throwing-factory` registers a real
 * singleton factory that throws, so it rejects UNBRANDED from below. Neither
 * rejection is built here — both come out of `PluginLoader.getService`.
 */
function wireTenancy(kernel: ObjectKernel, wiring: TenancyWiring): void {
    if (wiring === 'never-registered') return;
    kernel.registerServiceFactory('tenancy', () => {
        throw new Error(FACTORY_FAULT);
    });
}

/**
 * A kernel with no graceful-shutdown handlers: this suite constructs one per
 * case, and the constructor's signal registration would otherwise accumulate
 * process listeners across them.
 */
const bareKernel = (): ObjectKernel =>
    new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });

// ───────────────────────────────────────────────────────────────────────────
// Gate 1 — `POST /keys`, the mint path (`./keys.ts`)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The engine double the mint path reads: `sys_api_key` inserts and `sys_member`
 * lookups, nothing else.
 *
 * The write verbs route through ObjectQL's OWN dispatch predicates
 * (`check:engine-double-contract`) rather than a hand-written approximation, so
 * this double cannot be looser than the producer. `find` REFUSES a combinator
 * rather than answering it wrong, for the same reason its sibling in
 * `http-dispatcher.keys.test.ts` does: without the throw, `Object.entries`
 * reads `$or` as an ordinary field name and hands back an empty result set with
 * nothing erroring.
 */
function keysEngine(members: any[]) {
    const rows: any[] = [];
    const ql = {
        insert: async (_obj: string, data: any) => {
            const id = `key_${rows.length + 1}`;
            rows.push({ id, ...data });
            return { id };
        },
        find: async (obj: string, opts: any) => {
            const where = opts?.where ?? {};
            const table = obj === 'sys_api_key' ? rows : obj === 'sys_member' ? members : [];
            return table.filter((r: any) => Object.entries(where).every(([k, v]) => {
                if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                return r[k] === v;
            }));
        },
        update: async (_obj: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            return {};
        },
        delete: async (_obj: string, options?: any) => {
            assertEngineDeleteDispatch(options);
            return {};
        },
    };
    return { ql, rows };
}

function bootKeys(wiring: TenancyWiring) {
    const { ql, rows } = keysEngine([]);
    const kernel = bareKernel();
    kernel.registerService('objectql', ql);
    wireTenancy(kernel, wiring);
    return {
        dispatcher: new HttpDispatcher(kernel as never, undefined, { enforceProjectMembership: false }),
        rows,
    };
}

/** A signed-in caller with NO active organization — the org-less mint. */
const orgLessCaller = (): HttpProtocolContext => ({
    request: { headers: {} },
    response: {},
    environmentId: undefined,
    executionContext: {
        userId: 'u1',
        isSystem: false,
        positions: [],
        permissions: [],
        tenantId: undefined,
    },
} as unknown as HttpProtocolContext);

/**
 * `HttpDispatcherResult.response` is optional, so every read of it is a
 * `possibly undefined` in a type-checked program — and this package's test layer
 * IS type-checked. Narrow once, and narrow LOUDLY: a door that answered no
 * response at all is a different defect from one that answered the wrong status.
 */
function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    const { response } = res;
    if (!response) throw new Error('the door answered no response at all');
    return response;
}

describe('[#15900] `POST /keys` mint — a tenancy service that FAILED to build is not an absent posture', () => {
    it('REFUSES loudly (503, outage brand) and mints nothing when the `tenancy` factory throws', async () => {
        const { dispatcher, rows } = bootKeys('throwing-factory');

        const err = await dispatcher
            .handleKeys('POST', { name: 'agent' }, orgLessCaller())
            .then(
                () => { throw new Error('the mint door answered instead of refusing'); },
                (e: unknown) => e,
            );

        // The ADR-0112 envelope, not the throw. `toThrow()` alone would go green
        // on the pre-fix tree the moment ANY unrelated fault reached here, and
        // stay green on a door that answered a bare `Error`.
        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect((err as { status?: unknown }).status).toBe(OUTAGE_STATUS);
        expect((err as { code?: unknown }).code).toBe(OUTAGE_CODE);
        // The load-bearing half: refused BEFORE the secret exists.
        expect(rows).toHaveLength(0);
    });

    it('renders that refusal as a 503 `SERVICE_UNAVAILABLE` on the door', async () => {
        const { dispatcher } = bootKeys('throwing-factory');

        const err = await dispatcher
            .handleKeys('POST', { name: 'agent' }, orgLessCaller())
            .catch((e: unknown) => e);
        // The dispatcher's OWN error exit — the one every domain throw takes on
        // the wire — so this pin is about the answer a caller receives and not
        // only about the shape of the rejection.
        const rendered = (dispatcher as unknown as {
            domainDeps: { errorFromThrown(e: unknown, fallbackStatus?: number): { status: number; body: any } };
        }).domainDeps.errorFromThrown(err, 500);

        expect(rendered.status).toBe(OUTAGE_STATUS);
        expect(rendered.body?.error?.code).toBe(OUTAGE_CODE);
    });

    /**
     * The control. Without it the case above cannot show that the two classes
     * were SEPARATED — only that the door got louder about both.
     */
    it('CONTROL — a deployment that never registered `tenancy` still mints, exactly as before', async () => {
        const { dispatcher, rows } = bootKeys('never-registered');

        const res = responseOf(await dispatcher.handleKeys('POST', { name: 'agent' }, orgLessCaller()));

        expect(res.status).toBe(201);
        expect(rows).toHaveLength(1);
        expect(rows[0].active_organization_id).toBeUndefined();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Gate 2 — the install-wide activation write (`./activation-gate.ts`)
// ───────────────────────────────────────────────────────────────────────────

const OBJECT = 'crm_lead';
const ACTION = 'convert_lead';
const DECLARATION = {
    name: ACTION,
    label: 'Convert Lead',
    objectName: OBJECT,
    type: 'script',
    _packageId: 'crm',
};

function bootActivation(wiring: TenancyWiring) {
    const setActionActive = vi.fn(async () => undefined);
    const objectDef = { name: OBJECT, actions: [DECLARATION], _packageId: 'crm' };
    const objects = [objectDef];

    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        getSchema: (name: string) => objects.find((o) => o.name === name),
        registry: { getObject: (name: string) => objects.find((o) => o.name === name), getItem: () => undefined },
        isActionEnabled: () => true,
        describeDisabledAction: (n: string) => `Action '${n}' is disabled`,
        setActionActive,
        find: vi.fn(async () => []),
        insert: vi.fn(),
        update: async (_obj: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            return {};
        },
        delete: async (_obj: string, options?: any) => {
            assertEngineDeleteDispatch(options);
            return {};
        },
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => objects),
        getObject: vi.fn(async () => objectDef),
    };

    const kernel = bareKernel();
    kernel.registerService('objectql', ql);
    kernel.registerService('data', ql);
    kernel.registerService('metadata', metadata);
    wireTenancy(kernel, wiring);

    return { dispatcher: new HttpDispatcher(kernel as never), setActionActive };
}

/**
 * A tenant org admin who DOES hold `manage_metadata`, so the capability tier in
 * front of the §5 gate passes and the posture question is the only one left.
 */
const tenantAdmin = (): HttpProtocolContext => ({
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

const flip = (dispatcher: HttpDispatcher, ctx: HttpProtocolContext) =>
    dispatcher.handleActions(`/_activation/${OBJECT}/${ACTION}`, 'POST', { enabled: false }, ctx);

describe('[#15900] the install-wide activation write — a tenancy service that FAILED to build is not an absent posture', () => {
    it('REFUSES loudly (503, outage brand) and writes no activation row when the `tenancy` factory throws', async () => {
        const { dispatcher, setActionActive } = bootActivation('throwing-factory');

        const err = await flip(dispatcher, tenantAdmin()).then(
            () => { throw new Error('the activation door answered instead of refusing'); },
            (e: unknown) => e,
        );

        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect((err as { status?: unknown }).status).toBe(OUTAGE_STATUS);
        expect((err as { code?: unknown }).code).toBe(OUTAGE_CODE);
        // Refused BEFORE the write — a gate that refuses afterwards is #10243
        // with an audit trail.
        expect(setActionActive).not.toHaveBeenCalled();
    });

    it('renders that refusal as a 503 `SERVICE_UNAVAILABLE` on the door', async () => {
        const { dispatcher } = bootActivation('throwing-factory');

        const err = await flip(dispatcher, tenantAdmin()).catch((e: unknown) => e);
        const rendered = (dispatcher as unknown as {
            domainDeps: { errorFromThrown(e: unknown, fallbackStatus?: number): { status: number; body: any } };
        }).domainDeps.errorFromThrown(err, 500);

        expect(rendered.status).toBe(OUTAGE_STATUS);
        expect(rendered.body?.error?.code).toBe(OUTAGE_CODE);
    });

    /**
     * The control — ADR-0093 D4/D5: no tenancy service behaves like `single`,
     * where install-level and org-level are the same scope and the org admin who
     * already cleared `manage_metadata` is the right authority. Refusing here
     * would lock every single-tenant operator out of their own switch.
     */
    it('CONTROL — a deployment that never registered `tenancy` still permits the org admin, exactly as before', async () => {
        const { dispatcher, setActionActive } = bootActivation('never-registered');

        const res = responseOf(await flip(dispatcher, tenantAdmin()));

        expect(res.status).toBe(200);
        expect(setActionActive).toHaveBeenCalledWith({ name: ACTION, packageId: 'crm', active: false });
    });
});
