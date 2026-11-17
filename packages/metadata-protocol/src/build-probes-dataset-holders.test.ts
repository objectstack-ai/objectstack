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
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { publishedItemReader, runBuildProbes, type ProbeEngine, type ProbeItemProtocol } from './build-probes.js';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { NO_PACKAGE_SCOPED_READS } from './no-package-scoped-reads.testkit.js';

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

/**
 * [#34560] A widget whose dataset does not exist, read through the REAL
 * by-name read: `getMetaItem` answers a missing item with its envelope
 * (`{ type, name, item: undefined, lock, editable, … }`), never a throw and
 * never `undefined`. The reader the publish uses (`publishedItemReader`, over
 * the protocol facade) must hand the probes no body for it, so the widget
 * takes the dangling-dataset path (an L1 graph finding, skipped here): it is
 * not counted in `checked.widgets`, no dataset query runs, and no
 * `widget_query_failed` is reported. The doubles above answer `undefined` for
 * a missing item, which is why none of them reached this.
 *
 * The protocol here is `ObjectStackProtocolImplementation` itself over a
 * registry double (the shape `protocol.item-execution-read.test.ts` drives),
 * so the envelope is the one the read builds, not a hand-copied one.
 */
describe('[#34560] a missing widget dataset under the real getMetaItem envelope is skipped, not checked', () => {
    const APP = 'com.qa.app';
    const REGISTRY_ITEMS: Record<string, unknown> = {
        'dashboard board': {
            name: 'board',
            widgets: [
                { id: 'w_missing', dataset: 'missing_ds', values: ['total'] },
                { id: 'w_own', dataset: 'own_ds', values: ['total'] },
            ],
        },
        'dataset own_ds': { name: 'own_ds', object: 'task_item', measures: [{ name: 'total', aggregate: 'count' }] },
    };
    const held = (type: string, name: string): unknown => {
        const item = REGISTRY_ITEMS[`${type} ${name}`];
        return item === undefined ? undefined : structuredClone(item);
    };

    function realProtocol() {
        const engine: Record<string, unknown> = {
            registry: {
                ...NO_PACKAGE_SCOPED_READS,
                // `dataset` is read by package (ADR-0150 D3), as
                // `SchemaRegistry` reads it: `own_ds` is held by package APP,
                // and `missing_ds` by no one, so its read answers no item.
                readsByPackage: (type: string): boolean => type === 'dataset' || NO_PACKAGE_SCOPED_READS.readsByPackage(type),
                packageScopedHoldersOf: (type: string, name: string): string[] =>
                    type === 'dataset' && held(type, name) !== undefined ? [APP] : [],
                getPackageScopedItem: (type: string, name: string, packageId: string): unknown =>
                    packageId === APP ? held(type, name) : undefined,
                getItem: (type: string, name: string) => held(type, name),
                getObject: () => undefined,
                listItems: () => [],
                getPackage: () => undefined,
                getArtifactItem: () => undefined,
                isPackageDisabled: () => false,
                isObjectPackageDisabled: () => false,
                registerItem: () => undefined,
                registerObject: () => undefined,
                applyNavContributions: (app: unknown) => app,
            },
            writeEpoch: { current: 0, bump: () => 1, subscribe: () => () => {} },
            registerMiddleware: () => undefined,
            find: async () => [],
            findOne: async (table: string, q: Record<string, unknown> = {}) => {
                assertEngineFindOnePredicate(table, q as never);
                return null;
            },
        };
        const services = new Map<string, unknown>();
        return new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, never>) as unknown as ProbeItemProtocol;
    }

    // The publish reads FROM the publishing package (`request.packageId`);
    // with no package the dataset is read by name. Both arms of the reader.
    for (const publisher of [APP, undefined]) {
        const arm = publisher === undefined ? 'read by name' : `read from package ${publisher}`;

        it(`${arm}: the real read answers a missing dataset with its envelope, and the reader hands the probes no body`, async () => {
            const protocol = realProtocol();
            const envelope = (await protocol.getMetaItem({
                type: 'dataset', name: 'missing_ds', ...(publisher !== undefined ? { packageId: publisher } : {}),
            })) as Record<string, unknown>;
            expect(envelope, 'the by-name read answers an envelope, not undefined').toBeTypeOf('object');
            expect(envelope).toMatchObject({ type: 'dataset', name: 'missing_ds' });
            expect(Object.prototype.hasOwnProperty.call(envelope, 'item')).toBe(true);
            expect(envelope.item).toBeUndefined();
            expect(await publishedItemReader(protocol, publisher)('dataset', 'missing_ds')).toBeUndefined();
        });

        it(`${arm}: the widget takes the L1 skip path: not counted, not queried, no widget_query_failed`, async () => {
            const queried: unknown[] = [];
            const report = await runBuildProbes({
                engine,
                getItem: publishedItemReader(realProtocol(), publisher),
                analytics: {
                    // Refuses a body that binds no object, as a dataset query
                    // over nothing can only fail: the shape of the false
                    // `widget_query_failed` the envelope used to produce.
                    queryDataset: async (dataset: any) => {
                        queried.push(dataset?.name);
                        if (typeof dataset?.object !== 'string') throw new Error('dataset binds no object');
                        return { rows: [{ total: 1 }] };
                    },
                },
                published: [{ type: 'dashboard', name: 'board' }],
            });
            expect({ checked: report.checked.widgets, codes: report.issues.map((i) => i.code), queried })
                .toEqual({ checked: 1, codes: [], queried: ['own_ds'] });
        });

        it(`${arm}: CONTROL — a dataset the real read finds is handed over as its body`, async () => {
            const body = await publishedItemReader(realProtocol(), publisher)('dataset', 'own_ds');
            expect(body).toMatchObject({ name: 'own_ds', object: 'task_item' });
            expect(body).not.toHaveProperty('item');
        });
    }
});
