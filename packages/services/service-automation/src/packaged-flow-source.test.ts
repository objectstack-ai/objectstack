// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20761, ADR-0126 §7.2 / §7.3] Which flows are PACKAGED is the loader's set —
// the reader attached through `setPackagedFlowSource` — and never the stamps a
// definition carries.
//
// A definition reaches `registerFlow` through authoring doors too, so its
// provenance stamps are the caller's bytes. Every pin below attaches an
// EXPLICIT set that disagrees with the stamps, in both directions, and reads
// the answer off the engine's own outputs: the §7.3 refusal, the activation
// door's refusal envelope and the activation ledger's rows.
//
// The suites that pin the guard LOGIC stand the stamps in for the set
// (`loader-set.test-support.ts`); this file is what makes that stand-in honest.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import { InMemoryFlowActivationStore } from './flow-activation-store.js';
import { packagedFlowReader } from './plugin.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

function flowBody(name: string, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

function callerBody(name: string, target: string, extra: Record<string, unknown> = {}) {
    return {
        ...flowBody(name, extra),
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'call', type: 'subflow', label: 'Call', config: { flowName: target } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

/** The stamps a caller could send to claim a package's provenance. */
const ASSERTED = { _packageId: 'crm', _provenance: 'package' };

/** An engine with a ledger and an EXPLICIT loader's set. */
function engineWithSet(set: Record<string, string>) {
    const engine = new AutomationEngine(createTestLogger());
    const store = new InMemoryFlowActivationStore();
    engine.setFlowActivationStore(store);
    engine.setPackagedFlowSource((name) => set[name]);
    return { engine, store };
}

async function refusalOf(p: Promise<unknown>): Promise<Error & { code?: unknown; status?: unknown }> {
    try {
        await p;
    } catch (e) {
        return e as Error & { code?: unknown; status?: unknown };
    }
    throw new Error('expected a refusal, and the call was accepted');
}

describe('[#20761] the engine classifies a flow by the loader\'s set, not by its definition\'s stamps', () => {
    it('a customer flow stamped as a package\'s does not hold a packaged subflow\'s disable', async () => {
        const { engine, store } = engineWithSet({ shared_step: 'crm' });
        engine.registerFlow('shared_step', flowBody('shared_step'));
        engine.registerFlow('my_process', callerBody('my_process', 'shared_step', ASSERTED));

        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
        expect(await store.list()).toEqual([{ name: 'shared_step', packageId: 'crm', active: false }]);
    });

    it('control: a caller the set holds, with no stamps at all, does hold it', async () => {
        const { engine, store } = engineWithSet({ shared_step: 'crm', vendor_process: 'crm' });
        engine.registerFlow('shared_step', flowBody('shared_step'));
        engine.registerFlow('vendor_process', callerBody('vendor_process', 'shared_step'));

        const refusal = await refusalOf(engine.toggleFlow('shared_step', false));

        expect(refusal.code).toBe('DELETE_RESTRICTED');
        expect(refusal.status).toBe(409);
        expect(await store.list()).toEqual([]);
    });

    it('the removal door is guarded the same way: a stamped customer caller holds nothing, a set-held caller does', async () => {
        const { engine } = engineWithSet({ shared_step: 'crm', vendor_process: 'crm' });
        engine.registerFlow('shared_step', flowBody('shared_step'));
        engine.registerFlow('vendor_process', callerBody('vendor_process', 'shared_step'));
        expect(() => engine.unregisterFlow('shared_step')).toThrow(expect.objectContaining({ code: 'DELETE_RESTRICTED', status: 409 }));

        const other = engineWithSet({ shared_step: 'crm' });
        other.engine.registerFlow('shared_step', flowBody('shared_step'));
        other.engine.registerFlow('my_process', callerBody('my_process', 'shared_step', ASSERTED));
        expect(() => other.engine.unregisterFlow('shared_step')).not.toThrow();
        expect(await other.engine.getFlow('shared_step')).toBeNull();
    });

    it('the activation door refuses a customer flow stamped as a package\'s, and writes no row', async () => {
        const { engine, store } = engineWithSet({});
        engine.registerFlow('my_flow', flowBody('my_flow', ASSERTED));

        for (const enabled of [false, true]) {
            const refusal = await refusalOf(engine.toggleFlow('my_flow', enabled));
            expect(refusal.code).toBe('RESOURCE_CONFLICT');
            expect(refusal.status).toBe(409);
        }
        expect(await store.list()).toEqual([]);
    });

    it('an activation row is attributed to the package the SET names, never to the one the stamps name', async () => {
        const { engine, store } = engineWithSet({ vendor_flow: 'crm' });
        engine.registerFlow('vendor_flow', flowBody('vendor_flow', { _packageId: 'someone_else', _provenance: 'package' }));

        await engine.toggleFlow('vendor_flow', false);

        expect(await store.list()).toEqual([{ name: 'vendor_flow', packageId: 'crm', active: false }]);
    });

    it('a flow the set holds is packaged with no stamps on its definition at all', async () => {
        const { engine, store } = engineWithSet({ vendor_flow: 'crm' });
        engine.registerFlow('vendor_flow', flowBody('vendor_flow'));

        await engine.toggleFlow('vendor_flow', false);

        expect(await store.list()).toEqual([{ name: 'vendor_flow', packageId: 'crm', active: false }]);
        expect(engine.packagedFlowOwner('vendor_flow')).toBe('crm');
    });

    it('with no set attached no flow is packaged: the activation door refuses even a stamped one', async () => {
        const engine = new AutomationEngine(createTestLogger());
        const store = new InMemoryFlowActivationStore();
        engine.setFlowActivationStore(store);
        engine.registerFlow('vendor_flow', flowBody('vendor_flow', ASSERTED));

        const refusal = await refusalOf(engine.toggleFlow('vendor_flow', false));

        expect(refusal.code).toBe('RESOURCE_CONFLICT');
        expect(await store.list()).toEqual([]);
        expect(engine.packagedFlowOwner('vendor_flow')).toBeUndefined();
    });
});

describe('[#20761] the automation plugin hands the engine the metadata protocol\'s reading of the loader\'s set', () => {
    const ctxWith = (service: unknown) => ({
        getService: (name: string) => {
            if (name !== 'protocol' || service === undefined) throw new Error(`service '${name}' not found`);
            return service as never;
        },
    });

    it('asks the protocol\'s packagedArtifactOwner for the flow type, at question time', () => {
        const packagedArtifactOwner = vi.fn((q: { type: string; name: string }) => (q.name === 'vendor_flow' ? 'crm' : undefined));
        const read = packagedFlowReader(ctxWith({ packagedArtifactOwner }));

        expect(read('vendor_flow')).toBe('crm');
        expect(read('my_flow')).toBeUndefined();
        expect(packagedArtifactOwner).toHaveBeenCalledWith({ type: 'flow', name: 'vendor_flow' });
    });

    it('a composition with no protocol, or a protocol without the reader, packages nothing', () => {
        expect(packagedFlowReader(ctxWith(undefined))('vendor_flow')).toBeUndefined();
        expect(packagedFlowReader(ctxWith({}))('vendor_flow')).toBeUndefined();
    });

    it('a protocol that registers AFTER the reader was built is still read — nothing is recorded at boot', () => {
        let service: unknown;
        const read = packagedFlowReader({
            getService: (name: string) => {
                if (name !== 'protocol' || service === undefined) throw new Error(`service '${name}' not found`);
                return service as never;
            },
        });
        expect(read('vendor_flow')).toBeUndefined();

        service = { packagedArtifactOwner: () => 'crm' };

        expect(read('vendor_flow')).toBe('crm');
    });
});
