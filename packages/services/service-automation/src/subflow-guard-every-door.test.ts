// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20725] ADR-0126 §7.3 on EVERY door, not the toggle door alone.
//
// §7.3 refuses one state: a packaged flow armed while a packaged flow it calls
// as a `subflow` / `map` target is disabled — the caller then fails mid-run at
// its subflow node, "a late, inexplicable failure". `toggleFlow` enforces it in
// both directions. These pins reach the same state through the OTHER doors and
// assert what each one does instead:
//
//   - REGISTRATION (create, republish, upgrade, hot reload, a cold boot) is ONE
//     gate, not a refusal: `activateFlowTrigger` — the single arming gate every
//     arming path crosses — declines to arm a packaged caller whose packaged
//     subflow is disabled. The caller registers and stays unarmed: `/_status`
//     reports it `bound: false` with the reason, and the engine warns naming
//     the subflow. ⛔ Registration itself is never refused — boot and upgrade
//     must not fail on an installation's choice.
//   - A declined caller is armed the moment its subflow is enabled, through the
//     same gate — otherwise "stays unarmed" would be a new silent state that
//     only a restart ends.
//   - REMOVAL (`unregisterFlow`, the `DELETE /automation/:name` door) of a
//     packaged subflow a packaged caller can still reach is refused with the
//     disable direction's refusal family: `DELETE_RESTRICTED` / 409, the
//     callers named, a step that completes.
//   - An artifact reload that WITHDRAWS flows (a package upgrade or uninstall)
//     is not that door: what it removes is the package's own decision.
//
// Each pin drives the door from outside and reads the state off the trigger,
// the `/_status` row and the log — never off the gate's body.

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, NodeExecutor } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { withScheduledWorkOn } from './deployment-switch.test-support.js';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** Every `warn` line the engine logged. */
const warnings = (logger: any): string[] => logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));

/** The engine's arming-gate warnings for `caller`. */
const declineWarnings = (logger: any, caller: string): string[] =>
    warnings(logger).filter((m) => m.includes(`Flow '${caller}'`) && m.includes('NOT armed'));

/** A recording trigger: binding state is read off the trigger, never inferred. */
function recordingTrigger(type = 'record_change') {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type,
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n) };
}

/** The row `GET /automation/_status` serves for one flow. */
function stateOf(engine: AutomationEngine, name: string) {
    return engine.getFlowRuntimeStates().find((s) => s.name === name);
}

const ON_CREATE = { objectName: 'lead', triggerType: 'record-after-create' };

const nodeCtx = { logger: createTestLogger(), getService: () => undefined } as any;

/** A pause point any raw `resume()` may continue, as an approval or a wait would park a run. */
const PAUSER = {
    type: 'pauser',
    descriptor: defineActionDescriptor({
        type: 'pauser', version: '1.0.0', name: 'pauser',
        supportsPause: true, resumeAuthority: 'any',
    }),
    async execute() { return { success: true, suspend: true }; },
} as NodeExecutor;

/**
 * A packaged flow: `start → [hold] → [call each target] → end`. Record-triggered
 * unless `trigger: false`, so the arming gate is what decides whether it binds.
 */
function flow(
    name: string,
    opts: {
        calls?: string[];
        nodeType?: 'subflow' | 'map';
        hold?: boolean;
        trigger?: boolean;
        status?: string;
        packaged?: boolean;
    } = {},
) {
    const start = opts.trigger === false ? {} : ON_CREATE;
    const nodes: Array<Record<string, unknown>> = [{ id: 'start', type: 'start', label: 'Start', config: start }];
    if (opts.hold) nodes.push({ id: 'hold', type: 'pauser', label: 'Hold' });
    (opts.calls ?? []).forEach((target, i) => {
        nodes.push({
            id: `call_${i}`,
            type: opts.nodeType ?? 'subflow',
            label: `Call ${target}`,
            config: { flowName: target, ...(opts.nodeType === 'map' ? { collection: [1] } : {}) },
        });
    });
    nodes.push({ id: 'end', type: 'end', label: 'End' });
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes,
        edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id as string, target: n.id as string })),
        ...(opts.status !== undefined ? { status: opts.status } : {}),
        // ADR-0029 D9.6 provenance: shipped by a code package, unless the customer authored it.
        ...(opts.packaged === false ? {} : { _packageId: 'crm' }),
    };
}

/** An engine over an in-memory activation ledger, with a `record_change` trigger registered. */
function engineWithLedger() {
    const logger = createTestLogger();
    const engine = withLoaderSetFromPull(new AutomationEngine(logger));
    const ledger = new InMemoryFlowActivationStore();
    engine.setFlowActivationStore(ledger);
    registerSubflowNode(engine, nodeCtx);
    registerMapNode(engine, nodeCtx);
    engine.registerNodeExecutor(PAUSER);
    const trigger = recordingTrigger();
    engine.registerTrigger(trigger.trigger);
    return { engine, ledger, logger, trigger };
}

/** The synchronous refusal `unregisterFlow` throws — the one the `DELETE` route relays. */
function refusedRemoval(engine: AutomationEngine, name: string, callers: string[]): any {
    let thrown: any;
    try {
        engine.unregisterFlow(name);
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `removing '${name}' was accepted`).toBeDefined();
    // ADR-0112 envelope: code AND status — the disable direction's family.
    expect(thrown.code).toBe('DELETE_RESTRICTED');
    expect(thrown.status).toBe(409);
    expect(thrown.subflowCallers).toEqual(callers);
    expect(thrown.message).toContain(`Flow '${name}' cannot be removed`);
    expect(thrown.message).toContain('ADR-0126 §7.3');
    expect(thrown.message).toContain('or leave this one registered');
    return thrown;
}

// Time-triggered kinds arm only where package-authored scheduled work runs;
// the pins here are record-triggered, but the harness shape is shared.
withScheduledWorkOn();

// ─────────────────────────────────────────────────────────────────────────────
// Registration — one gate, not a refusal
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 at REGISTRATION — the arming gate declines a packaged caller onto a disabled packaged subflow', () => {
    it('CREATE: a new packaged caller onto a switched-off subflow registers, stays unarmed, and the engine warns naming the subflow', async () => {
        const { engine, logger, trigger } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        await engine.toggleFlow('shared_step', false);

        const registered = engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));

        // Registration itself is not refused.
        expect(registered.name).toBe('vendor_process');
        expect(await engine.getFlow('vendor_process')).not.toBeNull();
        // ...and the caller is not armed.
        expect(trigger.isBound('vendor_process')).toBe(false);
        const row = stateOf(engine, 'vendor_process');
        expect(row).toMatchObject({ enabled: true, bound: false });
        expect(row?.reason).toContain("'shared_step'");
        expect(row?.reason).toContain('ADR-0126 §7.3');
        const declined = declineWarnings(logger, 'vendor_process');
        expect(declined).toHaveLength(1);
        expect(declined[0]).toContain("'shared_step' (switched off in the activation ledger)");

        // Said once per decline: re-registering the same definition (a hot
        // reload, the kernel:ready re-bind) records it again and says nothing new.
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(declineWarnings(logger, 'vendor_process')).toHaveLength(1);
    });

    it('REPUBLISH: an armed packaged caller republished to call a switched-off subflow is disarmed, and the warning names that subflow only', async () => {
        const { engine, logger, trigger } = engineWithLedger();
        engine.registerFlow('step_a', flow('step_a', { trigger: false }));
        engine.registerFlow('step_b', flow('step_b', { trigger: false }));
        await engine.toggleFlow('step_b', false);
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['step_a'] }));
        expect(trigger.isBound('vendor_process')).toBe(true);

        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['step_a', 'step_b'] }));

        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: false });
        const declined = declineWarnings(logger, 'vendor_process');
        expect(declined).toHaveLength(1);
        expect(declined[0]).toContain("'step_b'");
        expect(declined[0]).not.toContain("'step_a'");
    });

    it('REPUBLISH of the subflow: republished `obsolete` under an armed caller disarms the caller; republished `active` arms it again', async () => {
        const { engine, logger, trigger } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        expect(trigger.isBound('vendor_process')).toBe(true);

        engine.registerFlow('shared_step', flow('shared_step', { trigger: false, status: 'obsolete' }));

        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: false });
        expect(declineWarnings(logger, 'vendor_process')[0]).toContain("'shared_step' (its definition's status is 'obsolete')");

        engine.registerFlow('shared_step', flow('shared_step', { trigger: false, status: 'active' }));

        expect(trigger.isBound('vendor_process')).toBe(true);
        expect(stateOf(engine, 'vendor_process')?.reason).toBeUndefined();
        expect((await engine.execute('vendor_process')).success).toBe(true);
    });

    it('COLD BOOT: pulled before the ledger is read and bound only when the trigger registers at kernel:ready, the caller stays unarmed with its reason', async () => {
        const ledger = new InMemoryFlowActivationStore();
        await ledger.setActive({ name: 'shared_step', packageId: 'crm', active: false });
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        engine.setFlowActivationStore(ledger);
        registerSubflowNode(engine, nodeCtx);

        // `plugin.ts`'s order: the pull, then the ledger, then the trigger plugins at kernel:ready.
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        await engine.hydrateFlowActivations();
        const trigger = recordingTrigger();
        engine.registerTrigger(trigger.trigger);

        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: false });
        // The kernel:bootstrapped audit carries the gate's reason — ⛔ never "binding failed".
        const audit = engine.getTriggerBindingAudit().find((e) => e.flowName === 'vendor_process');
        expect(audit?.reason).toContain("'shared_step'");
        expect(audit?.reason).not.toMatch(/binding failed/);
        expect(declineWarnings(logger, 'vendor_process')).toHaveLength(1);
    });

    it('HYDRATION: a caller armed before the ledger was read is disarmed when hydration switches its subflow off', async () => {
        const ledger = new InMemoryFlowActivationStore();
        await ledger.setActive({ name: 'shared_step', packageId: 'crm', active: false });
        const logger = createTestLogger();
        const engine = withLoaderSetFromPull(new AutomationEngine(logger));
        engine.setFlowActivationStore(ledger);
        registerSubflowNode(engine, nodeCtx);
        // A host whose trigger is registered before its flows are pulled.
        const trigger = recordingTrigger();
        engine.registerTrigger(trigger.trigger);
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        expect(trigger.isBound('vendor_process')).toBe(true);

        await engine.hydrateFlowActivations();

        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: false });
        expect(declineWarnings(logger, 'vendor_process')).toHaveLength(1);
    });

    it('CONTROL: an ENABLED packaged subflow still arms its caller — no warning, no reason', async () => {
        const { engine, logger, trigger } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));

        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));

        expect(trigger.isBound('vendor_process')).toBe(true);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: true });
        expect(stateOf(engine, 'vendor_process')?.reason).toBeUndefined();
        expect(declineWarnings(logger, 'vendor_process')).toEqual([]);
        expect((await engine.execute('vendor_process')).success).toBe(true);
    });

    it('CONTROL: a caller the customer authored is armed onto a switched-off packaged subflow — the gate judges packaged callers only', async () => {
        const { engine, trigger } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        await engine.toggleFlow('shared_step', false);

        engine.registerFlow('my_own_process', flow('my_own_process', { calls: ['shared_step'], packaged: false }));

        expect(trigger.isBound('my_own_process')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A declined caller is armed the moment its subflow is enabled
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 — a caller the gate declined is armed the moment its subflow is enabled, through the same gate', () => {
    for (const nodeType of ['subflow', 'map'] as const) {
        it(`the ${nodeType} pair: switching the subflow on through the toggle arms the declined caller, and it runs`, async () => {
            const { engine, trigger } = engineWithLedger();
            engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
            await engine.toggleFlow('shared_step', false);
            engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'], nodeType }));
            expect(trigger.isBound('vendor_process')).toBe(false);

            await engine.toggleFlow('shared_step', true);

            expect(trigger.isBound('vendor_process')).toBe(true);
            expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: true });
            expect(stateOf(engine, 'vendor_process')?.reason).toBeUndefined();
            expect((await engine.execute('vendor_process')).success).toBe(true);
        });
    }

    it('a caller declined on TWO subflows stays unarmed until both are on', async () => {
        const { engine, trigger } = engineWithLedger();
        engine.registerFlow('step_a', flow('step_a', { trigger: false }));
        engine.registerFlow('step_b', flow('step_b', { trigger: false }));
        await engine.toggleFlow('step_a', false);
        await engine.toggleFlow('step_b', false);
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['step_a', 'step_b'] }));

        await engine.toggleFlow('step_a', true);
        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')?.reason).toContain("'step_b'");

        await engine.toggleFlow('step_b', true);
        expect(trigger.isBound('vendor_process')).toBe(true);
    });

    it('a ledger-disabled CYCLE: switching the first flow on is accepted but leaves it unarmed until its partner is on — then both are armed', async () => {
        const { engine, trigger } = engineWithLedger();
        engine.registerFlow('ping', flow('ping', { trigger: false }));
        engine.registerFlow('pong', flow('pong', { trigger: false }));
        await engine.toggleFlow('ping', false);
        await engine.toggleFlow('pong', false);
        // A package upgrade then makes them call each other.
        engine.registerFlow('ping', flow('ping', { calls: ['pong'] }));
        engine.registerFlow('pong', flow('pong', { calls: ['ping'] }));

        // The toggle's cycle exemption still lets every order complete...
        await expect(engine.toggleFlow('ping', true)).resolves.toBeUndefined();
        // ...but an enabled caller is never ARMED onto a switched-off child.
        expect(trigger.isBound('ping')).toBe(false);

        await expect(engine.toggleFlow('pong', true)).resolves.toBeUndefined();
        expect(trigger.isBound('pong')).toBe(true);
        expect(trigger.isBound('ping')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removal — the disable direction's refusal family, through `unregisterFlow`
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 at REMOVAL — unregistering a packaged subflow a packaged caller can still reach is refused', () => {
    it('refuses removing a subflow an ARMED packaged caller calls, synchronously, with the envelope; nothing moves', async () => {
        const { engine, trigger } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));

        const thrown = refusedRemoval(engine, 'shared_step', ['vendor_process']);
        expect(thrown.message).toContain("Disable the calling flow 'vendor_process' first");

        // Refused means nothing moved: still registered, the caller still armed and running.
        expect(await engine.getFlow('shared_step')).not.toBeNull();
        expect(trigger.isBound('vendor_process')).toBe(true);
        expect((await engine.execute('vendor_process')).success).toBe(true);
    });

    it('the remedy completes: disable the caller, switch the subflow off — the door that reads parked runs — then remove it', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        refusedRemoval(engine, 'shared_step', ['vendor_process']);

        await engine.toggleFlow('vendor_process', false);
        const second = refusedRemoval(engine, 'shared_step', ['vendor_process']);
        expect(second.message).toContain("Switch 'shared_step' off first");
        expect(second.message).not.toContain('Disable the calling flow');

        await engine.toggleFlow('shared_step', false);
        expect(() => engine.unregisterFlow('shared_step')).not.toThrow();
        expect(await engine.getFlow('shared_step')).toBeNull();
    });

    it('a switched-off caller still holding a parked run: removal defers to the disable door, which names the run; after the cancel both complete', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { trigger: false, hold: true, calls: ['shared_step'] }));
        const started = await engine.execute('vendor_process');
        expect(started.status).toBe('paused');
        const runId = started.runId!;
        await engine.toggleFlow('vendor_process', false);

        const thrown = refusedRemoval(engine, 'shared_step', ['vendor_process']);
        expect(thrown.message).toContain("Switch 'shared_step' off first");

        // The door the refusal names reads the parked run and names it.
        const disable = await engine.toggleFlow('shared_step', false).then(() => undefined, (e: any) => e);
        expect(disable?.code).toBe('DELETE_RESTRICTED');
        expect(disable?.status).toBe(409);
        expect(disable?.message).toContain(`'${runId}'`);

        expect(await engine.cancelRun(runId, 'removing the subflow')).toBe(true);
        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
        expect(() => engine.unregisterFlow('shared_step')).not.toThrow();
        expect(await engine.getFlow('shared_step')).toBeNull();
    });

    it('CONTROL: a subflow already switched off, whose packaged callers are all switched off, is removed at once', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('vendor_process', flow('vendor_process', { calls: ['shared_step'] }));
        await engine.toggleFlow('vendor_process', false);
        await engine.toggleFlow('shared_step', false);

        expect(() => engine.unregisterFlow('shared_step')).not.toThrow();
        expect(await engine.getFlow('shared_step')).toBeNull();
    });

    it('CONTROL: a packaged subflow no packaged flow calls — or only a flow the customer authored calls — is removed', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('lonely', flow('lonely', { trigger: false }));
        engine.registerFlow('shared_step', flow('shared_step', { trigger: false }));
        engine.registerFlow('my_own_process', flow('my_own_process', { calls: ['shared_step'], packaged: false }));

        expect(() => engine.unregisterFlow('lonely')).not.toThrow();
        expect(() => engine.unregisterFlow('shared_step')).not.toThrow();
        expect(await engine.getFlow('lonely')).toBeNull();
        expect(await engine.getFlow('shared_step')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Through the plugin: the artifact reload (a package upgrade, an uninstall, a dev reload)
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 through the artifact reload (metadata:reloaded)', () => {
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));

    /** A mutable `protocol` service exposing the flow view the re-sync reads. */
    function fakeProtocolService(initial: unknown[]) {
        let flows = initial;
        return {
            service: {
                async getMetaItemsForExecution(q: { type: string }) {
                    return { items: q.type === 'flow' ? flows : [] };
                },
                // [#20761] The loader's set, as the real protocol answers it:
                // the package that ships the name, read from what this fake
                // artifact carries — the reader the plugin hands the engine.
                packagedArtifactOwner(q: { type: string; name: string }) {
                    if (q.type !== 'flow') return undefined;
                    const hit = (flows as Array<{ name?: string; _packageId?: string }>).find((f) => f.name === q.name);
                    return hit?._packageId || undefined;
                },
            },
            setFlows: (next: unknown[]) => { flows = next; },
        };
    }

    async function bootKernel(proto: { service: unknown }) {
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use({
            name: 'test.harness',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: [] as string[],
            async init(ctx: any) {
                ctx.registerService('protocol', proto.service);
            },
            async start() {},
        } as never);
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        return kernel;
    }

    const reload = (kernel: LiteKernel) => (kernel as any).context.trigger('metadata:reloaded', {});

    it('UPGRADE / HOT RELOAD: a reload that adds a packaged caller onto a switched-off subflow registers it unarmed', async () => {
        const proto = fakeProtocolService([flow('shared_step', { trigger: false })]);
        const kernel = await bootKernel(proto);
        const engine = kernel.getService<AutomationEngine>('automation');
        const trigger = recordingTrigger();
        engine.registerTrigger(trigger.trigger);
        await engine.toggleFlow('shared_step', false);

        proto.setFlows([flow('shared_step', { trigger: false }), flow('vendor_process', { calls: ['shared_step'] })]);
        await reload(kernel);
        await flush();

        expect(await engine.getFlow('vendor_process')).not.toBeNull();
        expect(trigger.isBound('vendor_process')).toBe(false);
        expect(stateOf(engine, 'vendor_process')).toMatchObject({ enabled: true, bound: false });

        await kernel.shutdown();
    });

    it('UNINSTALL: a reload that withdraws both a caller and its subflow unregisters both, whichever the artifact listed first', async () => {
        for (const order of [['shared_step', 'vendor_process'], ['vendor_process', 'shared_step']]) {
            const defs: Record<string, unknown> = {
                shared_step: flow('shared_step', { trigger: false }),
                vendor_process: flow('vendor_process', { calls: ['shared_step'] }),
            };
            const proto = fakeProtocolService(order.map((n) => defs[n]));
            const kernel = await bootKernel(proto);
            const engine = kernel.getService<AutomationEngine>('automation');
            const trigger = recordingTrigger();
            engine.registerTrigger(trigger.trigger);
            expect(trigger.isBound('vendor_process')).toBe(true);

            proto.setFlows([]);
            await reload(kernel);
            await flush();

            expect(await engine.listFlows(), `order ${order.join(', ')}`).toEqual([]);
            expect(trigger.isBound('vendor_process')).toBe(false);

            await kernel.shutdown();
        }
    });
});
