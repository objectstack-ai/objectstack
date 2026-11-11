// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4/D5, epic #31527 child B (flow), #31696 PR-2] Triggers and the
 * inbound hook dispatch by slot.
 *
 *  - A trigger arms each slot of a name two packages hold under the slot's
 *    key and fires that slot, never the bare name re-resolved at fire time.
 *    A name one package holds keeps today's binding and run (CONTROL).
 *  - When a second holder arrives the incumbent's binding is released before
 *    it is armed under its qualified key; an event the released binding still
 *    delivers runs nothing, so each slot fires once across the re-arm window,
 *    both ways.
 *  - The schedule and time-relative dispatch key of a slot is spelled with
 *    the flow's name and the slot's package: the key the slot claimed while
 *    it held the name alone.
 *  - The inbound hook: the qualified address reaches its namespace's slot,
 *    the bare address of a shared name is refused naming every holder, and a
 *    slot-key spelling reaches no hook.
 *  - Q4: an environment row over a shared name overlays neither holder; both
 *    packages' bodies arm, with one warning naming both and the row.
 *  - A slot switched off arms nothing; the other holder's binding stands.
 *
 * Over a real `SchemaRegistry` and the one package-scoped resolver, as
 * ./flow-slots-per-package.test.ts. Each negative pin was ablated once; the
 * readings are in the PR body.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { AutomationEngine } from './index.js';
import type { FlowTrigger, NodeExecutor } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { installBuiltinNodes } from './builtin/index.js';
import { flowNameResolver } from './plugin.js';
import { resolveFlowPrecedence } from './flow-precedence.js';

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';

function silentLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;

/** start (record-after-insert on `task`) → mark(tag) → end: the `mark` node records `tag` and the run's `params.flowName`. */
function triggered(name: string, tag: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-insert', objectName: 'task' } },
            { id: 'mark', type: 'mark', label: 'Mark', config: { tag } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mark' },
            { id: 'e2', source: 'mark', target: 'end' },
        ],
    };
}

let registry: SchemaRegistry;
let engine: AutomationEngine;
let loaderSets: Record<string, string[]>;
/** `tag` and `params.flowName` of every `mark` node that ran, in order. */
let ran: string[];
let named: unknown[];
/** The record-change stand-in: what it was handed, by key. */
let handlers: Map<string, (ctx: AutomationContext) => Promise<unknown>>;
let started: string[];
let stopped: string[];

function ship(packageId: string, body: { name: string }) {
    registry.registerItem('flow', { ...body, _packageId: packageId }, 'name' as never, packageId);
    loaderSets[body.name] = [...new Set([...(loaderSets[body.name] ?? []), packageId])];
    engine.registerFlow(body.name, body, { source: 'package', packageId, holder: packageId });
}

function withdraw(packageId: string, name: string) {
    registry.unregisterItemsByPackage(packageId);
    loaderSets[name] = (loaderSets[name] ?? []).filter((p) => p !== packageId);
    engine.withdrawFlowSlot(packageId, name);
}

/** Fire what the trigger was handed under `key`, as the trigger would on one event. */
const fire = (key: string) => handlers.get(key)!({ event: 'record-after-insert', params: { flowName: key } } as AutomationContext);

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    loaderSets = {};
    ran = [];
    named = [];
    handlers = new Map();
    started = [];
    stopped = [];
    const ctx: any = {
        logger: silentLogger(),
        getService(name: string) {
            if (name === 'objectql') return { registry };
            throw new Error(`no ${name}`);
        },
    };
    engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, ctx);
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(node: { config?: { tag?: string } }, _vars: unknown, context: AutomationContext) {
            ran.push(String(node.config?.tag));
            named.push((context.params as { flowName?: unknown } | undefined)?.flowName);
            return { success: true };
        },
    } as unknown as NodeExecutor);
    engine.setPackagedFlowSource((name, packageId) => {
        const holders = loaderSets[name] ?? [];
        if (packageId !== undefined) return holders.includes(packageId) ? packageId : undefined;
        return holders.length === 1 ? holders[0] : undefined;
    });
    engine.setFlowNameResolver(flowNameResolver(ctx));
    engine.registerTrigger({
        type: 'record_change',
        start: (binding: { flowName: string }, handler: (ctx: AutomationContext) => Promise<unknown>) => {
            started.push(binding.flowName);
            handlers.set(binding.flowName, handler);
        },
        stop: (key: string) => { stopped.push(key); },
    } as unknown as FlowTrigger);
    registry.installPackage(manifest(P1), 'code');
    registry.installPackage(manifest(P2), 'code');
});

describe('#31696 PR-2 a trigger dispatches the slot that armed it', () => {
    it('CONTROL: a name one package holds is bound under its bare name and runs as before', async () => {
        ship(P1, triggered('t', 'p1'));
        expect(started).toEqual(['t']);
        await fire('t');
        expect(ran).toEqual(['p1']);
        expect(named).toEqual(['t']);
        // The dispatch key's coordinates are today's: no `name` member.
        expect(engine.flowDispatchHolder('t')).toEqual({ packageId: P1, claimBare: true });
        // The hook is judged as before.
        expect(engine.inboundHookSlot('t')).toBeUndefined();
        expect(engine.inboundHookSlot('t', { qualifier: 'alpha', namespaceOwners: [P1] })).toBeUndefined();
    });

    it('each slot of a shared name fires its own body, and its run reads the flow\'s name in params', async () => {
        ship(P1, triggered('t', 'p1'));
        ship(P2, triggered('t', 'p2'));
        await fire(`${P2}/t`);
        await fire(`${P1}/t`);
        expect(ran).toEqual(['p2', 'p1']);
        expect(named).toEqual(['t', 't']);
    });

    it('a slot fires its own body after the bare name was refused: it never re-resolves the name at fire time', async () => {
        ship(P1, triggered('t', 'p1'));
        ship(P2, triggered('t', 'p2'));
        expect((await engine.execute('t')).success).toBe(false);
        await fire(`${P1}/t`);
        expect(ran).toEqual(['p1']);
    });

    it('red line: the binding released by a re-arm runs nothing, so each slot fires once — forward and back', async () => {
        ship(P1, triggered('t', 'p1'));
        const bare = handlers.get('t')!;
        ship(P2, triggered('t', 'p2'));
        // The event the released bare binding still delivers (its cancel had not landed).
        await bare({ event: 'record-after-insert' } as AutomationContext);
        expect(ran).toEqual([]);
        await fire(`${P1}/t`);
        expect(ran).toEqual(['p1']);

        const qualified = handlers.get(`${P1}/t`)!;
        withdraw(P2, 't');
        expect(started.slice(-1)).toEqual(['t']);
        await qualified({ event: 'record-after-insert' } as AutomationContext);
        expect(ran).toEqual(['p1']);
        await fire('t');
        expect(ran).toEqual(['p1', 'p1']);
    });

    it('a slot\'s dispatch key is spelled with the flow\'s name and its package, the key it claimed alone', () => {
        ship(P1, triggered('t', 'p1'));
        const alone = engine.flowDispatchHolder('t');
        ship(P2, triggered('t', 'p2'));
        expect(engine.flowDispatchHolder(`${P1}/t`)).toEqual({ packageId: P1, claimBare: false, name: 't' });
        expect(engine.flowDispatchHolder(`${P2}/t`)).toEqual({ packageId: P2, claimBare: false, name: 't' });
        expect(alone.packageId).toBe(P1);
        // The bare name two packages hold names neither: the collision guard, as before.
        expect(engine.flowDispatchHolder('t')).toEqual({ packageId: null, claimBare: false });
    });

    it('item 5: a slot switched off arms nothing and fires nothing; the other holder\'s binding stands', async () => {
        ship(P1, triggered('t', 'p1'));
        ship(P2, triggered('t', 'p2'));
        await engine.toggleFlowSlot(P1, 't', false);
        expect(stopped).toEqual(['t', `${P1}/t`]);
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).toEqual([`${P2}/t`]);
        await fire(`${P2}/t`);
        expect(ran).toEqual(['p2']);
        // Its hook address still routes to its slot, whose hook is not armed: the trigger answers it as a disabled flow's.
        expect(engine.inboundHookSlot('t', { qualifier: 'alpha', namespaceOwners: [P1] })).toEqual({ status: 'served', key: `${P1}/t` });
        await engine.toggleFlowSlot(P1, 't', true);
        expect(started.slice(-1)).toEqual([`${P1}/t`]);
    });
});

describe('#31696 PR-2 the inbound hook address of a shared name', () => {
    beforeEach(() => {
        ship(P1, triggered('t', 'p1'));
        ship(P2, triggered('t', 'p2'));
    });

    it('the qualified address reaches its namespace\'s slot', () => {
        expect(engine.inboundHookSlot('t', { qualifier: 'alpha', namespaceOwners: [P1] })).toEqual({ status: 'served', key: `${P1}/t` });
        expect(engine.inboundHookSlot('t', { qualifier: 'beta', namespaceOwners: [P2] })).toEqual({ status: 'served', key: `${P2}/t` });
    });

    it('red line: the bare address is refused naming both holders, never a pick', () => {
        expect(engine.inboundHookSlot('t')).toEqual({
            status: 'refused',
            candidates: [{ kind: 'package', packageId: P1 }, { kind: 'package', packageId: P2 }],
        });
    });

    it('red line: an address no slot answers, and a slot-key spelling, reach no hook', () => {
        expect(engine.inboundHookSlot('t', { qualifier: 'gamma', namespaceOwners: ['com.acme.gamma'] })).toEqual({ status: 'unadmitted' });
        expect(engine.inboundHookSlot('t', { qualifier: '_env', namespaceOwners: [] })).toEqual({ status: 'unadmitted' });
        expect(engine.inboundHookSlot(`${P1}/t`)).toEqual({ status: 'unadmitted' });
        expect(engine.inboundHookSlot(`${P1}/t`, { qualifier: 'alpha', namespaceOwners: [P1] })).toEqual({ status: 'unadmitted' });
    });
});

describe('#31696 PR-2 Q4: an environment row over a shared name', () => {
    it('overlays neither holder: both packages\' bodies arm their triggers, one warning names both and the row', async () => {
        loaderSets.t = [P1, P2];
        const reader = (name: string, packageId?: string) =>
            packageId === undefined ? undefined : (loaderSets[name] ?? []).includes(packageId) ? packageId : undefined;
        const logger = silentLogger();
        const code = (packageId: string, tag: string) => ({ ...triggered('t', tag), _packageId: packageId, _provenance: 'code' });
        const row = { ...triggered('t', 'env'), _provenance: 'org' };
        const winners = resolveFlowPrecedence([code(P1, 'p1'), row, code(P2, 'p2')], logger, reader, (() => undefined) as never);
        // Armed as the boot pull arms each winner (the display stamp left behind).
        for (const winner of winners) {
            const { _provenance: _display, ...body } = winner.definition as Record<string, unknown>;
            registry.registerItem('flow', body as never, 'name' as never, winner.holder!);
            engine.registerFlow(winner.name, body, { source: winner.contender.source, packageId: winner.contender.packageId, holder: winner.holder } as never);
        }
        expect(started).toEqual(['t', `${P1}/t`, `${P2}/t`]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [message, meta] = logger.warn.mock.calls[0];
        expect(message).toContain(`'${P1}', '${P2}'`);
        expect(message).toContain('Each package\'s flow is armed');
        expect(meta).toMatchObject({ flow: 't', holders: [P1, P2], overlays: [expect.objectContaining({ source: 'runtime' })] });
        await fire(`${P1}/t`);
        await fire(`${P2}/t`);
        expect(ran).toEqual(['p1', 'p2']);
        // The row itself is refused by the engine: it customizes neither.
        const { _provenance: _stamp, ...rowBody } = row;
        expect(() => engine.registerFlow('t', rowBody)).toThrow(/held by 2 packages/);
    });
});
