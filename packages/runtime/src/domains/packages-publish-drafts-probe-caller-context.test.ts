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
 * The refusal's `fix` names the caller's read access; a third leg, a query that
 * cannot compile, keeps the dataset fix, so the fix follows the failure rather
 * than the plane.
 *
 * [ruling record 6929121584] The last block drives the same door for the other
 * channel of a finding: `userMessage`, the sentence for the person who
 * published, composed by the probe in the language THIS request states (the
 * caller's locale, else the workspace default, else `en`). The door states
 * those locales off the caller's execution context and the protocol hands them
 * to `runBuildProbes`; the block pins that hand-off end to end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '@objectstack/service-analytics';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';
// Paid at collection, not inside a clocked case: the dispatcher's package domain
// reaches it through a dynamic import (check:test-source-alias).
import '@objectstack/metadata';

/** The object read admission walls off from everyone but the reader. */
const GATED = 'task_item';

const DATASET = DatasetSchema.parse({
    name: 'task_metrics',
    label: 'Task metrics',
    object: GATED,
    dimensions: [],
    measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
});

/**
 * The same measure over a relationship path the dataset never declares in
 * `include`: a dataset that cannot compile (`DATASET_INVALID`), whoever reads it.
 */
const DATASET_UNDECLARED_JOIN = DatasetSchema.parse({
    ...DATASET,
    measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'sum', field: 'project.estimate' }],
});

const itemsWithDataset = (dataset: unknown): Record<string, unknown> => ({
    'dashboard task_board': {
        name: 'task_board',
        widgets: [{ id: 'w_tasks', dataset: 'task_metrics', values: ['task_count'] }],
    },
    'dataset task_metrics': dataset,
});
const ITEMS = itemsWithDataset(DATASET);
const ITEMS_UNDECLARED_JOIN = itemsWithDataset(DATASET_UNDECLARED_JOIN);

/** The fix every widget query failure that is NOT an access refusal keeps. */
const DATASET_FIX = `Fix the dataset definition (or the widget's values/dimensions) so the query compiles, then republish.`;

/** Both callers may publish; only the reader may read `task_item`. */
const caller = (userId: string, localization: { locale?: string; workspaceLocale?: string } = {}) => ({
    request: {},
    executionContext: {
        userId,
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
        ...localization,
    },
}) as any;
const READER = 'u_reader';
const NON_READER = 'u_publisher_without_read';

function makeDoor(items: Record<string, unknown> = ITEMS) {
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
            opts?.state === 'draft' ? { body: items[`${ref.type} ${ref.name}`], hash: 'h' } : null,
    });
    vi.spyOn(p, 'promoteDraftForPublish').mockImplementation(async (req: any) => ({
        singularType: req.type,
        orgId: null,
        advisories: [],
        result: { version: 'h', seq: 1, item: { body: items[`${req.type} ${req.name}`] }, packageId: null },
    }));
    vi.spyOn(p, 'runPublishSideEffects').mockResolvedValue({});
    // [#31700] The probe reads a widget's dataset from the publishing package:
    // the caller's resolution first (`resolveCallerPackageAddress`, ADR-0150
    // D3), then the read at the holder's address. This double has no registry,
    // so it answers as one in which the publishing package, whose drafts carry
    // the dataset, holds it.
    const metaReads: Array<{ type: string; name: string; packageId?: string }> = [];
    p.resolveCallerPackageAddress = ({ callerPackageId }: any) => ({ kind: 'package', packageId: callerPackageId });
    p.getMetaItem = async ({ type, name, packageId }: any) => {
        metaReads.push({ type, name, ...(packageId !== undefined ? { packageId } : {}) });
        return { item: items[`${type} ${name}`] };
    };
    p.getMetaItems = async () => ({ items: [] });
    const engineFinds: Array<{ object: string; context: unknown }> = [];
    p.engine = {
        find: async (object: string, query: any) => {
            engineFinds.push({ object, context: query?.context });
            const rows = [{ id: 'r1' }, { id: 'r2' }];
            return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
        },
        // The ADR-0067 pre-publish capture: never published, so no active row.
        findOne: async (object: string, query: unknown) => {
            assertEngineFindOnePredicate(object, query as never);
            return null;
        },
        // The ADR-0067 commit row the batch writes; not under test here.
        insert: async (_object: string, row: unknown) => row,
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
    return { dispatcher: new HttpDispatcher(kernel), admissionContexts, engineFinds, metaReads };
}

async function publishAs(
    userId: string,
    items: Record<string, unknown> = ITEMS,
    localization: { locale?: string; workspaceLocale?: string } = {},
) {
    const door = makeDoor(items);
    const result = await door.dispatcher.handlePackages(
        '/com.tasks/publish-drafts', 'POST', {}, {}, caller(userId, localization),
    );
    expect(result.response?.status).toBe(200);
    const data: any = (result.response as any)?.body?.data;
    expect(data?.outcome).toBe('published');
    return { ...door, probes: data?.probes };
}

afterEach(() => vi.restoreAllMocks());

describe('publish-drafts widget probes run as the publishing caller (#25484)', () => {
    it('a correct dataset over a gated object the caller CAN read yields no error-tier issue', async () => {
        const { probes, admissionContexts, engineFinds, metaReads } = await publishAs(READER);

        expect(probes?.checked?.widgets).toBe(1);
        // The widget's dataset was read at the publishing package's address.
        expect(metaReads).toContainEqual({ type: 'dataset', name: 'task_metrics', packageId: 'com.tasks' });
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
        const failed = probes.issues.filter((i: any) => i.code === 'widget_query_failed'); // adr0112-ok: D6c build-probe diagnostics code
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
            layer: 'runtime',
            severity: 'error',
            artifact: { type: 'dashboard', name: 'task_board' },
            ref: { type: 'dataset', name: 'task_metrics', member: 'w_tasks' },
        });
        expect(failed[0].message).toContain(`reading "${GATED}" is not permitted for this user`);
        // The dataset is correct: the fix names the caller's read access, never a dataset edit.
        expect(failed[0].fix).toContain(`read access to object "${GATED}"`);
        expect(failed[0].fix).not.toContain(DATASET_FIX);
        expect(admissionContexts.every((ctx) => ctx?.userId === NON_READER)).toBe(true);
    });

    it('a query that cannot compile, for a caller who CAN read, keeps the dataset fix', async () => {
        const { probes } = await publishAs(READER, ITEMS_UNDECLARED_JOIN);

        expect(probes?.checked?.widgets).toBe(1);
        const failed = probes.issues.filter((i: any) => i.code === 'widget_query_failed'); // adr0112-ok: D6c build-probe diagnostics code
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ layer: 'runtime', severity: 'error', fix: DATASET_FIX });
        expect(failed[0].message).toContain('is not declared in the dataset');
    });
});

describe('publish-drafts probe findings carry the person\'s sentence in the request\'s language (ruling record 6929121584)', () => {
    /**
     * The same app with the labels a person knows it by. `task_item` carries a label
     * too, so the refusal legs show that the probe does not read it for a caller
     * who was refused that object.
     */
    const LABELLED: Record<string, unknown> = {
        ...ITEMS,
        'dashboard task_board': {
            name: 'task_board',
            label: { en: 'Task board', 'zh-CN': '任务看板' },
            widgets: [{ id: 'w_tasks', title: { en: 'Open tasks', 'zh-CN': '未完成任务' }, dataset: 'task_metrics', values: ['task_count'] }],
        },
        'object task_item': { name: GATED, label: 'Tasks' },
    };
    const refusalOf = (probes: any) => {
        const failed = probes.issues.filter((i: any) => i.code === 'widget_query_failed'); // adr0112-ok: D6c build-probe diagnostics code
        expect(failed).toHaveLength(1);
        return failed[0];
    };

    it('the caller\'s locale picks the sentence, and the sentence names the labels, not the API names', async () => {
        // The one exception is the object the caller was refused: the probe reads
        // nothing of it for this caller, so the sentence names it as the fix does.
        const { probes } = await publishAs(NON_READER, LABELLED, { locale: 'zh-CN', workspaceLocale: 'en' });
        const issue = refusalOf(probes);

        expect(issue.userMessage).toBe(
            `仪表盘“任务看板”中的组件“未完成任务”无法加载数据：发布时使用的账号没有“${GATED}”的读取权限。`
                + '请让管理员授予该权限，然后重新发布。已有该权限的人可以正常看到这个组件。',
        );
        for (const apiName of ['task_board', 'w_tasks', 'task_metrics']) {
            expect(issue.userMessage).not.toContain(apiName);
        }
        // The refused object's label is not read, so it is not shown.
        expect(issue.userMessage).not.toContain('Tasks');
        // The agent's channel is untouched by the locale: English, API names, the thrown text.
        expect(issue.message).toContain(`reading "${GATED}" is not permitted for this user`);
        expect(issue.fix).toContain(`read access to object "${GATED}"`);
    });

    it('with no request locale the workspace default answers, and with neither, en', async () => {
        const french = refusalOf((await publishAs(NON_READER, LABELLED, { workspaceLocale: 'fr-FR' })).probes);
        expect(french.userMessage).toContain('Le widget « Open tasks » du tableau de bord « Task board »');

        const english = refusalOf((await publishAs(NON_READER, LABELLED)).probes);
        expect(english.userMessage).toBe(
            'The widget "Open tasks" on dashboard "Task board" could not load its data: the account that published it '
                + `does not have read access to "${GATED}". Ask an administrator for that access, then publish again. `
                + 'People who already have it can see the widget.',
        );
        // One finding, two readers: only the person's sentence moved.
        expect(french.message).toBe(english.message);
        expect(french.fix).toBe(english.fix);
    });

    it('CONTROL: a publish with nothing wrong carries no sentence at all', async () => {
        const { probes } = await publishAs(READER, LABELLED, { locale: 'zh-CN' });
        expect(probes.issues).toEqual([]);
    });
});
