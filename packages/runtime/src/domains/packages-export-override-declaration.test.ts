// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D8 item 3 — "Export carries the declaration": `GET
 * /packages/<base>.custom/export` carries each overriding item with its
 * `overrides` block, and the exported body re-parses through the item's own
 * schema with the block intact, so the package travels to another environment
 * still saying what it overrides.
 *
 * The export strips provenance at the top level of each item (every
 * `_`-prefixed key and a fixed bookkeeping set). This file pins that the
 * declaration, an AUTHORED key, is not in that strip: measured through the
 * real door over a protocol double, never inferred from the key's spelling.
 *
 * The driver is the sibling package-door tests' (`packages-capability-gate.test.ts`):
 * `HttpDispatcher` over a fake kernel whose services are doubles.
 */

import { describe, it, expect, vi } from 'vitest';
import { FlowSchema } from '@objectstack/spec/automation';
import { AssembledViewArtifactSchema } from '@objectstack/spec/ui';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

const BASE = 'com.acme.crm';
const PAIR = (() => {
    const derived = customizationPackageId(BASE);
    if (!derived.ok) throw new Error('fixture base must have a pair');
    return derived.value;
})();
const DECLARATION = { package: BASE, basedOn: '3.2.0' };

/** What the protocol serves for the pair: one overriding flow and one overriding view item. */
const SERVED: Record<string, Array<Record<string, unknown>>> = {
    flow: [{
        name: 'crm_lead_assign',
        label: 'Assign leads',
        type: 'autolaunched',
        nodes: [],
        edges: [],
        overrides: DECLARATION,
        _packageId: PAIR,
        _provenance: 'org',
    }],
    view: [{
        name: 'crm_account.all',
        object: 'crm_account',
        viewKind: 'list',
        label: 'All accounts',
        config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: 'crm_account' } },
        overrides: DECLARATION,
        _packageId: PAIR,
    }],
};

function makeDoor() {
    const getMetaItems = vi.fn(async (req: { type: string; packageId: string }) => ({
        items: req.packageId === PAIR ? structuredClone(SERVED[req.type] ?? []) : [],
    }));
    const registry = {
        getAllPackages: vi.fn().mockReturnValue([]),
        getPackage: vi.fn((id: string) => (id === PAIR ? { id, manifest: { id, name: 'crm_custom', version: '1.0.0' } } : undefined)),
    };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? { registry } : name === 'protocol' ? { getMetaItems } : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), getMetaItems };
}

const reader = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['studio.access'] },
});

async function exportPair(): Promise<Record<string, any>> {
    const { dispatcher } = makeDoor();
    const r = await dispatcher.handlePackages(`/${encodeURIComponent(PAIR)}/export`, 'GET', undefined, {}, reader());
    expect(r.response?.status).toBe(200);
    return r.response?.body?.data;
}

describe('GET /packages/<base>.custom/export carries the override declaration (ADR-0146 D8.3)', () => {
    it('an overriding flow is exported with its `overrides` block, and its provenance stripped', async () => {
        const manifest = await exportPair();
        const flow = manifest.flows?.[0];
        expect(flow?.overrides).toEqual(DECLARATION);
        expect(flow).not.toHaveProperty('_packageId');
        expect(flow).not.toHaveProperty('_provenance');
    });

    it('the exported flow re-parses through FlowSchema with the declaration intact', async () => {
        const manifest = await exportPair();
        const reparsed = FlowSchema.safeParse(manifest.flows?.[0]);
        expect(reparsed.success, JSON.stringify(reparsed.error?.issues)).toBe(true);
        expect((reparsed.data as { overrides?: unknown }).overrides).toEqual(DECLARATION);
    });

    it('an overriding view item travels in `viewItems:` with its block, and re-parses there', async () => {
        const manifest = await exportPair();
        const item = manifest.viewItems?.[0];
        expect(item?.overrides).toEqual(DECLARATION);
        const reparsed = AssembledViewArtifactSchema.safeParse(item);
        expect(reparsed.success, JSON.stringify(reparsed.error?.issues)).toBe(true);
        expect((reparsed.data as { overrides?: unknown }).overrides).toEqual(DECLARATION);
    });
});
