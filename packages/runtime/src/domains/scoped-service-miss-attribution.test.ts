// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16402] A scope that has no instance is not a caller that forgot the scope.
//
// ## The defect these pins hold down
//
// `HttpDispatcher.resolveServiceOrLoud` — the classified lookup PR #15909
// introduced for #15366's identity step — used to re-resolve on the request's
// own kernel WITHOUT the scope id it had just been handed:
//
//   const own = await classified(() => kernel.getServiceAsync(name));   // ⛔ no scope
//
// A `ServiceLifecycle.SCOPED` registration resolved without a scope id rejects
// `Scope ID required for scoped service 'tenancy'` from
// `PluginLoader.getService` (`packages/core`), unbranded — so a scoped factory
// that legitimately answered `undefined` FOR THAT SCOPE came back out of the
// lookup as that rejection, and every door above it answered
// `503 SERVICE_UNAVAILABLE`. A caller that passed the scope correctly was told
// it had forgotten one.
//
// ⭐ THE CROSS-PACKAGE SPLIT. `packages/core` was telling the TRUTH: the retry
// really did give no scope. The retry was the lie. ⛔ Core's wording is
// deliberately untouched — it is the correct diagnostic for a caller that
// genuinely omits the scope, and §3 below is the pin that keeps that caller
// receiving it.
//
// ## The three states, and why each needs an assertion of its own
//
// This is the next distinction in #13906 decision 1 option A's family
// (「A posture that could not be READ is not a posture that is ABSENT.」): last
// time it was "could not be read" vs "absent", this time it is "no instance for
// THIS scope" vs "the caller gave no scope". Both times one state was reported
// as another, and both times the person holding the wrong message paid.
//
//   (a) never registered        → `never-registered`, quiet `undefined`
//   (b) no instance THIS scope  → `no-instance-in-scope`, quiet `undefined`
//   (c) caller gave no scope    → rejects `Scope ID required …`, 503 at the door
//
// ⚠️ (a) and (b) are DIFFERENT FACTS with the SAME LICENCE, and that is the
// engineering call this file records. A factory that returns `undefined` for a
// scope has ANSWERED, not failed — so it is an absent fact, not an unread one,
// and ADR-0093 D4/D5 reads a scope with no tenancy service the way it reads a
// deployment with none. Answering it as an outage would keep this card's
// manufactured 503 and merely fix its wording, locking a legitimately
// service-less environment out of `/keys`, the activation switch and its own
// identity step.
//
// ⛔ So the two are collapsed at the DOOR (both permit) but NOT in the lookup:
// `HttpDispatcher.classifyService` answers them apart, and §1 asserts all three
// answers pairwise distinct. Merely stopping (b) from emitting (c)'s message
// without giving (b) an answer of its own would just move the confusion. The
// distinction is deliberately kept off `DomainHandlerDeps.resolveServiceOrLoud`
// — an EXPORTED type — because no door needs to act on it; nothing published
// gains a member.
//
// ## POPULATION — stated because a pin proves only what it covers
//
// Covers: ONE `tenancy` wiring — a real `ServiceLifecycle.SCOPED` factory that
// answers an instance for one scope and `undefined` for another, which is the
// producer of state (b) and did not exist in this tree before — driven through
// all FOUR doors that reach the classified lookup (`POST /keys` mint ·
// `POST /actions/_activation/:object/:action` · `POST /automation/:name/toggle`
// · the identity step, `resolveRequestScope`), in three scope postures: the
// scope WITH an instance, the scope WITHOUT one, and no scope at all.
//
// Does NOT cover: the branded never-registered class and the throwing-factory
// outage across those doors — that is `./tenancy-posture-outage-gates.test.ts`
// (#15900), whose population is its own and whose passing is not evidence about
// this file. §1 asserts the never-registered ANSWER only, because separability
// is a claim about all three and cannot be made from two.
//
// ## Why the fixture builds a REAL kernel
//
// Same reason as the #15900 file: the classification comes out of
// `PluginLoader.getService` and nowhere else. `Scope ID required …` is raised
// there, and `getScopedService` handing a factory's `undefined` straight back is
// what state (b) IS. A hand-rolled double would make every leg below this
// file's opinion of the loader rather than the loader.

import { describe, it, expect, vi } from 'vitest';

import { ObjectKernel, ServiceLifecycle, isAuthzStoreUnavailableError } from '@objectstack/core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import { ACTIVATION_DENY_STATUS, ACTIVATION_DENY_CODE } from './activation-gate.js';

/** ADR-0112 envelope for the outage answer. */
const OUTAGE_STATUS = 503;
const OUTAGE_CODE = 'SERVICE_UNAVAILABLE';

/**
 * ⭐ The message `packages/core` raises for a scoped registration resolved
 * without a scope id, verbatim. Asserted rather than paraphrased because §3 is
 * about this exact text SURVIVING: an implementation that answers every scoped
 * miss with `undefined` makes §1 and §2 green while deleting it.
 */
const SCOPE_REQUIRED = "Scope ID required for scoped service 'tenancy'";

/** The scope whose `tenancy` factory HAS an instance. */
const SCOPE_SERVED = 'platform';
/** The scope whose `tenancy` factory legitimately answers `undefined`. */
const SCOPE_EMPTY = 'northwind';

/** A wall-enforcing posture, so a READ posture is visible as a refusal. */
const WALLED_POSTURE = 'isolated';

/**
 * The producer of state (b): ONE real scoped registration that answers an
 * instance for `SCOPE_SERVED` and `undefined` for every other scope. Nothing
 * here is unwell — the factory never throws — which is the whole point: every
 * 503 this file can observe was manufactured by the lookup.
 */
function wireScopedTenancy(kernel: ObjectKernel): { scopesAsked: (string | undefined)[] } {
    const scopesAsked: (string | undefined)[] = [];
    kernel.registerServiceFactory(
        'tenancy',
        (_ctx: unknown, scopeId?: string) => {
            scopesAsked.push(scopeId);
            return scopeId === SCOPE_SERVED ? { posture: WALLED_POSTURE } : undefined;
        },
        ServiceLifecycle.SCOPED,
    );
    return { scopesAsked };
}

/** No graceful-shutdown handlers: one kernel per case would otherwise pile up process listeners. */
const bareKernel = (): ObjectKernel =>
    new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });

/**
 * `HttpDispatcherResult.response` is optional, so narrow it LOUDLY: a door that
 * answered no response at all is a different defect from one that answered the
 * wrong status.
 */
function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    const { response } = res;
    if (!response) throw new Error('the door answered no response at all');
    return response;
}

/** The rejection a door produced, or a loud failure if it answered instead. */
async function rejectionOf<T>(door: Promise<T>, what: string): Promise<any> {
    return door.then(
        () => { throw new Error(`the ${what} answered instead of refusing`); },
        (err: unknown) => err,
    );
}

// ───────────────────────────────────────────────────────────────────────────
// §1 — THE THREE STATES, one assertion each, at the lookup that classifies them
// ───────────────────────────────────────────────────────────────────────────

/**
 * `classifyService` is private: the distinction is deliberately internal (the
 * exported `DomainHandlerDeps` member is unchanged), so the pin reaches it the
 * same way this package's other dispatcher pins reach `domainDeps`.
 */
type Classifier = {
    classifyService(kernel: unknown, name: string, scopeId?: string): Promise<{ outcome: string; scopeId?: string; value?: unknown }>;
    resolveServiceOrLoud(kernel: unknown, name: string, scopeId?: string): Promise<unknown>;
};
const lookupOf = (d: HttpDispatcher): Classifier => d as unknown as Classifier;

describe('[#16402] the classified lookup tells all THREE states apart', () => {
    it('(a) NEVER REGISTERED — answers `never-registered`, and `undefined` to the door', async () => {
        const kernel = bareKernel();
        const d = new HttpDispatcher(kernel as never);

        expect(await lookupOf(d).classifyService(kernel, 'tenancy', SCOPE_EMPTY))
            .toEqual({ outcome: 'never-registered' });
        expect(await lookupOf(d).resolveServiceOrLoud(kernel, 'tenancy', SCOPE_EMPTY)).toBeUndefined();
    });

    it('(b) NO INSTANCE FOR THIS SCOPE — answers `no-instance-in-scope` NAMING the scope, and `undefined` to the door', async () => {
        const kernel = bareKernel();
        wireScopedTenancy(kernel);
        const d = new HttpDispatcher(kernel as never);

        // The answer of its own — the state that had no answer at all before,
        // and borrowed (c)'s message instead.
        expect(await lookupOf(d).classifyService(kernel, 'tenancy', SCOPE_EMPTY))
            .toEqual({ outcome: 'no-instance-in-scope', scopeId: SCOPE_EMPTY });
        expect(await lookupOf(d).resolveServiceOrLoud(kernel, 'tenancy', SCOPE_EMPTY)).toBeUndefined();
    });

    it('(c) CALLER GAVE NO SCOPE — still rejects with core\'s own `Scope ID required …`, unchanged', async () => {
        const kernel = bareKernel();
        wireScopedTenancy(kernel);
        const d = new HttpDispatcher(kernel as never);

        const err = await rejectionOf(
            lookupOf(d).classifyService(kernel, 'tenancy', undefined),
            'classified lookup',
        );
        expect((err as Error).message).toBe(SCOPE_REQUIRED);
        // The same rejection reaches the door-facing entry point, so the
        // classification is not something only the private arm can see.
        const viaDoor = await rejectionOf(
            lookupOf(d).resolveServiceOrLoud(kernel, 'tenancy', undefined),
            'classified lookup',
        );
        expect((viaDoor as Error).message).toBe(SCOPE_REQUIRED);
    });

    /**
     * ⭐ SEPARABILITY, stated mechanically. Each case above asserts one answer;
     * only this one asserts they are three answers and not two wearing three
     * names — which is the failure this card is a second instance of.
     */
    it('the three answers are pairwise DISTINCT — separable, not merely non-identical messages', async () => {
        const empty = bareKernel();
        const scoped = bareKernel();
        wireScopedTenancy(scoped);
        const dEmpty = new HttpDispatcher(empty as never);
        const dScoped = new HttpDispatcher(scoped as never);

        const a = await lookupOf(dEmpty).classifyService(empty, 'tenancy', SCOPE_EMPTY);
        const b = await lookupOf(dScoped).classifyService(scoped, 'tenancy', SCOPE_EMPTY);
        const c = await rejectionOf(lookupOf(dScoped).classifyService(scoped, 'tenancy', undefined), 'lookup');

        expect(a.outcome).toBe('never-registered');
        expect(b.outcome).toBe('no-instance-in-scope');
        expect(a.outcome).not.toBe(b.outcome);
        // (c) is not an outcome at all — it is the rejection, which is what
        // makes it visible to a caller that only holds the throw.
        expect(c).toBeInstanceOf(Error);
        expect((c as Error).message).toBe(SCOPE_REQUIRED);
    });

    /** The positive control: the SAME factory, for the scope it has an instance for. */
    it('CONTROL — the same factory resolves for the scope it DOES have an instance for', async () => {
        const kernel = bareKernel();
        wireScopedTenancy(kernel);
        const d = new HttpDispatcher(kernel as never);

        expect(await lookupOf(d).classifyService(kernel, 'tenancy', SCOPE_SERVED))
            .toEqual({ outcome: 'resolved', value: { posture: WALLED_POSTURE } });
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The four doors that reach the classified lookup
// ───────────────────────────────────────────────────────────────────────────

/**
 * Door 1 — the `POST /keys` mint gate (`./keys.ts`).
 *
 * ⛔ Deliberately no `update` / `delete` on the double: the mint path calls
 * neither, and a double declaring a verb its subject never reaches is coverage
 * nobody is getting. `find` honours `limit` by PRESENCE and after the filter,
 * and REFUSES a combinator rather than answering it wrong.
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

function bootKeys() {
    const { ql, rows } = keysEngine([]);
    const kernel = bareKernel();
    kernel.registerService('objectql', ql);
    wireScopedTenancy(kernel);
    return {
        dispatcher: new HttpDispatcher(kernel as never, undefined, { enforceProjectMembership: false }),
        rows,
    };
}

/** A signed-in caller with NO active organization — the org-less mint. */
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

const mint = (d: HttpDispatcher, ctx: HttpProtocolContext) => d.handleKeys('POST', { name: 'agent' }, ctx);

/** Door 2 — the install-wide activation write (`./actions.ts` → `./activation-gate.ts`). */
const OBJECT = 'crm_lead';
const ACTION = 'convert_lead';
const DECLARATION = { name: ACTION, label: 'Convert Lead', objectName: OBJECT, type: 'script', _packageId: 'crm' };

function bootActivation() {
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
    wireScopedTenancy(kernel);

    return { dispatcher: new HttpDispatcher(kernel as never), setActionActive };
}

/** A tenant org admin holding `manage_metadata`, so the posture is the only question left. */
const tenantAdmin = (environmentId?: string): HttpProtocolContext => ({
    request: {},
    environmentId,
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        organizationId: 'org_northwind',
    },
} as unknown as HttpProtocolContext);

const flip = (d: HttpDispatcher, ctx: HttpProtocolContext) =>
    d.handleActions(`/_activation/${OBJECT}/${ACTION}`, 'POST', { enabled: false }, ctx);

/** Door 3 — `POST /automation/:name/toggle` (`./automation.ts`, read-only here: PR #16755 holds that file). */
const FLOW = 'vendor_lead_router';
const FLOW_DEFINITION = { name: FLOW, label: 'Vendor Lead Router', type: 'autolaunched', nodes: [], edges: [] };

function bootAutomation() {
    const toggleFlow = vi.fn(async () => undefined);
    const automation = {
        handlerReady: true,
        toggleFlow,
        getFlow: vi.fn(async (name: string) => (name === FLOW ? FLOW_DEFINITION : undefined)),
    };
    const kernel = bareKernel();
    kernel.registerService('automation', automation);
    wireScopedTenancy(kernel);
    return { dispatcher: new HttpDispatcher(kernel as never), toggleFlow };
}

const toggle = (d: HttpDispatcher, ctx: HttpProtocolContext) =>
    d.handleAutomation(`/${FLOW}/toggle`, 'POST', { enabled: false }, ctx, undefined);

/** Door 4 — the ORIGINAL door: the identity step (`HttpDispatcher.resolveRequestScope`, #15366/PR #15909). */
function bootIdentity() {
    const kernel = bareKernel();
    const { scopesAsked } = wireScopedTenancy(kernel);
    return { dispatcher: new HttpDispatcher(kernel as never), scopesAsked };
}

const identity = (d: HttpDispatcher, ctx: HttpProtocolContext) =>
    d.resolveRequestScope(ctx, '/api/v1/data/crm_lead');

// ───────────────────────────────────────────────────────────────────────────
// §2 — STATE (b) on ALL FOUR DOORS: the manufactured outage is gone
// ───────────────────────────────────────────────────────────────────────────

describe('[#16402] a scope with no instance manufactures no outage — all four doors', () => {
    it('door 1 · POST /keys mint — MINTS instead of answering 503', async () => {
        const { dispatcher, rows } = bootKeys();

        const res = responseOf(await mint(dispatcher, orgLessCaller(SCOPE_EMPTY)));

        expect(res.status).toBe(201);
        expect(rows).toHaveLength(1);
    });

    it('door 2 · install-wide activation write — WRITES instead of answering 503', async () => {
        const { dispatcher, setActionActive } = bootActivation();

        const res = responseOf(await flip(dispatcher, tenantAdmin(SCOPE_EMPTY)));

        expect(res.status).toBe(200);
        expect(setActionActive).toHaveBeenCalledWith({ name: ACTION, packageId: 'crm', active: false });
    });

    it('door 3 · POST /automation/:name/toggle — TOGGLES instead of answering 503', async () => {
        const { dispatcher, toggleFlow } = bootAutomation();

        const res = responseOf(await toggle(dispatcher, tenantAdmin(SCOPE_EMPTY)));

        expect(res.status).toBe(200);
        expect(toggleFlow).toHaveBeenCalled();
    });

    it('door 4 · the identity step — RESOLVES an execution context instead of raising 503', async () => {
        const { dispatcher, scopesAsked } = bootIdentity();
        const ctx = orgLessCaller(SCOPE_EMPTY);
        (ctx as any).executionContext = undefined;

        await expect(identity(dispatcher, ctx)).resolves.toBeUndefined();

        expect(ctx.executionContext).toBeDefined();
        // ⭐ EVERY leg of the chain carried the request's scope. More than one
        // ask is expected and not a defect: the host leg and the request-kernel
        // leg are two registry reads, and a scope with no instance caches
        // nothing to short-circuit the second.
        //
        // ⚠️ This is the WEAKER half of the pin and is labelled as such — a leg
        // that DROPPED the scope never reaches the factory at all
        // (`PluginLoader.getService` rejects before `createServiceInstance`), so
        // the dropped leg is invisible here and shows up only as the door's own
        // answer, which is what the assertions above measure.
        expect(scopesAsked.length).toBeGreaterThan(0);
        expect(scopesAsked.every((asked) => asked === SCOPE_EMPTY)).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 — THE NEGATIVE CONTROL: a caller that REALLY forgot the scope
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⭐ The direction this fix most easily breaks. An implementation where a scoped
 * miss always answers `undefined` makes §1 and §2 green while DELETING a correct
 * diagnostic — the one `packages/core` raises for a caller that genuinely
 * omitted the scope. Every leg here asserts that caller still gets it, at the
 * door and in core's own words.
 *
 * ⚠️ The rejection is asserted through the ADR-0112 envelope AND the `cause`,
 * not with a bare `toThrow()`: a door that answered some other outage would pass
 * a bare throw assertion while the diagnostic was gone.
 */
describe('[#16402] NEGATIVE CONTROL — a caller that really gave no scope still gets `Scope ID required …`', () => {
    const expectScopeRequiredOutage = (err: unknown): void => {
        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect((err as { status?: unknown }).status).toBe(OUTAGE_STATUS);
        expect((err as { code?: unknown }).code).toBe(OUTAGE_CODE);
        // ⭐ Core's wording, reaching the operator intact through the envelope.
        expect(((err as { cause?: unknown }).cause as Error | undefined)?.message).toBe(SCOPE_REQUIRED);
    };

    it('door 1 · POST /keys mint — refuses 503 and mints NOTHING', async () => {
        const { dispatcher, rows } = bootKeys();

        expectScopeRequiredOutage(await rejectionOf(mint(dispatcher, orgLessCaller(undefined)), 'mint door'));
        expect(rows).toHaveLength(0);
    });

    it('door 2 · install-wide activation write — refuses 503 and writes NOTHING', async () => {
        const { dispatcher, setActionActive } = bootActivation();

        expectScopeRequiredOutage(await rejectionOf(flip(dispatcher, tenantAdmin(undefined)), 'activation door'));
        expect(setActionActive).not.toHaveBeenCalled();
    });

    it('door 3 · POST /automation/:name/toggle — refuses 503 and toggles NOTHING', async () => {
        const { dispatcher, toggleFlow } = bootAutomation();

        expectScopeRequiredOutage(await rejectionOf(toggle(dispatcher, tenantAdmin(undefined)), 'toggle door'));
        expect(toggleFlow).not.toHaveBeenCalled();
    });

    it('door 4 · the identity step — raises the same 503 rather than resolving anonymously', async () => {
        const { dispatcher } = bootIdentity();
        const ctx = orgLessCaller(undefined);
        (ctx as any).executionContext = undefined;

        expectScopeRequiredOutage(await rejectionOf(identity(dispatcher, ctx), 'identity step'));
    });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 — the OTHER direction: the lookup did not go blind
// ───────────────────────────────────────────────────────────────────────────

/**
 * Without these, §2 is satisfied by a lookup that answers `undefined` to
 * everything — which is the same defect one layer down. Each leg drives the
 * SAME factory in the scope it DOES serve and requires the posture to be READ:
 * the walled refusal is an answer only a read posture can produce.
 */
describe('[#16402] CONTROL — the scope that HAS an instance still reads the posture', () => {
    it('door 1 · POST /keys mint — refuses the org-less mint (400), not 503 and not 201', async () => {
        const { dispatcher, rows } = bootKeys();

        const res = responseOf(await mint(dispatcher, orgLessCaller(SCOPE_SERVED)));

        expect(res.status).toBe(400);
        expect(rows).toHaveLength(0);
    });

    it('door 2 · install-wide activation write — refuses the tenant org admin (403)', async () => {
        const { dispatcher, setActionActive } = bootActivation();

        const res = responseOf(await flip(dispatcher, tenantAdmin(SCOPE_SERVED)));

        expect(res.status).toBe(ACTIVATION_DENY_STATUS);
        expect(res.body?.error?.code).toBe(ACTIVATION_DENY_CODE);
        expect(setActionActive).not.toHaveBeenCalled();
    });

    it('door 3 · POST /automation/:name/toggle — refuses the tenant org admin (403)', async () => {
        const { dispatcher, toggleFlow } = bootAutomation();

        const res = responseOf(await toggle(dispatcher, tenantAdmin(SCOPE_SERVED)));

        expect(res.status).toBe(ACTIVATION_DENY_STATUS);
        expect(res.body?.error?.code).toBe(ACTIVATION_DENY_CODE);
        expect(toggleFlow).not.toHaveBeenCalled();
    });

    /**
     * ⚠️ This door's control observes the READ, not a posture-conditional
     * answer, and that is a boundary rather than a weaker assertion:
     * `resolveExecutionContext` hands the posture to `resolveAuthzContext`,
     * which spends it on api-key admission and tenant derivation — an anonymous
     * request carries no posture-conditional outcome for a pin to read, and
     * `tenancyPosture` is deliberately not a field on the envelope. So the
     * measurable fact here is that the door asked the registry IN THE REQUEST'S
     * OWN SCOPE and was served — which is exactly what a lookup gone blind
     * would stop doing. The three doors above carry the outcome half.
     */
    it('door 4 · the identity step — asks in the REQUEST\'S scope, is served, and resolves', async () => {
        const { dispatcher, scopesAsked } = bootIdentity();
        const ctx = orgLessCaller(SCOPE_SERVED);
        (ctx as any).executionContext = undefined;

        await expect(identity(dispatcher, ctx)).resolves.toBeUndefined();

        expect(scopesAsked).toContain(SCOPE_SERVED);
        // ⛔ Never asked WITHOUT the scope: that retry is this card's defect, and
        // on this wiring it is also what would have raised `Scope ID required …`.
        expect(scopesAsked).not.toContain(undefined);
        expect(ctx.executionContext).toBeDefined();
    });
});
