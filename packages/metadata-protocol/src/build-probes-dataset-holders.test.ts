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
// The object plane reaches `@objectstack/lint` only through a dynamic import; paid
// here at module scope so the first load lands during collection, not inside a
// clocked window (`pnpm check:test-source-alias`).
import '@objectstack/lint';
import { PackageScopedNameRefusedError, type PackageScopedRefusal } from '@objectstack/core';
import { publishedItemReader, runBuildProbes, type ProbeEngine, type ProbeItemProtocol } from './build-probes.js';

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

/**
 * [ADR-0150 D3, #31700] A dataset name is held once per namespace now, so two
 * namespaces may each hold it. The publish's probes read a widget's dataset
 * FROM the publishing package (`publishedItemReader`, the caller arm of
 * #32310), so each package's publish probes its own dataset; a name the
 * publishing package cannot resolve is ITS refusal, and the fix names it.
 * The end-to-end pin over the real protocol and registry is in
 * `@objectstack/runtime` (`domains/meta-qualified-item-read.test.ts`).
 */
describe('[#31700] the probes read a widget\'s dataset from the publishing package', () => {
    const BODIES: Record<string, unknown> = {
        [ALPHA]: { name: 'qa_ds', object: 'alpha_item', measures: [{ name: 'total', aggregate: 'count' }] },
        [BETA]: { name: 'qa_ds', object: 'beta_item', measures: [{ name: 'total', aggregate: 'count' }] },
    };
    const reads: Array<Record<string, unknown>> = [];
    const protocol: ProbeItemProtocol = {
        async getMetaItem(request) {
            reads.push(request);
            if (request.type === 'dashboard') return { item: { name: request.name, widgets: [{ id: 'w', dataset: 'qa_ds', values: ['total'] }] } };
            if (request.type !== 'dataset') return undefined;
            if (request.packageId === undefined) throw new PackageScopedNameRefusedError({ ...refusal, name: 'qa_ds' });
            return { item: BODIES[request.packageId] };
        },
        resolveCallerPackageAddress: ({ callerPackageId }) => ({ kind: 'package', packageId: callerPackageId }),
    };

    for (const publisher of [ALPHA, BETA]) {
        it(`publishing ${publisher} probes ${publisher}'s own dataset, read at its exact address`, async () => {
            reads.length = 0;
            const queried: unknown[] = [];
            const report = await runBuildProbes({
                engine,
                getItem: publishedItemReader(protocol, publisher),
                analytics: { queryDataset: async (dataset: any) => { queried.push(dataset.object); return { rows: [{ total: 1 }] }; } },
                published: [{ type: 'dashboard', name: 'board' }],
            });
            expect(report.issues).toEqual([]);
            expect(report.checked.widgets).toBe(1);
            expect(queried).toEqual([(BODIES[publisher] as { object: string }).object]);
            expect(reads).toContainEqual({ type: 'dataset', name: 'qa_ds', packageId: publisher });
            expect(reads).toContainEqual({ type: 'dashboard', name: 'board' });
        });
    }

    it('CONTROL — with no publishing package the dataset is read by name, and two holders refuse it as before', async () => {
        const report = await runBuildProbes({
            engine,
            getItem: publishedItemReader(protocol, undefined),
            analytics: { queryDataset: async () => ({ rows: [{ total: 1 }] }) },
            published: [{ type: 'dashboard', name: 'board' }],
        });
        expect(report.issues.map((i) => i.code)).toEqual(['widget_not_probed']); // adr0112-ok: D6c build-probe diagnostics code
        expect(report.issues[0]!.fix).toBe('Keep one dataset named "qa_ds": rename or remove the others, then republish.');
    });

    const refusedFrom = (reason: PackageScopedRefusal['reason']): ProbeItemProtocol => ({
        getMetaItem: protocol.getMetaItem,
        resolveCallerPackageAddress: ({ callerPackageId }) => {
            throw new PackageScopedNameRefusedError({ ...refusal, name: 'qa_ds', reason, callerPackageId });
        },
    });

    it('a name two holders in the publishing package\'s closure hold is ITS refusal: the fix names that package', async () => {
        const report = await runBuildProbes({
            engine,
            getItem: publishedItemReader(refusedFrom('ambiguous-in-closure'), 'com.qa.app'),
            published: [{ type: 'dashboard', name: 'board' }],
            analytics: { queryDataset: async () => ({ rows: [] }) },
        });
        const [issue] = report.issues;
        expect(issue).toMatchObject({ code: 'widget_not_probed', severity: 'warning' }); // adr0112-ok: D6c build-probe diagnostics code
        expect(issue!.message).toContain(`dataset "qa_ds" has 2 holders package "com.qa.app" reaches (${ALPHA}, ${BETA})`);
        expect(issue!.fix).toBe('Make "qa_ds" mean one dataset from package "com.qa.app": hold it in "com.qa.app" itself, '
            + 'or depend on only one of the packages that hold it, then republish.');
    });

    it('a name held only outside the publishing package\'s closure: the fix is the dependency', async () => {
        const report = await runBuildProbes({
            engine,
            getItem: publishedItemReader(refusedFrom('outside-closure'), 'com.qa.app'),
            published: [{ type: 'dashboard', name: 'board' }],
            analytics: { queryDataset: async () => ({ rows: [] }) },
        });
        const [issue] = report.issues;
        expect(issue!.message).toContain('is held only outside the declared dependencies of package "com.qa.app"');
        expect(issue!.fix).toContain('Declare package "com.qa.app"\'s dependency');
        // [#32967] …and the move, for a holder that already depends on the publishing package.
        expect(issue!.fix).toContain('would be a cycle, so move the dashboard into that package');
    });
});
