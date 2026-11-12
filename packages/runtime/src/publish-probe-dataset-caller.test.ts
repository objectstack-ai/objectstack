// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3, #31700] A dataset name is held once per NAMESPACE now, so two
 * namespaces may each hold `qa_ds`. A publish's runtime probes
 * (`publishPackageDrafts` → `runBuildProbes`) read each widget's dataset
 * through `publishedItemReader`: resolved FROM the publishing package by the
 * caller arm (`resolveCallerPackageAddress`, #32310), then read at the
 * holder's exact address. So publishing either package probes ITS OWN dataset.
 *
 * Driven over the real `ObjectStackProtocolImplementation` and the real
 * `SchemaRegistry`.
 *
 * BASE (main f0f729e7): the probes read the dataset by its bare name, which
 * two holders refuse (`409 RESOURCE_CONFLICT`), so neither package's widget
 * was probed and each receipt carried `widget_not_probed`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@objectstack/metadata';
import { ObjectStackProtocolImplementation, publishedItemReader, runBuildProbes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';

let registry: SchemaRegistry;
let protocol: ObjectStackProtocolImplementation;

const dataset = (packageId: string) => ({
    name: 'qa_ds',
    label: `${packageId} dataset`,
    object: `${packageId.split('.').pop()}_item`,
    measures: [{ name: 'total', aggregate: 'count' }],
});
const dashboard = (name: string) => ({ name, label: name, widgets: [{ id: 'w', dataset: 'qa_ds', values: ['total'] }] });

beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    for (const id of [A, B]) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! } as never, 'code');
        registry.registerItem('dataset', dataset(id), 'name' as never, id);
    }
    registry.registerItem('dashboard', dashboard('board_alpha'), 'name' as never, A);
    registry.registerItem('dashboard', dashboard('board_beta'), 'name' as never, B);
    const engine = {
        registry,
        find: vi.fn().mockResolvedValue([{ id: 'r1' }]),
        findOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue([]),
    };
    protocol = new ObjectStackProtocolImplementation(engine as never);
});

async function probePublishOf(packageId: string | undefined, board: string) {
    const queried: string[] = [];
    const report = await runBuildProbes({
        engine: { find: async () => [{ id: 'r1' }] },
        getItem: publishedItemReader(protocol as never, packageId),
        analytics: {
            queryDataset: async (body: any) => {
                queried.push(body.label);
                return { rows: [{ total: 1 }] };
            },
        },
        published: [{ type: 'dashboard', name: board }],
    });
    return { report, queried };
}

describe('[#31700] a publish probes the dataset its own package resolves (ADR-0150 D3)', () => {
    it('two namespaces each hold `qa_ds`: publishing either package probes its own dataset', async () => {
        for (const [packageId, board] of [[A, 'board_alpha'], [B, 'board_beta']] as const) {
            const { report, queried } = await probePublishOf(packageId, board);
            expect(report.issues, packageId).toEqual([]);
            expect(report.checked.widgets, packageId).toBe(1);
            expect(queried, packageId).toEqual([`${packageId} dataset`]);
        }
    });

    it('CONTROL — the bare read of the name is still refused naming both holders, as the probes read it before', async () => {
        const { report, queried } = await probePublishOf(undefined, 'board_alpha');
        expect(queried).toEqual([]);
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0]).toMatchObject({ code: 'widget_not_probed', ref: { type: 'dataset', name: 'qa_ds' } }); // adr0112-ok: D6c build-probe diagnostics code
        expect(report.issues[0]!.message).toContain(`2 holders (${A}, ${B})`);
    });
});
