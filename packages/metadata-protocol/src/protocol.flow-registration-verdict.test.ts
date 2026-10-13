// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23316 — the meta read serves the automation engine's verdict on a stored
 * flow BESIDE the item, read from the kernel's service table by name.
 *
 * `registration` is an envelope sibling of `lock` on the item read, and
 * `registrations` (keyed by name) sits beside the list's items. Both are the
 * engine's answer (`IAutomationService.getFlowRegistration`) or nothing: the
 * protocol never makes one up, so a host with no automation service, or a
 * type the engine does not judge, reads no field at all. The stored body —
 * its `status` included — is served exactly as stored.
 *
 * The real composition (ObjectQL's protocol over SQLite, the real engine
 * refusing at the `kernel:ready` bind) is pinned in service-automation's
 * `flow-refused-registration-read.integration.test.ts`; `@objectstack/objectql`
 * cannot be imported here, as it depends on this package. The engine double
 * below is the by-name harness's (`protocol.flow-by-name-shipped-name.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import type { FlowRegistration } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const flowBody = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (type: string, name: string, body: unknown, state = 'active'): StoredRow => ({
    id: `r_${type}_${name}_${state}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state,
    metadata: JSON.stringify(body),
});

const REFUSED: FlowRegistration = { state: 'refused', reason: { code: 'SOME_ENGINE_CODE', message: 'the engine said no' } };

/** The engine's answers this double gives, per name; any other name reads `unregistered`. */
function automationDouble(answers: Record<string, FlowRegistration>) {
    return {
        getFlowRegistration: vi.fn((name: string): FlowRegistration => answers[name] ?? { state: 'unregistered' }),
    };
}

function harness(rows: StoredRow[], services: Map<string, unknown>) {
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        registry: {
            registerItem: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            getObject: () => undefined,
            registerObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>);
}

const ROWS = [
    storedRow('flow', 'refused_flow', flowBody('refused_flow')),
    storedRow('flow', 'live_flow', flowBody('live_flow')),
];

describe('the item read: `registration` beside `lock`, the engine\'s answer or nothing (#23316)', () => {
    it('serves what the engine answered for that name, and the stored body unchanged', async () => {
        const automation = automationDouble({ refused_flow: REFUSED, live_flow: { state: 'registered' } });
        const protocol = harness(ROWS, new Map([['automation', automation]]));

        const read: any = await protocol.getMetaItem({ type: 'flow', name: 'refused_flow' });

        expect(read.registration).toEqual(REFUSED);
        expect(automation.getFlowRegistration).toHaveBeenCalledWith('refused_flow');
        // Beside the item, never inside it — and the author's `status` as stored.
        expect(read.item.status).toBe('active');
        expect(read.item).not.toHaveProperty('registration');
        expect(read).toHaveProperty('lock');
    });

    it('control: no automation service, or one that declares no verdict member — no field at all', async () => {
        for (const services of [new Map(), new Map([['automation', { getFlow: async () => null }]])]) {
            const read: any = await harness(ROWS, services as Map<string, unknown>).getMetaItem({ type: 'flow', name: 'refused_flow' });
            expect(read.item.status).toBe('active');
            expect(read).not.toHaveProperty('registration');
        }
    });

    it('a type the automation engine does not judge reads no field, and the engine is never asked', async () => {
        const automation = automationDouble({});
        const protocol = harness(
            [storedRow('dashboard', 'sales', { name: 'sales', label: 'Sales', widgets: [] })],
            new Map([['automation', automation]]),
        );

        const read: any = await protocol.getMetaItem({ type: 'dashboard', name: 'sales' });

        expect(read.item).toBeTruthy();
        expect(read).not.toHaveProperty('registration');
        expect(automation.getFlowRegistration).not.toHaveBeenCalled();
    });

    it('a draft read carries none: the pending body is not what the engine holds', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const protocol = harness(
            [...ROWS, storedRow('flow', 'refused_flow', flowBody('refused_flow'), 'draft')],
            new Map([['automation', automation]]),
        );

        const read: any = await protocol.getMetaItem({ type: 'flow', name: 'refused_flow', state: 'draft' });

        expect(read.item).toBeTruthy();
        expect(read).not.toHaveProperty('registration');
    });
});

describe('the list: `registrations` beside the items, keyed by name (#23316)', () => {
    it('one entry per listed item, the engine\'s answer for each; the items stay bare', async () => {
        const automation = automationDouble({ refused_flow: REFUSED, live_flow: { state: 'registered' } });
        const protocol = harness(ROWS, new Map([['automation', automation]]));

        const list: any = await protocol.getMetaItems({ type: 'flow' });

        expect(list.registrations).toEqual({ refused_flow: REFUSED, live_flow: { state: 'registered' } });
        for (const item of list.items) expect(item).not.toHaveProperty('registration');
    });

    it('control: no automation service — no `registrations`; and the execution face never carries one', async () => {
        const bare: any = await harness(ROWS, new Map()).getMetaItems({ type: 'flow' });
        expect(bare.items).toHaveLength(2);
        expect(bare).not.toHaveProperty('registrations');

        const automation = automationDouble({ refused_flow: REFUSED });
        const execution: any = await harness(ROWS, new Map([['automation', automation]])).getMetaItemsForExecution({ type: 'flow' });
        expect(execution).not.toHaveProperty('registrations');
        expect(automation.getFlowRegistration).not.toHaveBeenCalled();
    });

    it('a pending draft overlaid on the list gets no entry', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const protocol = harness(
            [...ROWS, storedRow('flow', 'draft_only', flowBody('draft_only'), 'draft')],
            new Map([['automation', automation]]),
        );

        const list: any = await protocol.getMetaItems({ type: 'flow', previewDrafts: true });

        expect(list.items.map((i: any) => i.name)).toContain('draft_only');
        expect(Object.keys(list.registrations).sort()).toEqual(['live_flow', 'refused_flow']);
    });
});
