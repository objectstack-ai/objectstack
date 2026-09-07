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
// ## WHICH DOORS — three, because the gate body has three call sites
//
// `refuseUngrantedActivationWrite` is ONE gate with two callers, so the
// install-wide activation write has two doors: `./actions.ts:156` (`POST
// /actions/_activation/:object/:action`) and `./automation.ts:1050` (`POST
// /automation/:name/toggle`, through `refuseUngrantedFlowActivationWrite`).
// Both inherit the throw exit this change gives the gate, so both are pinned
// here alongside the `/keys` mint. A pin on one door is not evidence about the
// other: they differ in what runs in FRONT of the gate — the automation domain
// has an anonymous floor and its own authoring-write predicate — and what runs
// in front of a gate is exactly what a pin entering at the door body measures.
//
// ## THE SCOPE ID IS PART OF THE READ, not an optimisation
//
// `tenancy` may be registered `ServiceLifecycle.SCOPED`. Resolved WITHOUT a
// scope id a scoped registration rejects UNBRANDED — `Scope ID required for
// scoped service 'tenancy'` — and the classified lookup then re-raises it,
// correctly: it is not the branded "never registered". So a gate that drops the
// scope id it already holds answers **503 on a perfectly healthy deployment**,
// and the caller it locks out includes the platform operator, the one authority
// ADR-0126 §5 says the switch belongs to. That outage is manufactured by the
// CALL SITE, and it is the opposite of what this card is about.
//
// The `scoped-healthy` legs below are the pins for that class. They register a
// real scoped `tenancy` and require each door to READ the posture through the
// request's own environment — refuse the tenant org admin (403) and ADMIT the
// operator (200) — never to answer 503. Without them a pin file about outages
// cannot tell "loud on a broken service" from "loud on everything".
//
// ## POPULATION — stated because a pin proves only what it covers
//
// Covers: three wirings of `tenancy` (never registered · registered through a
// factory that throws · registered SCOPED and healthy, reporting `isolated`)
// across three doors (`POST /keys` mint · the actions activation write · the
// automation toggle), for the callers each door's decision turns on (an org-less
// minter; a tenant org admin who already holds `manage_metadata`; the
// `PLATFORM_ADMIN` operator).
//
// Does NOT cover: the posture-conditional refusal itself on a HEALTHY
// non-scoped service — that is `action-activation-posture-gate.test.ts` and
// `automation-activation-posture-gate.test.ts`, whose populations are their own
// and whose passing is not evidence about this file — nor the `manage_metadata`
// tier in front of the gate, nor the identity step (`http-dispatcher.ts`), which
// has read this same fact loudly since PR #15909.
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

import { ObjectKernel, ServiceLifecycle, isAuthzStoreUnavailableError } from '@objectstack/core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import { ACTIVATION_DENY_STATUS, ACTIVATION_DENY_CODE } from './activation-gate.js';

/** ADR-0112 envelope for the outage answer — the brand's own two fields. */
const OUTAGE_STATUS = 503;
const OUTAGE_CODE = 'SERVICE_UNAVAILABLE';

/** The message a `tenancy` factory fails with. Never a classification signal. */
const FACTORY_FAULT = 'tenancy factory: datasource unreachable';

/**
 * The environment the scoped legs resolve in — the value a request carries as
 * `context.environmentId`, which is the scope every gate reading this name must
 * pass down (`./keys.ts`, `./activation-gate.ts`, and the identity step).
 */
const SCOPE = 'platform';

/** A wall-enforcing posture, so the §5 operator test is the only question left. */
const WALLED_POSTURE = 'isolated';

type TenancyWiring = 'never-registered' | 'throwing-factory' | 'scoped-healthy';

/**
 * Register `tenancy` on a real kernel in the requested wiring.
 *
 * `never-registered` registers nothing, so `getServiceAsync('tenancy')` rejects
 * with the loader's BRANDED rejection; `throwing-factory` registers a real
 * singleton factory that throws, so it rejects UNBRANDED from below;
 * `scoped-healthy` registers a real `ServiceLifecycle.SCOPED` factory that
 * SUCCEEDS, which resolves only when the caller passes the scope id and rejects
 * unbranded (`Scope ID required…`) when it does not. None of the three
 * rejections is built here — all come out of `PluginLoader.getService`, which
 * is what makes the classification a measurement rather than a restatement.
 */
function wireTenancy(kernel: ObjectKernel, wiring: TenancyWiring): void {
    if (wiring === 'never-registered') return;
    if (wiring === 'scoped-healthy') {
        kernel.registerServiceFactory(
            'tenancy',
            () => ({ posture: WALLED_POSTURE }),
            ServiceLifecycle.SCOPED,
        );
        return;
    }
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
 * lookups, and NOTHING else.
 *
 * ⛔ Deliberately no `update` / `delete`. The mint path calls neither, and a
 * double that declares a verb its subject never reaches is coverage nobody is
 * getting: it would owe `check:engine-double-contract` a ledger row for a pin
 * that can never fire. A path that grows into one of those verbs fails loudly
 * here rather than meeting a stub.
 *
 * `find` REFUSES a combinator rather than answering it wrong, for the same
 * reason its sibling in `http-dispatcher.keys.test.ts` does: without the throw,
 * `Object.entries` reads `$or` as an ordinary field name, compares `row.$or`
 * against the array, matches nothing, and hands the suite an empty result set
 * with nothing erroring. It honours the caller's `limit` by PRESENCE and after
 * the filter (`check:objectql-double-limit`), so it cannot pass a page the
 * producer would not have returned.
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
            const matched = table.filter((r: any) => Object.entries(where).every(([k, v]) => {
                if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                return r[k] === v;
            }));
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
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

/**
 * A signed-in caller with NO active organization — the org-less mint.
 *
 * `environmentId` is a parameter because it is the SCOPE the mint gate resolves
 * `tenancy` in: the outage legs below carry none (the shape a single-kernel
 * deployment sends), the scoped-healthy leg carries the request's environment,
 * and the difference between those two is the thing the scoped legs measure.
 */
const orgLessCaller = (environmentId?: string): HttpProtocolContext => ({
    request: { headers: {} },
    response: {},
    environmentId,
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

    /**
     * CONTROL for the OTHER direction: a HEALTHY service must not be answered as
     * an outage. A scoped registration is resolvable only with the scope id the
     * request carries, so this leg fails the moment the gate stops passing
     * `context.environmentId` down — and it fails as a 503, which is precisely
     * the failure a pin file about 503s must be able to see.
     */
    it('reads a HEALTHY SCOPED `tenancy` through the request scope and refuses the org-less mint (400), not 503', async () => {
        const { dispatcher, rows } = bootKeys('scoped-healthy');

        const res = responseOf(await dispatcher.handleKeys('POST', { name: 'agent' }, orgLessCaller(SCOPE)));

        // The walled refusal, which means the posture was READ — an unread
        // posture cannot produce it, and an outage answer is not it either.
        expect(res.status).toBe(400);
        expect(rows).toHaveLength(0);
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
        // Same rule as `keysEngine`: only the verbs this door actually reaches.
        find: vi.fn(async () => []),
        insert: vi.fn(),
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
    environmentId: SCOPE,
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        organizationId: 'org_northwind',
    },
} as unknown as HttpProtocolContext);

/**
 * The PLATFORM OPERATOR — the authority ADR-0126 §5 says this install-wide row
 * belongs to. Read as the posture RUNG (`ec.posture === 'PLATFORM_ADMIN'`, ADR-0095
 * D2/D3 · #15981), never as a position NAME.
 *
 * This caller is the load-bearing one for the scoped legs: every other caller
 * this file drives is one a refusal is a correct answer for, so a gate that
 * answered "no" to everything would still satisfy them. The operator is the only
 * caller whose CORRECT answer is `200`, which makes them the only caller who can
 * catch a gate that turned a healthy deployment into an outage.
 */
const operator = (): HttpProtocolContext => ({
    request: {},
    environmentId: SCOPE,
    executionContext: {
        userId: 'u_operator',
        posture: 'PLATFORM_ADMIN',
        positions: [],
        permissions: [],
        systemPermissions: ['manage_metadata'],
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

    /**
     * A HEALTHY scoped service is not an outage: the gate must READ the walled
     * posture through the request's own environment and answer §5 — the tenant
     * org admin refused with `403 PERMISSION_DENIED` and no row written.
     */
    it('reads a HEALTHY SCOPED `tenancy` through the request scope and REFUSES the tenant org admin (403), not 503', async () => {
        const { dispatcher, setActionActive } = bootActivation('scoped-healthy');

        const res = responseOf(await flip(dispatcher, tenantAdmin()));

        expect(res.status).toBe(ACTIVATION_DENY_STATUS);
        expect(res.body?.error?.code).toBe(ACTIVATION_DENY_CODE);
        expect(setActionActive).not.toHaveBeenCalled();
    });

    /**
     * ⭐ The pin that catches a gate manufacturing its own outage. On a healthy
     * deployment the operator is the sanctioned authority and their write must
     * LAND. A gate that resolves the posture without the scope id answers 503
     * here instead, on a service that was never unwell — a lockout of the one
     * caller ADR-0126 §5 exists to admit, dressed as this card's own fix.
     */
    it('reads a HEALTHY SCOPED `tenancy` through the request scope and ADMITS the platform operator (200)', async () => {
        const { dispatcher, setActionActive } = bootActivation('scoped-healthy');

        const res = responseOf(await flip(dispatcher, operator()));

        expect(res.status).toBe(200);
        expect(setActionActive).toHaveBeenCalledWith({ name: ACTION, packageId: 'crm', active: false });
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Gate 3 — the SECOND door onto the same install-wide write:
// `POST /automation/:name/toggle` (`./automation.ts` →
// `refuseUngrantedFlowActivationWrite` → the gate above)
// ───────────────────────────────────────────────────────────────────────────

const FLOW = 'vendor_lead_router';
const FLOW_DEFINITION = { name: FLOW, label: 'Vendor Lead Router', type: 'autolaunched', nodes: [], edges: [] };

/**
 * The automation slot double, holding only what this door reaches: `getFlow`
 * for the lookup and `toggleFlow` for the write, plus the `handlerReady: true`
 * self-declaration the domain's #4058 serveability probe requires. Same rule as
 * the two engine doubles above — a verb this door never calls would be coverage
 * nobody is getting.
 */
function bootAutomation(wiring: TenancyWiring) {
    const toggleFlow = vi.fn(async () => undefined);
    const automation = {
        handlerReady: true,
        toggleFlow,
        getFlow: vi.fn(async (name: string) => (name === FLOW ? FLOW_DEFINITION : undefined)),
    };

    const kernel = bareKernel();
    kernel.registerService('automation', automation);
    wireTenancy(kernel, wiring);

    return { dispatcher: new HttpDispatcher(kernel as never), toggleFlow };
}

const toggle = (dispatcher: HttpDispatcher, ctx: HttpProtocolContext) =>
    dispatcher.handleAutomation(`/${FLOW}/toggle`, 'POST', { enabled: false }, ctx, undefined);

describe('[#15900] the automation toggle — the same install-wide gate, reached through the OTHER door', () => {
    it('REFUSES loudly (503, outage brand) and toggles nothing when the `tenancy` factory throws', async () => {
        const { dispatcher, toggleFlow } = bootAutomation('throwing-factory');

        const err = await toggle(dispatcher, tenantAdmin()).then(
            () => { throw new Error('the toggle door answered instead of refusing'); },
            (e: unknown) => e,
        );

        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect((err as { status?: unknown }).status).toBe(OUTAGE_STATUS);
        expect((err as { code?: unknown }).code).toBe(OUTAGE_CODE);
        // Refused BEFORE the durable row — ADR-0126 made this switch survive a
        // cold boot, so a refusal after the write is the #10243 leak with an
        // audit trail.
        expect(toggleFlow).not.toHaveBeenCalled();
    });

    it('renders that refusal as a 503 `SERVICE_UNAVAILABLE` on the door', async () => {
        const { dispatcher } = bootAutomation('throwing-factory');

        const err = await toggle(dispatcher, tenantAdmin()).catch((e: unknown) => e);
        const rendered = (dispatcher as unknown as {
            domainDeps: { errorFromThrown(e: unknown, fallbackStatus?: number): { status: number; body: any } };
        }).domainDeps.errorFromThrown(err, 500);

        expect(rendered.status).toBe(OUTAGE_STATUS);
        expect(rendered.body?.error?.code).toBe(OUTAGE_CODE);
    });

    /** The control, for this door's own population: absence still fails open. */
    it('CONTROL — a deployment that never registered `tenancy` still permits the org admin, exactly as before', async () => {
        const { dispatcher, toggleFlow } = bootAutomation('never-registered');

        const res = responseOf(await toggle(dispatcher, tenantAdmin()));

        expect(res.status).toBe(200);
        expect(toggleFlow).toHaveBeenCalled();
    });

    it('reads a HEALTHY SCOPED `tenancy` through the request scope and REFUSES the tenant org admin (403), not 503', async () => {
        const { dispatcher, toggleFlow } = bootAutomation('scoped-healthy');

        const res = responseOf(await toggle(dispatcher, tenantAdmin()));

        expect(res.status).toBe(ACTIVATION_DENY_STATUS);
        expect(res.body?.error?.code).toBe(ACTIVATION_DENY_CODE);
        expect(toggleFlow).not.toHaveBeenCalled();
    });

    it('reads a HEALTHY SCOPED `tenancy` through the request scope and ADMITS the platform operator (200)', async () => {
        const { dispatcher, toggleFlow } = bootAutomation('scoped-healthy');

        const res = responseOf(await toggle(dispatcher, operator()));

        expect(res.status).toBe(200);
        expect(toggleFlow).toHaveBeenCalled();
    });
});
