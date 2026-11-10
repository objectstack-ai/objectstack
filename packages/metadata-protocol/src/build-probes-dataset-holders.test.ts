// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32072] A widget whose dataset name several packages hold is reported as
 * not probed, naming every holder.
 *
 * `dataset` reads by package (ADR-0150 D3), so the protocol's by-name read of
 * a name two packages hold throws `PackageScopedNameRefusedError` and there is
 * no dataset to run. The widget plane used to skip such a widget in silence,
 * which a publish receipt reads as "probed and passed". It now adds one
 * warning-tier `widget_not_probed` per widget, naming the holders, and the
 * `checked.widgets` count stays where it is because nothing was probed.
 *
 * CONTROL: a dangling dataset (no holder at all) is still an L1 graph finding,
 * skipped here without an issue, and any other read failure is too.
 */

import { describe, expect, it } from 'vitest';
import { PackageScopedNameRefusedError, type PackageScopedRefusal } from '@objectstack/core';
import { runBuildProbes, type ProbeEngine } from './build-probes.js';

const ALPHA = 'com.qa.alpha';
const BETA = 'com.qa.beta';

const refusal: PackageScopedRefusal = {
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: 'dataset',
    name: 'shared_ds',
    callerPackageId: null,
    candidates: [{ kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }],
    message: 'The dataset "shared_ds" is held by more than one package.',
};

const ITEMS: Record<string, unknown> = {
    'dashboard board': {
        name: 'board',
        widgets: [
            { id: 'w_shared', dataset: 'shared_ds', values: ['total'] },
            { id: 'w_missing', dataset: 'missing_ds', values: ['total'] },
            { id: 'w_broken', dataset: 'broken_ds', values: ['total'] },
            { id: 'w_own', dataset: 'own_ds', values: ['total'] },
        ],
    },
    'dataset own_ds': { name: 'own_ds', object: 'task_item', measures: [{ name: 'total', aggregate: 'count' }] },
};

const getItem = async (type: string, name: string) => {
    if (type === 'dataset' && name === 'shared_ds') throw new PackageScopedNameRefusedError(refusal);
    if (type === 'dataset' && name === 'broken_ds') throw new Error('the metadata store is unreachable');
    return ITEMS[`${type} ${name}`];
};
const engine: ProbeEngine = { find: async () => [{ id: 'r1' }] };

async function probe() {
    const queried: string[] = [];
    const report = await runBuildProbes({
        engine,
        getItem,
        analytics: {
            queryDataset: async (dataset: any) => {
                queried.push(dataset.name);
                return { rows: [{ total: 1 }] };
            },
        },
        published: [{ type: 'dashboard', name: 'board' }],
    });
    return { report, queried };
}

describe('[#32072] a widget whose dataset several packages hold is reported not probed', () => {
    it('adds one warning naming every holder, and runs nothing for that widget', async () => {
        const { report, queried } = await probe();
        const notProbed = report.issues.filter((i) => i.code === 'widget_not_probed'); // adr0112-ok: D6c build-probe diagnostics code
        expect(notProbed).toHaveLength(1);
        expect(notProbed[0]).toMatchObject({
            layer: 'runtime',
            severity: 'warning',
            artifact: { type: 'dashboard', name: 'board' },
            ref: { type: 'dataset', name: 'shared_ds', member: 'w_shared' },
        });
        expect(notProbed[0]!.message).toContain('not probed');
        expect(notProbed[0]!.message).toContain(`2 holders (${ALPHA}, ${BETA})`);
        expect(queried).not.toContain('shared_ds');
    });

    it('CONTROL: a dangling dataset and a read that failed for another reason add no issue; a held dataset is probed', async () => {
        const { report, queried } = await probe();
        expect(report.issues.map((i) => i.code)).toEqual(['widget_not_probed']); // adr0112-ok: D6c build-probe diagnostics code
        expect(queried).toEqual(['own_ds']);
        expect(report.checked.widgets).toBe(1);
    });
});
