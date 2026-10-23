// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25484] `POST /packages/:id/publish-drafts` probes a published dashboard's
 * widgets AS THE PUBLISHING CALLER.
 *
 * The probe docblock promises "the SAME `queryDataset` path the dashboard
 * renderer hits", and the renderer passes the caller's context. The probe
 * passed none, so the analytics service's object-level read admission refused
 * every dataset over a permission-gated object and a correct widget came back
 * as an error-tier `widget_query_failed` ("Access denied: reading … is not
 * permitted for this user") telling the author to fix a dataset that was fine.
 *
 * What is real here: the door (`HttpDispatcher.handlePackages`), the protocol's
 * `publishPackageDrafts`, `runBuildProbes`, and an `AnalyticsService` whose
 * `admitObjectRead` judges the context it is handed — the gate that refused.
 * What is a double: the draft store and the phase-1/phase-2 publish seams
 * (the same seams `packages/objectql/src/build-probes.test.ts` stubs), and the
 * driver the analytics strategy reads.
 *
 * The two legs are each other's control: the reader's publish must come back
 * clean, and the non-reader's must still carry the refusal, so neither "the
 * probe stopped running" nor "the probe now reads as the system" can pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '@objectstack/service-analytics';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

/** The object read admission walls off from everyone but the reader. */
const GATED = 'task_item';

const DATASET = DatasetSchema.parse({
    name: 'task_metrics',
    label: 'Task metrics',
    object: GATED,
    dimensions: [],
    measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
});

const ITEMS: Record<string, unknown> = {
    'dashboard task_board': {
        name: 'task_board',
        widgets: [{ id: 'w_tasks', dataset: 'task_metrics', values: ['task_count'] }],
    },
    'dataset task_metrics': DATASET,
};

/** Both callers may publish; only the reader may read `task_item`. */
const caller = (userId: string) => ({
    request: {},
    executionContext: {
        userId,
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;
const READER = 'u_reader';
const NON_READER = 'u_publisher_without_read';

function makeDoor() {
    const admissionContexts: Array<ExecutionContext | undefined> = [];
    const analytics = new AnalyticsService({
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        admitObjectRead: (object, context) => {
            admissionContexts.push(context);
            return object !== GATED || context?.userId === READER;
        },
        executeAggregate: async () => [{ task_count: 7 }],
    });

    const protocol = new ObjectStackProtocolImplementation({} as never);
    const p = protocol as any;
    p.ensureOverlayIndex = async () => {};
    p.getOverlayRepo = () => ({
        listDrafts: async () => [
            { type: 'dataset', name: 'task_metrics' },
            { type: 'dashboard', name: 'task_board' },
        ],
        get: async (ref: any, opts: any) =>
            opts?.state === 'draft' ? { body: ITEMS[`${ref.type} ${ref.name}`], hash: 'h' } : null,
    });
    vi.spyOn(p, 'promoteDraftForPublish').mockImplementation(async (req: any) => ({
        singularType: req.type,
        orgId: null,
        advisories: [],
        result: { version: 'h', seq: 1, item: { body: ITEMS[`${req.type} ${req.name}`] }, packageId: null },
    }));
    vi.spyOn(p, 'runPublishSideEffects').mockResolvedValue({});
    p.getMetaItem = async ({ type, name }: any) => ({ item: ITEMS[`${type} ${name}`] });
    p.getMetaItems = async () => ({ items: [] });
    const engineFinds: Array<{ object: string; context: unknown }> = [];
    p.engine = {
        find: async (object: string, query: any) => {
            engineFinds.push({ object, context: query?.context });
            return [{ id: 'r1' }];
        },
        findOne: async () => null,
    };
    p.getServicesRegistry = () => new Map<string, unknown>([['analytics', analytics]]);

    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve(protocol);
            if (name === 'objectql') {
                return Promise.resolve({
                    insert: vi.fn(), find: vi.fn(), update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject: vi.fn() });
            return null;
        },
        context: { getService: () => null, trigger: vi.fn() },
    };
    return { dispatcher: new HttpDispatcher(kernel), admissionContexts, engineFinds };
}

async function publishAs(userId: string) {
    const door = makeDoor();
    const result = await door.dispatcher.handlePackages(
        '/com.tasks/publish-drafts', 'POST', {}, {}, caller(userId),
    );
    expect(result.response?.status).toBe(200);
    const data: any = (result.response as any)?.body?.data;
    expect(data?.outcome).toBe('published');
    return { ...door, probes: data?.probes };
}

afterEach(() => vi.restoreAllMocks());

describe('publish-drafts widget probes run as the publishing caller (#25484)', () => {
    it('a correct dataset over a gated object the caller CAN read yields no error-tier issue', async () => {
        const { probes, admissionContexts, engineFinds } = await publishAs(READER);

        expect(probes?.checked?.widgets).toBe(1);
        expect(probes.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
        // Admission was asked about the caller, never about a system principal.
        expect(admissionContexts.length).toBeGreaterThan(0);
        for (const ctx of admissionContexts) {
            expect(ctx?.userId).toBe(READER);
            expect((ctx as any)?.isSystem).toBeUndefined();
        }
        // No system read was used to judge this widget either.
        expect(engineFinds.filter((f) => (f.context as any)?.isSystem)).toEqual([]);
    });

    it('a caller who CANNOT read the dataset still gets the error-tier widget_query_failed', async () => {
        const { probes, admissionContexts } = await publishAs(NON_READER);

        expect(probes?.checked?.widgets).toBe(1);
        const failed = probes.issues.filter((i: any) => i.code === 'widget_query_failed');
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
            layer: 'runtime',
            severity: 'error',
            artifact: { type: 'dashboard', name: 'task_board' },
            ref: { type: 'dataset', name: 'task_metrics', member: 'w_tasks' },
        });
        expect(admissionContexts.every((ctx) => ctx?.userId === NON_READER)).toBe(true);
    });
});
