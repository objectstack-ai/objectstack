// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26474] `toggleFlow`'s `caller` reaches the activation-ledger write.
//
// The flow door's `sys_metadata_activation` row and its audit row named nobody:
// the engine wrote through the ledger store's constant system context, and
// `IAutomationService.toggleFlow(name, enabled)` had no way to say who asked.
// The contract now carries `caller` (`{ userId }`, #26545). These cases pin the
// service half of the seam: the id the door hands in is the id the store is
// asked to write under, elevated, and nothing else of the caller's comes along.
// What the engine and the audit plugin then do with that context is pinned by
// the activation-ledger-actor dogfood file.

import { describe, it, expect, vi } from 'vitest';
import type { MetadataActivationWriteOptions } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import type { FlowActivationRow, FlowActivationStore } from './engine.js';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/** A packaged flow (ADR-0029 D9.6 provenance), so the toggle door accepts it. */
function packagedFlow(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: {} },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        _packageId: 'crm',
    };
}

/** A ledger store that records each write and the options it was handed. */
function recordingStore() {
    const writes: Array<{ row: FlowActivationRow; options: MetadataActivationWriteOptions | undefined }> = [];
    const store: FlowActivationStore = {
        list: async () => [],
        setActive: async (row: FlowActivationRow, options?: MetadataActivationWriteOptions) => {
            writes.push({ row, options });
        },
    };
    return { store, writes };
}

function engineWith(store: FlowActivationStore) {
    const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
    engine.setFlowActivationStore(store);
    engine.registerFlow('welcome', packagedFlow('welcome'));
    return engine;
}

describe('#26474 — toggleFlow writes the ledger row under the caller it was handed', () => {
    it('a caller with an id: the write runs as that user, elevated, in both directions', async () => {
        const { store, writes } = recordingStore();
        const engine = engineWith(store);

        await engine.toggleFlow('welcome', false, { userId: 'u_admin' });
        await engine.toggleFlow('welcome', true, { userId: 'u_admin' });

        expect(writes.map((w) => w.row.active)).toEqual([false, true]);
        for (const { options } of writes) {
            expect(options?.context).toEqual({ isSystem: true, positions: [], permissions: [], userId: 'u_admin' });
        }
    });

    it('the channel grants nothing: only the id crosses, whatever else the object carries', async () => {
        const { store, writes } = recordingStore();
        const engine = engineWith(store);

        // A JS caller is not held to the `Pick<AutomationContext, 'userId'>`
        // type. Grants it smuggles in must not reach the write's context.
        const caller = { userId: 'u_admin', positions: ['admin'], permissions: ['manage_metadata'], tenantId: 'org_1' };
        await engine.toggleFlow('welcome', false, caller as { userId: string });

        expect(writes[0].options?.context).toEqual({ isSystem: true, positions: [], permissions: [], userId: 'u_admin' });
    });

    it.each([
        ['no caller', undefined],
        ['a caller without an id', {}],
        ['a caller with an empty id', { userId: '' }],
    ])('%s: an unattributed write, under the store\'s own system context', async (_label, caller) => {
        const { store, writes } = recordingStore();
        const engine = engineWith(store);

        await engine.toggleFlow('welcome', false, caller);

        expect(writes).toHaveLength(1);
        expect(writes[0].options).toBeUndefined();
    });
});
