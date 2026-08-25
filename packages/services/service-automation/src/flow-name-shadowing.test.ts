// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11997] A runtime-authored flow reusing a packaged flow's name must not
// silently and non-deterministically replace it.
//
// MEASURED BEFORE THE FIX (this is what these tests were written against):
// with a real `SchemaRegistry` and a real `AutomationEngine`, registering the
// package first armed the RUNTIME body, and registering the runtime row first
// armed the PACKAGED body. Same two definitions, opposite outcomes, decided by
// nothing but Map iteration order — and `listFlows()` returned exactly one
// name in BOTH cases, so nothing observable distinguished them.
//
// Worse, in the ONE ordering where `Registry.registerItem` does emit its
// `[Registry] Collision` warning (a runtime row exists, then a package ships
// the name), the warning promises "the runtime row will shadow the package
// value" while the engine armed the PACKAGED body — the warning was actively
// contradicted by the thing it warned about.
//
// The direction asserted here is NOT chosen by this test. ADR-0048 §1.5 lists
// the runtime/DB overlay as "the sanctioned override path" and §3.4 routes it
// to "the ADR-0005 overlay precedence"; ADR-0005 states that precedence as
// `sys_metadata … ← overlay (wins)` over `SchemaRegistry … ← artifact default`.
// Runtime wins. If that direction is ever revisited, this file is one of the
// places the decision has to be re-argued — do not flip it to match code.

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { AutomationEngine } from './engine.js';
import { resolveFlowPrecedence, describeFlowContender } from './flow-precedence.js';

const FLOW = 'opportunity_approval';
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

function flowBody(name: string, marker: string) {
    return {
        name,
        label: marker,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

const packagedBody = () => ({ ...flowBody(FLOW, 'PACKAGED'), _packageId: 'crm' });
const runtimeBody = () => ({ ...flowBody(FLOW, 'RUNTIME') });

/** A registry holding both contenders, registered in the given order. */
function registryWithBoth(order: 'package-first' | 'runtime-first') {
    const registry: any = new SchemaRegistry();
    if (order === 'package-first') {
        registry.registerItem('flow', packagedBody(), 'name', 'crm');
        registry.registerItem('flow', runtimeBody(), 'name');
    } else {
        registry.registerItem('flow', runtimeBody(), 'name');
        registry.registerItem('flow', packagedBody(), 'name', 'crm');
    }
    return registry;
}

/**
 * The boot pull, reduced to the two steps under test: resolve precedence, then
 * register the winners. Mirrors `plugin.ts`'s flow pull — see the comment there.
 */
function bootPull(registry: any, logger: { warn(m: string, meta?: unknown): void } = silentLogger) {
    const engine = new AutomationEngine(silentLogger);
    const listed = registry.listItems('flow') as unknown[];
    const resolved = resolveFlowPrecedence(listed, logger);
    for (const entry of resolved) {
        engine.registerFlow(entry.name, entry.definition as never);
        if (entry.shadowing) engine.recordFlowShadowing(entry.shadowing);
    }
    return { engine, listed, resolved };
}

describe('#11997 — packaged flow shadowed by a same-named runtime flow', () => {
    it('the registry still returns BOTH contenders (ADR-0048 §3.4 coexistence is untouched)', () => {
        // The fix must NOT dedup in the registry: two entries under one bare
        // name is deliberate there, and package-scoped getItem depends on it.
        for (const order of ['package-first', 'runtime-first'] as const) {
            const listed = registryWithBoth(order).listItems('flow') as any[];
            expect(listed).toHaveLength(2);
            expect(listed.map((i) => i.label).sort()).toEqual(['PACKAGED', 'RUNTIME']);
        }
    });

    it('arms the SAME definition regardless of registration order (Map order no longer decides)', async () => {
        const first = bootPull(registryWithBoth('package-first'));
        const second = bootPull(registryWithBoth('runtime-first'));

        const armedFirst = (await first.engine.getFlow(FLOW)) as any;
        const armedSecond = (await second.engine.getFlow(FLOW)) as any;

        // Pre-fix these were 'RUNTIME' and 'PACKAGED' respectively.
        expect(armedFirst?.label).toBe('RUNTIME');
        expect(armedSecond?.label).toBe('RUNTIME');
        expect(armedFirst?.label).toBe(armedSecond?.label);
    });

    it('arms the runtime overlay over the packaged artifact (ADR-0005 direction)', async () => {
        const { engine } = bootPull(registryWithBoth('package-first'));
        const armed = (await engine.getFlow(FLOW)) as any;
        expect(armed?.label).toBe('RUNTIME');
        expect(armed?._packageId).toBeUndefined();
    });

    it('registers ONE flow per bare name, not one per definition', async () => {
        const { engine, listed, resolved } = bootPull(registryWithBoth('package-first'));
        expect(listed).toHaveLength(2); // two candidates in
        expect(resolved).toHaveLength(1); // one armed out
        expect(await engine.listFlows()).toEqual([FLOW]);
    });

    it('warns loudly, naming the bare name, BOTH contenders, and which is armed', () => {
        const warn = vi.fn();
        bootPull(registryWithBoth('package-first'), { warn });

        expect(warn).toHaveBeenCalledTimes(1);
        const [message, meta] = warn.mock.calls[0] as [string, any];

        expect(message).toContain(FLOW); // the bare name
        expect(message).toContain('package "crm"'); // contender A
        expect(message).toContain('runtime-authored row'); // contender B
        expect(message).toContain('arming a runtime-authored row'); // which one wins
        expect(message).toContain('ADR-0005');
        // A single line: the boot diagnostic buffer keeps only the line
        // carrying the level prefix (#5048).
        expect(message).not.toContain('\n');

        expect(meta.flow).toBe(FLOW);
        expect(meta.armed).toEqual({ source: 'runtime' });
        expect(meta.shadowed).toEqual([{ source: 'package', packageId: 'crm' }]);
    });

    it('leaves an admin-visible receipt for the shadowed definition', () => {
        const { engine } = bootPull(registryWithBoth('package-first'));

        // The dedicated audit, beside getTriggerBindingAudit.
        expect(engine.getShadowedFlows()).toEqual([
            {
                name: FLOW,
                armed: { source: 'runtime' },
                shadowed: [{ source: 'package', packageId: 'crm' }],
            },
        ]);

        // …and on the row an admin already reads. Without these two fields the
        // displaced definition is invisible: this map holds one entry per name.
        const states = engine.getFlowRuntimeStates();
        expect(states).toHaveLength(1);
        expect(states[0].name).toBe(FLOW);
        expect(states[0].armedFrom).toEqual({ source: 'runtime' });
        expect(states[0].shadowed).toEqual([{ source: 'package', packageId: 'crm' }]);
    });

    it('says nothing and attaches nothing when a name has only one definition', () => {
        const warn = vi.fn();
        const registry: any = new SchemaRegistry();
        registry.registerItem('flow', packagedBody(), 'name', 'crm');
        const { engine, resolved } = bootPull(registry, { warn });

        expect(warn).not.toHaveBeenCalled();
        expect(resolved).toHaveLength(1);
        expect(engine.getShadowedFlows()).toEqual([]);
        const [state] = engine.getFlowRuntimeStates();
        expect(state.armedFrom).toBeUndefined();
        expect(state.shadowed).toBeUndefined();
    });
});

describe('#11997 — precedence is a total order, not an iteration order', () => {
    it('two packages shipping one bare name resolve by packageId, either way round', () => {
        const a = { ...flowBody(FLOW, 'FROM_ALPHA'), _packageId: 'alpha' };
        const b = { ...flowBody(FLOW, 'FROM_BETA'), _packageId: 'beta' };

        const forward = resolveFlowPrecedence([a, b], silentLogger);
        const backward = resolveFlowPrecedence([b, a], silentLogger);

        expect((forward[0].definition as any).label).toBe('FROM_ALPHA');
        expect((backward[0].definition as any).label).toBe('FROM_ALPHA');
        expect(forward[0].shadowing?.shadowed).toEqual([{ source: 'package', packageId: 'beta' }]);
    });

    it('preserves first-seen order for the non-colliding names around a collision', () => {
        const before = { ...flowBody('aaa_first', 'A') };
        const after = { ...flowBody('zzz_last', 'Z') };
        const resolved = resolveFlowPrecedence(
            [before, packagedBody(), after, runtimeBody()],
            silentLogger,
        );
        expect(resolved.map((r) => r.name)).toEqual(['aaa_first', FLOW, 'zzz_last']);
    });

    it('classifies the sys_metadata rehydration sentinel as runtime, not as a package', () => {
        // `loadMetaFromDb` rehydrates overlay rows with a synthetic
        // `_packageId = 'sys_metadata'` (ADR-0005 §Provenance edge case). A
        // bare `_packageId` truthiness test would misread it as packaged.
        expect(describeFlowContender({ name: FLOW, _packageId: 'sys_metadata' })).toEqual({
            source: 'runtime',
            packageId: 'sys_metadata',
        });
        // And a tenant-authored overlay bound to a REAL package id is runtime
        // too — provenance is the axis, not the id (cloud#970).
        expect(
            describeFlowContender({ name: FLOW, _packageId: 'app.built_by_studio', _provenance: 'org' }),
        ).toEqual({ source: 'runtime', packageId: 'app.built_by_studio' });
        expect(describeFlowContender({ name: FLOW, _packageId: 'crm' })).toEqual({
            source: 'package',
            packageId: 'crm',
        });
    });

    it('a tenant overlay beats the package even when both carry a real package id', () => {
        const packaged = { ...flowBody(FLOW, 'PACKAGED'), _packageId: 'crm' };
        const tenant = { ...flowBody(FLOW, 'TENANT'), _packageId: 'crm', _provenance: 'org' };
        const resolved = resolveFlowPrecedence([packaged, tenant], silentLogger);
        expect((resolved[0].definition as any).label).toBe('TENANT');
    });
});
