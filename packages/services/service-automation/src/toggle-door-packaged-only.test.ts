// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20726] ADR-0126 §7.2 — the toggle door switches PACKAGED flows, and only
// them.
//
// The door (`toggleFlow`, served as `POST /automation/:name/toggle`) records an
// installation's choice in the packaged-metadata activation ledger,
// `sys_metadata_activation`, whose rows each name "the package that ships the
// base artifact". A flow authored in the deployment has no such package, and
// it already has its own off-switch: its definition's `status` (`obsolete`
// disarms, `active` arms), published through its update door. So the door
// refuses a customer-authored flow loudly, BEFORE any ledger write and before
// any in-process change, and names that switch — in both directions, with a
// ledger attached or without one. ⛔ It never rewrites the definition itself:
// that would make it a second write door into definitions.
//
// Three pins, read off the door's own outputs — the refusal envelope, the
// ledger rows, the trigger binding and the `/_status` row — never off the
// guard's body:
//   1. a customer-authored flow toggled through the door gets the named
//      refusal, and the ledger and the flow are unchanged — including one a
//      ledger row already holds off, whose refusal names the step that
//      completes for it;
//   2. a packaged flow still toggles (the control);
//   3. a customer flow published with `status: 'obsolete'` is not armed — the
//      switch the refusal names works.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** A recording trigger: binding state is read off the trigger, never inferred. */
function recordingTrigger() {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n) };
}

/** A record-triggered flow, so whether it is armed shows on the trigger. */
function flowBody(name: string, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'lead', triggerType: 'record-after-create' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

/** Shipped by a code package (ADR-0029 D9.6 provenance). */
const packaged = (name: string, extra: Record<string, unknown> = {}) => flowBody(name, { ...extra, _packageId: 'crm' });

/**
 * The three shapes a flow authored in this deployment reaches the engine in —
 * none of them in the loader's set, which this suite's stand-in reads off the
 * canonical test (`isCodeArtifactBody`; see `loader-set.test-support.ts` — the
 * engine itself reads the set, never a definition's stamps, #20761):
 *  - no package envelope at all (the automation create door, the clone door);
 *  - the `sys_metadata` sentinel a runtime-authored row is registered under;
 *  - a tenant-authored row bound to an app package (`_provenance: 'org'`).
 * The second and third carry a non-empty `_packageId`, so the ledger's
 * "Package is required" never refused them: they are the proof that the
 * refusal reads provenance, not the emptiness of a package id.
 */
const CUSTOMER_SHAPES: Array<[string, Record<string, unknown>]> = [
    ['no package envelope', {}],
    ["the 'sys_metadata' runtime-row sentinel", { _packageId: 'sys_metadata' }],
    ['a tenant-authored row bound to an app package', { _packageId: 'app.crm', _provenance: 'org' }],
];

/** The row `GET /automation/_status` serves for one flow. */
function stateOf(engine: AutomationEngine, name: string) {
    return engine.getFlowRuntimeStates().find((s) => s.name === name);
}

/** An engine with the in-memory ledger and a record trigger attached. */
function engineWithLedger() {
    const logger = createTestLogger();
    const engine = withLoaderSetFromPull(new AutomationEngine(logger));
    const store = new InMemoryFlowActivationStore();
    engine.setFlowActivationStore(store);
    const records = recordingTrigger();
    engine.registerTrigger(records.trigger);
    return { engine, store, records, logger };
}

/** The refusal, caught, so its envelope can be read. */
async function refusalOf(p: Promise<unknown>): Promise<Error & { code?: unknown; status?: unknown }> {
    try {
        await p;
    } catch (e) {
        return e as Error & { code?: unknown; status?: unknown };
    }
    throw new Error('expected the toggle door to refuse, and it accepted');
}

describe('[#20726] pin 1 — the toggle door refuses a customer-authored flow, and changes nothing', () => {
    for (const [shape, envelope] of CUSTOMER_SHAPES) {
        for (const enabled of [false, true]) {
            it(`${shape}, enabled: ${enabled} — RESOURCE_CONFLICT / 409 naming its status switch; the ledger and the flow are unchanged`, async () => {
                const { engine, store, records } = engineWithLedger();
                engine.registerFlow('customer_flow', flowBody('customer_flow', envelope));
                const setActive = vi.spyOn(store, 'setActive');
                const before = stateOf(engine, 'customer_flow');
                expect(before).toMatchObject({ enabled: true, bound: true });

                const refusal = await refusalOf(engine.toggleFlow('customer_flow', enabled));

                // ADR-0112 envelope: code AND status.
                expect(refusal.code).toBe('RESOURCE_CONFLICT');
                expect(refusal.status).toBe(409);
                // The named subjects: what the door switches, and the flow's
                // own switch — its status, through its update door.
                expect(refusal.message).toMatch(/packaged flows/);
                expect(refusal.message).toMatch(/status/);
                expect(refusal.message).toContain('PUT /automation/customer_flow');

                // Nothing was written, and nothing moved in process.
                expect(setActive).not.toHaveBeenCalled();
                expect(await store.list()).toEqual([]);
                expect(stateOf(engine, 'customer_flow')).toEqual(before);
                expect(records.isBound('customer_flow')).toBe(true);
                expect((await engine.execute('customer_flow')).success).toBe(true);
            });
        }
    }

    it('with NO ledger attached (the degraded mode) the refusal is the same, and nothing flips in process', async () => {
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        const records = recordingTrigger();
        engine.registerTrigger(records.trigger);
        engine.registerFlow('customer_flow', flowBody('customer_flow'));
        const before = stateOf(engine, 'customer_flow');

        const refusal = await refusalOf(engine.toggleFlow('customer_flow', false));

        expect(refusal.code).toBe('RESOURCE_CONFLICT');
        expect(refusal.status).toBe(409);
        expect(stateOf(engine, 'customer_flow')).toEqual(before);
        expect(records.isBound('customer_flow')).toBe(true);
        expect((await engine.execute('customer_flow')).success).toBe(true);
        // The degraded-mode "IN PROCESS ONLY" flip was never reached.
        const warned = logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warned.some((m: string) => m.includes('IN PROCESS ONLY'))).toBe(false);
    });

    // A customer flow can ALREADY be held off by a ledger row under its name:
    // the door used to accept a flow whose package id was non-empty (the
    // sentinel and app-bound shapes above) and wrote one, and a customer
    // overlay can shadow a packaged flow the ledger switched off. A status
    // does not clear such a row, so naming only the status would prescribe a
    // step that completes nothing. The refusal names the step that does.
    it('a customer flow a ledger row already holds off: still refused, the row untouched, and the step it names completes', async () => {
        const { engine, store, records } = engineWithLedger();
        await store.setActive({ name: 'customer_flow', packageId: 'sys_metadata', active: false });
        engine.registerFlow('customer_flow', flowBody('customer_flow', { _packageId: 'sys_metadata', status: 'active' }));
        await engine.hydrateFlowActivations();
        const before = stateOf(engine, 'customer_flow');
        expect(before).toMatchObject({ enabled: false, bound: false });

        const refusal = await refusalOf(engine.toggleFlow('customer_flow', true));

        expect(refusal.code).toBe('RESOURCE_CONFLICT');
        expect(refusal.status).toBe(409);
        expect(refusal.message).toContain('PUT /automation/customer_flow');
        expect(refusal.message).toContain('POST /automation/customer_flow/clone');
        expect(await store.list()).toEqual([{ name: 'customer_flow', packageId: 'sys_metadata', active: false }]);
        expect(stateOf(engine, 'customer_flow')).toEqual(before);

        // Its status does not arm it — which is why the refusal cannot stop there…
        engine.registerFlow('customer_flow', flowBody('customer_flow', { _packageId: 'sys_metadata', status: 'active' }));
        expect(records.isBound('customer_flow')).toBe(false);
        // …and the named step completes: the clone door registers the whole
        // definition under a new name, with no package envelope, and it is armed.
        engine.registerFlow('customer_flow_copy', flowBody('customer_flow_copy', { status: 'draft' }));
        expect(records.isBound('customer_flow_copy')).toBe(true);
    });
});

describe('[#20726] pin 2 — a packaged flow still toggles (the control)', () => {
    it('disable writes its ledger row and disarms it; enable updates the row and re-arms it', async () => {
        const { engine, store, records } = engineWithLedger();
        engine.registerFlow('shipped_flow', packaged('shipped_flow'));
        expect(records.isBound('shipped_flow')).toBe(true);

        await engine.toggleFlow('shipped_flow', false);

        expect(await store.list()).toEqual([{ name: 'shipped_flow', packageId: 'crm', active: false }]);
        expect(records.isBound('shipped_flow')).toBe(false);
        expect(stateOf(engine, 'shipped_flow')).toMatchObject({ enabled: false, bound: false });
        const refused = await engine.execute('shipped_flow');
        expect(refused.success).toBe(false);
        expect((refused as { code?: string }).code).toBe('FLOW_DISABLED');

        await engine.toggleFlow('shipped_flow', true);

        expect(await store.list()).toEqual([{ name: 'shipped_flow', packageId: 'crm', active: true }]);
        expect(records.isBound('shipped_flow')).toBe(true);
        expect(stateOf(engine, 'shipped_flow')).toMatchObject({ enabled: true, bound: true });
    });
});

describe("[#20726] pin 3 — the switch the refusal names works: a customer flow published with status 'obsolete' is not armed", () => {
    it("publishing 'obsolete' through the registration path disarms it, and 'active' arms it again — the ledger is never written", async () => {
        const { engine, store, records } = engineWithLedger();
        const setActive = vi.spyOn(store, 'setActive');
        // `PUT /automation/:name` drives exactly this: `registerFlow(name, definition)`.
        engine.registerFlow('customer_flow', flowBody('customer_flow', { status: 'active' }));
        expect(records.isBound('customer_flow')).toBe(true);

        engine.registerFlow('customer_flow', flowBody('customer_flow', { status: 'obsolete' }));

        expect(records.isBound('customer_flow')).toBe(false);
        expect(stateOf(engine, 'customer_flow')).toMatchObject({ enabled: false, bound: false, status: 'obsolete' });
        const refused = await engine.execute('customer_flow');
        expect(refused.success).toBe(false);
        expect((refused as { code?: string }).code).toBe('FLOW_DISABLED');

        engine.registerFlow('customer_flow', flowBody('customer_flow', { status: 'active' }));

        expect(records.isBound('customer_flow')).toBe(true);
        expect(stateOf(engine, 'customer_flow')).toMatchObject({ enabled: true, bound: true, status: 'active' });
        expect((await engine.execute('customer_flow')).success).toBe(true);
        expect(setActive).not.toHaveBeenCalled();
        expect(await store.list()).toEqual([]);
    });
});
