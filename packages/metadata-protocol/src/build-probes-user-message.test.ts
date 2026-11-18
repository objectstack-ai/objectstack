// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A build-probe finding carries the PERSON's sentence beside the agent's text.
 *
 * Ruling records 6819749037 and 6929121584: the producer of a finding composes
 * the sentence its user reads, in the request's language, and no consumer
 * keeps a per-code table. `runBuildProbes` is that producer for the ADR-0038
 * L3 findings, so every finding it emits has `userMessage`
 * (`RuntimeBuildIssueSchema.userMessage`), rendered from
 * `build-probes.user-text.ts` under the ladder: the request's locale, else the
 * workspace default, else `en`. `message` and `fix` stay the agent's English.
 *
 * What is pinned here, each from REAL `runBuildProbes` runs:
 *
 *  1. every emit site and every branch carries the sentence its code and
 *     cause have in the catalog, with the names the probe read;
 *  2. a sentence names an artifact by its label where the probe can read one,
 *     resolved for the sentence's language, and by its API name otherwise;
 *  3. the ladder: request locale, then workspace default, then `en`;
 *  4. `message` and `fix` do not move with the locale;
 *  5. every finding, and the report, parse through the spec schemas with
 *     nothing stripped (declared = returned, for the modeled `probes`);
 *  6. the catalog holds exactly the codes the probe source emits, each in
 *     every platform locale, so a ninth code cannot ship without sentences.
 *
 * `object_field_ref_rule_failed` needs a rule that throws, which only a mocked
 * lint root gives; its run lives in `build-probes-rule-failure.test.ts`, next
 * to the harness that mocks it. Its sentences are rendered here (the catalog
 * cases), and its run there asserts the wiring.
 *
 * ## The `adr0112-ok:` marks
 *
 * The probe codes are diagnostics shipped inside a 200 receipt (ADR-0112 D6c),
 * not `error.code` values, as in the sibling probe suites. Each mark is on its
 * literal's own line.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// The object plane reaches the lint root through a dynamic import; paid at
// collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { PackageScopedNameRefusedError, type PackageScopedRefusal } from '@objectstack/core';
import { BuildProbeReportSchema, RuntimeBuildIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS, type PlatformLocaleTag } from '@objectstack/spec/system';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import {
    runBuildProbes,
    type BuildProbeReport,
    type ProbeEngine,
    type RunBuildProbesOptions,
    type RuntimeBuildIssueCode,
} from './build-probes.js';
import { BUILD_PROBE_USER_TEXT, buildProbeUserMessage } from './build-probes.user-text.js';

// ── The published app the probes read ───────────────────────────────────────
//
// API names are distinctive on purpose: a sentence that names an artifact by
// its label must not contain the API name, and that is only checkable when the
// API name is no substring of an ordinary word.

const TASKS = 'Tasks'; // an object's `label` is a plain string (ObjectSchema)
const PROJECTS = 'Projects';
const BOARD: I18nLabel = { en: 'Team board', 'zh-CN': '团队看板', de: 'Teamübersicht' };
const WIDGET: I18nLabel = { en: 'Open tasks', 'zh-CN': '未完成任务' };
const DATASET: I18nLabel = { en: 'Task totals', 'zh-CN': '任务汇总' };
const VIEW: I18nLabel = { en: 'All tasks', 'zh-CN': '全部任务' };
const ACCOUNTS = 'Accounts';
const DEALS = 'Deals';
const OPEN_DEALS: I18nLabel = { en: 'Open deals', 'zh-CN': '未结交易' };
const ACCT_REF: I18nLabel = { en: 'Customer', 'zh-CN': '客户' };
const ERP_SYNC: I18nLabel = { en: 'ERP sync', 'zh-CN': 'ERP 同步' };

const ITEMS: Record<string, unknown> = {
    'object crm_task': {
        name: 'crm_task',
        label: TASKS,
        fields: { title: { type: 'text', label: 'Title' } },
        // One dangling name: the object plane's one finding.
        highlightFields: ['no_such_field'],
    },
    'object crm_project': { name: 'crm_project', label: PROJECTS, fields: { title: { type: 'text', label: 'Title' } } },
    'seed crm_task_seed': { object: 'crm_task', records: [] },
    'view crm_task_list': { name: 'crm_task_list', label: VIEW, object: 'crm_task' },
    'dashboard crm_board': {
        name: 'crm_board',
        label: BOARD,
        widgets: [{ id: 'w_open_tasks', title: WIDGET, dataset: 'crm_task_totals', values: ['total'] }],
    },
    'dataset crm_task_totals': {
        name: 'crm_task_totals',
        label: DATASET,
        object: 'crm_task',
        measures: [{ name: 'total', aggregate: 'count' }],
    },
    // A dataset that names no object: the refusal has nothing to name either.
    'dashboard crm_board_bare': {
        name: 'crm_board_bare',
        label: BOARD,
        widgets: [{ id: 'w_open_tasks', title: WIDGET, dataset: 'crm_bare_totals', values: ['total'] }],
    },
    'dataset crm_bare_totals': { name: 'crm_bare_totals', label: DATASET, measures: [{ name: 'total', aggregate: 'count' }] },
    // [#35146] A parent with a roll-up over its children, the children's
    // reference back, the seed that loads them, and a flow with a connector step.
    'object crm_acct': {
        name: 'crm_acct',
        label: ACCOUNTS,
        fields: {
            title: { type: 'text', label: 'Title' },
            open_deal_count: { type: 'summary', label: OPEN_DEALS, summaryOperations: { object: 'crm_deal', function: 'count' } },
        },
    },
    'object crm_deal': {
        name: 'crm_deal',
        label: DEALS,
        fields: { acct_ref: { type: 'lookup', reference: 'crm_acct', label: ACCT_REF } },
    },
    'seed crm_deal_seed': { object: 'crm_deal', records: [{ name: 'Big deal' }] },
    'flow crm_erp_sync': {
        name: 'crm_erp_sync',
        label: ERP_SYNC,
        nodes: [
            { id: 'start', type: 'start' },
            { id: 'push_step', type: 'connector_action', label: 'Push order', connectorConfig: { connectorId: 'erp_link', actionId: 'push' } },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'push_step' }],
    },
};

type GetItem = RunBuildProbesOptions['getItem'];
const readItems: GetItem = async (type, name) => ITEMS[`${type} ${name}`];

/** Honours the caller's `limit` by presence (`check:objectql-double-limit`). */
const limited = (rows: Array<Record<string, unknown>>, query: unknown): Array<Record<string, unknown>> => {
    const limit = (query as { limit?: unknown } | undefined)?.limit;
    return typeof limit === 'number' ? rows.slice(0, limit) : rows;
};
const engineWithRows: ProbeEngine = { find: async (_object, query) => limited([{ id: 'r1' }, { id: 'r2' }], query) };
const engineEmpty: ProbeEngine = { find: async () => [] };
const engineThrowing: ProbeEngine = {
    find: async () => {
        throw new Error('no such table: crm_task');
    },
};

/** One `where` on one row: equality and `{ $in: [...] }`; any other operator or combinator is refused. */
const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, want]) => {
        if (key.startsWith('$')) throw new Error(`double: combinator ${key} not implemented`);
        if (!want || typeof want !== 'object') return row[key] === want;
        const ops = Object.keys(want);
        const $in = (want as { $in?: unknown }).$in;
        if (ops.length !== 1 || !Array.isArray($in)) throw new Error(`double: operator ${ops.join(',')} not implemented`);
        return $in.includes(row[key]);
    });
/**
 * An engine over fixed tables: honours `where`, then `limit`, so the roll-up
 * and reference probes read exactly the rows a real engine would give.
 */
const engineOver = (tables: Record<string, Array<Record<string, unknown>>>): ProbeEngine => ({
    find: async (object, query) => {
        const rows = (tables[object] ?? []).filter((r) => matches(r, (query as { where?: Record<string, unknown> } | undefined)?.where));
        return limited(rows, query);
    },
});
/** The automation engine's connector lookups, answering as a test says. */
const automationAnswering = (answer: {
    instance?: 'refused' | 'none';
    degraded?: string;
}): NonNullable<RunBuildProbesOptions['automation']> => ({
    resolveConnectorInstanceFor: () =>
        answer.instance === 'refused'
            ? { status: 'refused', refusal: { message: 'two packages hold the connector "erp_link".' } }
            : answer.instance === 'none' ? { status: 'none' } : { status: 'instance', packageId: null },
    resolveConnectorAction: () => undefined,
    getConnectorDegradedReason: () => answer.degraded,
});
const FLOW = [{ type: 'flow', name: 'crm_erp_sync' }];
const flowNames = (tag: PlatformLocaleTag): Names => ({
    flow: said(ERP_SYNC, tag, 'crm_erp_sync'),
    step: 'Push order',
    connector: 'erp_link',
});

const analyticsReturning = (result: unknown) => ({ queryDataset: async () => result });
const analyticsThrowing = (message: string, fields: Record<string, unknown> = {}) => ({
    queryDataset: async () => {
        throw Object.assign(new Error(message), fields);
    },
});

const ALPHA = 'com.qa.alpha';
const BETA = 'com.qa.beta';
const refusedDataset = (reason: PackageScopedRefusal['reason'], callerPackageId: string | null): GetItem =>
    async (type, name) => {
        if (type === 'dataset') {
            throw new PackageScopedNameRefusedError({
                status: 'refused',
                reason,
                type: 'dataset',
                name,
                callerPackageId,
                candidates: [{ kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }],
                message: `The dataset "${name}" cannot be read by name.`,
            });
        }
        return ITEMS[`${type} ${name}`];
    };

type Locales = RunBuildProbesOptions['userTextLocales'];
type Names = Readonly<Record<string, string>>;

/** A label as the probe must resolve it for one locale: the body's own, else the API name. */
const said = (label: I18nLabel | undefined, tag: PlatformLocaleTag, apiName: string): string =>
    resolveI18nLabel(label, tag) || apiName;

/** The widget subject every dashboard sentence names. */
const widgetNames = (tag: PlatformLocaleTag): Names => ({
    dashboard: said(BOARD, tag, 'crm_board'),
    widget: said(WIDGET, tag, 'w_open_tasks'),
});

interface ProbeCase {
    /** What happened, in the reader's words. */
    readonly title: string;
    readonly code: RuntimeBuildIssueCode;
    /** One real probe run, with the request's locale candidates. */
    readonly run: (userTextLocales?: Locales) => Promise<BuildProbeReport>;
    /** The names and cause the sentence must be rendered from, for one locale. */
    readonly params: (tag: PlatformLocaleTag) => Names;
    /**
     * Names the sentence must NOT show: an API name the probe could read a label
     * for, or the label of an object the caller was refused (the probe must not
     * read it).
     */
    readonly hidden: readonly string[];
    /** Params the sentence does not print (a selector, or a name its wording leaves out). */
    readonly silent?: readonly string[];
}

const probe = (opts: Omit<RunBuildProbesOptions, 'getItem' | 'engine'> & Partial<Pick<RunBuildProbesOptions, 'getItem' | 'engine'>>) =>
    (userTextLocales?: Locales): Promise<BuildProbeReport> =>
        runBuildProbes({
            engine: engineWithRows,
            getItem: readItems,
            ...opts,
            ...(userTextLocales !== undefined ? { userTextLocales } : {}),
        });

const DASHBOARD = [{ type: 'dashboard', name: 'crm_board' }];
const DASHBOARD_BARE = [{ type: 'dashboard', name: 'crm_board_bare' }];

const CASES: readonly ProbeCase[] = [
    {
        title: 'a seed whose object has no rows',
        code: 'seed_not_applied', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ engine: engineEmpty, published: [{ type: 'seed', name: 'crm_task_seed' }] }),
        params: () => ({ object: TASKS, cause: 'no-rows' }),
        hidden: ['crm_task'],
    },
    {
        title: 'a seed whose object the probe could not read',
        code: 'seed_not_applied', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ engine: engineThrowing, published: [{ type: 'seed', name: 'crm_task_seed' }] }),
        params: () => ({ object: TASKS, cause: 'unreadable' }),
        hidden: ['crm_task'],
    },
    {
        title: 'a view whose read throws',
        code: 'view_read_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ engine: engineThrowing, published: [{ type: 'view', name: 'crm_task_list' }] }),
        params: (tag) => ({ view: said(VIEW, tag, 'crm_task_list'), object: TASKS }),
        hidden: ['crm_task'],
    },
    {
        title: 'an object setting that names a field it cannot use',
        code: 'object_field_ref_unknown', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ published: [{ type: 'object', name: 'crm_task' }] }),
        params: () => ({ object: TASKS }),
        hidden: ['crm_task', 'no_such_field'],
    },
    {
        title: 'a widget whose dataset is held outside the publishing package\'s dependencies',
        code: 'widget_not_probed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            getItem: refusedDataset('outside-closure', ALPHA),
            analytics: analyticsReturning({ rows: [{ total: 1 }] }),
            published: DASHBOARD,
        }),
        // The dataset by its API name: its read was refused, so no label.
        params: (tag) => ({ ...widgetNames(tag), dataset: 'crm_task_totals', cause: 'outside-closure' }),
        hidden: ['crm_board', 'w_open_tasks', ALPHA, BETA],
    },
    {
        title: 'a widget whose dataset several packages the publishing package depends on hold',
        code: 'widget_not_probed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            getItem: refusedDataset('ambiguous-in-closure', ALPHA),
            analytics: analyticsReturning({ rows: [{ total: 1 }] }),
            published: DASHBOARD,
        }),
        params: (tag) => ({ ...widgetNames(tag), dataset: 'crm_task_totals', cause: 'ambiguous-in-closure' }),
        hidden: ['crm_board', 'w_open_tasks', ALPHA, BETA],
    },
    {
        title: 'a widget whose dataset name several datasets share, read with no package',
        code: 'widget_not_probed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            getItem: refusedDataset('ambiguous-in-environment', null),
            analytics: analyticsReturning({ rows: [{ total: 1 }] }),
            published: DASHBOARD,
        }),
        params: (tag) => ({ ...widgetNames(tag), dataset: 'crm_task_totals', cause: 'several-holders' }),
        hidden: ['crm_board', 'w_open_tasks', ALPHA, BETA],
    },
    {
        title: 'a widget whose query returns nothing over an object that has rows',
        code: 'empty_query', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ analytics: analyticsReturning({ rows: [] }), published: DASHBOARD }),
        params: (tag) => ({ ...widgetNames(tag), dataset: said(DATASET, tag, 'crm_task_totals'), object: TASKS }),
        hidden: ['crm_board', 'w_open_tasks', 'crm_task'],
    },
    {
        title: 'a widget refused read access to an object: the one the refusal names, a joined object',
        code: 'widget_query_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            analytics: analyticsThrowing('[Analytics] Access denied: reading "crm_project" is not permitted for this user.', {
                code: 'PERMISSION_DENIED',
                status: 403,
                object: 'crm_project',
            }),
            published: DASHBOARD,
        }),
        params: (tag) => ({
            ...widgetNames(tag),
            dataset: said(DATASET, tag, 'crm_task_totals'),
            // By the API name the refusal names: the caller was not admitted
            // to that object, so the probe reads nothing of it, label included.
            object: 'crm_project',
            cause: 'access',
        }),
        hidden: ['crm_board', 'w_open_tasks', 'crm_task', PROJECTS, 'PERMISSION_DENIED', 'Access denied'],
        // An access refusal is not about the dataset, so the sentence does not name it.
        silent: ['dataset'],
    },
    {
        title: 'a widget refused read access to fields of its object',
        code: 'widget_query_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            analytics: analyticsThrowing('[Analytics] Access denied: field "amount" of "crm_task" is not readable.', {
                code: 'PERMISSION_DENIED',
                status: 403,
                object: 'crm_task',
                fields: ['amount'],
            }),
            published: DASHBOARD,
        }),
        params: (tag) => ({
            ...widgetNames(tag),
            dataset: said(DATASET, tag, 'crm_task_totals'),
            object: 'crm_task',
            cause: 'field-access',
        }),
        hidden: ['crm_board', 'w_open_tasks', TASKS, 'amount'],
        silent: ['dataset'],
    },
    {
        title: 'a widget refused read access, with no object to name',
        code: 'widget_query_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            analytics: analyticsThrowing('[Analytics] Access denied.', { code: 'PERMISSION_DENIED', status: 403 }),
            published: DASHBOARD_BARE,
        }),
        params: (tag) => ({
            ...widgetNames(tag),
            dataset: said(DATASET, tag, 'crm_bare_totals'),
            object: '',
            cause: 'access',
        }),
        hidden: ['crm_board_bare', 'w_open_tasks'],
        silent: ['dataset', 'object'],
    },
    {
        title: 'a widget whose read access the server could not decide',
        code: 'widget_query_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            analytics: analyticsThrowing('[Analytics] The permission resolver failed.', {
                code: 'SERVICE_UNAVAILABLE',
                status: 503,
                object: 'crm_task',
            }),
            published: DASHBOARD,
        }),
        params: (tag) => ({
            ...widgetNames(tag),
            dataset: said(DATASET, tag, 'crm_task_totals'),
            object: 'crm_task',
            cause: 'unavailable',
        }),
        hidden: ['crm_board', 'w_open_tasks', TASKS, 'SERVICE_UNAVAILABLE'],
        silent: ['dataset'],
    },
    {
        title: 'a widget whose query does not run',
        code: 'widget_query_failed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ analytics: analyticsThrowing('measure "total" is not declared'), published: DASHBOARD }),
        params: (tag) => ({
            ...widgetNames(tag),
            dataset: said(DATASET, tag, 'crm_task_totals'),
            object: TASKS,
            cause: 'query',
        }),
        hidden: ['crm_board', 'w_open_tasks', 'crm_task_totals', 'is not declared'],
        // The remedy is the dataset's, so the sentence names it and not the object.
        silent: ['object'],
    },
    {
        title: 'a widget whose query answers only zeros',
        code: 'widget_empty_result', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ analytics: analyticsReturning({ rows: [{ total: 0 }] }), published: DASHBOARD }),
        params: (tag) => ({ ...widgetNames(tag), dataset: said(DATASET, tag, 'crm_task_totals') }),
        hidden: ['crm_board', 'w_open_tasks', 'crm_task_totals'],
    },
    {
        title: 'a roll-up blank on every parent that has children',
        code: 'rollup_never_computed', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            engine: engineOver({
                crm_deal: [{ id: 'd1', acct_ref: 'a1' }, { id: 'd2', acct_ref: 'a1' }],
                crm_acct: [{ id: 'a1', open_deal_count: null }, { id: 'a2', open_deal_count: null }],
            }),
            published: [{ type: 'object', name: 'crm_acct' }],
        }),
        params: (tag) => ({ object: ACCOUNTS, field: said(OPEN_DEALS, tag, 'open_deal_count'), child: DEALS }),
        hidden: ['crm_acct', 'open_deal_count', 'crm_deal'],
    },
    {
        title: 'sample records whose reference names no record',
        code: 'seed_reference_unresolved', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({
            engine: engineOver({ crm_deal: [{ id: 'd1', name: 'Big deal', acct_ref: 'Acme Corp' }], crm_acct: [{ id: 'a1' }] }),
            published: [{ type: 'seed', name: 'crm_deal_seed' }],
        }),
        params: (tag) => ({ object: DEALS, field: said(ACCT_REF, tag, 'acct_ref'), target: ACCOUNTS, count: '1' }),
        hidden: ['crm_deal', 'acct_ref', 'crm_acct', 'Acme Corp'],
    },
    {
        title: 'a flow step whose connector name two connectors share',
        code: 'flow_connector_action_unresolved', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ automation: automationAnswering({ instance: 'refused' }), published: FLOW }),
        params: (tag) => ({ ...flowNames(tag), cause: 'refused' }),
        hidden: ['crm_erp_sync', 'push_step', 'two packages hold'],
    },
    {
        title: 'a flow step whose connector this environment does not have',
        code: 'flow_connector_action_unresolved', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ automation: automationAnswering({ instance: 'none' }), published: FLOW }),
        params: (tag) => ({ ...flowNames(tag), cause: 'no-action' }),
        hidden: ['crm_erp_sync', 'push_step', 'push'],
    },
    {
        title: 'a flow step whose connector is degraded',
        code: 'flow_connector_action_unresolved', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ automation: automationAnswering({ degraded: 'the upstream is unreachable.' }), published: FLOW }),
        params: (tag) => ({ ...flowNames(tag), cause: 'degraded' }),
        hidden: ['crm_erp_sync', 'push_step', 'unreachable'],
    },
    {
        title: 'dataset widgets and no analytics service',
        code: 'probes_unavailable', // adr0112-ok: D6c build-probe diagnostics code
        run: probe({ published: DASHBOARD }),
        params: () => ({ count: '1' }),
        hidden: ['crm_board', 'w_open_tasks'],
    },
];

/** The one code whose run needs a mocked lint root; rendered here, run in `build-probes-rule-failure.test.ts`. */
const RULE_FAILED: RuntimeBuildIssueCode = 'object_field_ref_rule_failed'; // adr0112-ok: D6c build-probe diagnostics code

/** A request locale that names each platform locale, as a browser would send it. */
const REQUEST_LOCALE: Readonly<Record<PlatformLocaleTag, string>> = {
    en: 'en-US',
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
    es: 'es-MX',
    ar: 'ar-SA',
    fr: 'fr-FR',
    'pt-BR': 'pt-BR',
    ru: 'ru-RU',
    de: 'de-DE',
    ja: 'ja-JP',
    ko: 'ko-KR',
};

const onlyIssue = (report: BuildProbeReport) => {
    expect(report.issues).toHaveLength(1);
    return report.issues[0]!;
};

describe('every probe finding carries the person\'s sentence, in the request\'s language', () => {
    for (const c of CASES) {
        it(`${c.code}: ${c.title}`, async () => {
            const baseline = onlyIssue(await c.run());
            expect(baseline.code).toBe(c.code);
            // With no locale stated, the ladder's floor answers.
            expect(baseline.userMessage).toBe(BUILD_PROBE_USER_TEXT[c.code].en(c.params('en')));

            for (const tag of PLATFORM_LOCALE_TAGS) {
                const report = await c.run([REQUEST_LOCALE[tag]]);
                const issue = onlyIssue(report);
                const params = c.params(tag);
                const template = BUILD_PROBE_USER_TEXT[c.code][tag];
                expect(template, `${c.code} has a ${tag} sentence`).toBeTypeOf('function');

                // 1 · the sentence of this code and cause, from the names the probe read.
                expect(issue.userMessage, `${c.code} in ${tag}`).toBe(template!(params));
                expect(issue.userMessage).not.toMatch(/undefined|\$\{|\[object/);

                // 2 · it shows each name it was given, by label, and no API name behind a label.
                for (const [key, value] of Object.entries(params)) {
                    if (key === 'cause' || value === '' || c.silent?.includes(key)) continue;
                    expect(issue.userMessage, `${c.code} in ${tag} names its ${key}`).toContain(value);
                }
                for (const apiName of c.hidden) {
                    expect(issue.userMessage, `${c.code} in ${tag} hides "${apiName}"`).not.toContain(apiName);
                }

                // 4 · the agent's channel does not move with the locale.
                expect(issue.message).toBe(baseline.message);
                expect(issue.fix).toBe(baseline.fix);
                expect(issue.code).toBe(baseline.code);

                // 5 · declared = returned: the modeled `probes` strips nothing.
                expect(RuntimeBuildIssueSchema.parse(issue)).toEqual(issue);
                expect(BuildProbeReportSchema.parse(report)).toEqual(report);
            }
        });
    }

    it('reads as written: the sentences a person sees, in English and in Chinese', async () => {
        const byTitle = (title: string) => CASES.find((c) => c.title === title)!;

        const seed = byTitle('a seed whose object has no rows');
        expect(onlyIssue(await seed.run(['en-US'])).userMessage).toBe(
            'The sample data for "Tasks" did not load, so "Tasks" has no records yet. Check the sample data, then publish again.',
        );
        expect(onlyIssue(await seed.run(['zh-CN'])).userMessage).toBe(
            '“Tasks”的示例数据没有加载成功，所以“Tasks”中还没有任何记录。请检查示例数据，然后重新发布。',
        );

        const empty = byTitle('a widget whose query returns nothing over an object that has rows');
        expect(onlyIssue(await empty.run(['en-US'])).userMessage).toBe(
            'The widget "Open tasks" on dashboard "Team board" shows no data, although "Tasks" has records. '
                + 'Check the fields that its dataset "Task totals" measures and groups by, then publish again.',
        );
        expect(onlyIssue(await empty.run(['zh-CN'])).userMessage).toBe(
            '仪表盘“团队看板”中的组件“未完成任务”没有显示任何数据，但“Tasks”中有记录。'
                + '请检查它的数据集“任务汇总”用于度量和分组的字段，然后重新发布。',
        );

        const refused = byTitle('a widget refused read access to an object: the one the refusal names, a joined object');
        expect(onlyIssue(await refused.run(['en-US'])).userMessage).toBe(
            'The widget "Open tasks" on dashboard "Team board" could not load its data: the account that published it '
                + 'does not have read access to "crm_project". Ask an administrator for that access, then publish again. '
                + 'People who already have it can see the widget.',
        );

        const bare = byTitle('a widget refused read access, with no object to name');
        expect(onlyIssue(await bare.run(['en-US'])).userMessage).toContain('read access to the data it reads.');
    });

    it('an object the caller was refused, or whose access the server could not decide, is not read for its label', async () => {
        const failures = [
            { code: 'PERMISSION_DENIED', status: 403, object: 'crm_project' },
            { code: 'PERMISSION_DENIED', status: 403, object: 'crm_task', fields: ['amount'] },
            { code: 'SERVICE_UNAVAILABLE', status: 503, object: 'crm_task' },
        ];
        for (const fields of failures) {
            const reads: string[] = [];
            const report = await runBuildProbes({
                engine: engineWithRows,
                getItem: async (type, name) => {
                    reads.push(`${type} ${name}`);
                    return ITEMS[`${type} ${name}`];
                },
                analytics: analyticsThrowing('[Analytics] refused', fields),
                published: DASHBOARD,
                userTextLocales: ['en-US'],
            });
            const issue = onlyIssue(report);
            expect(issue.userMessage).toContain(`"${fields.object}"`);
            // The fix names the same object by the same name.
            expect(issue.fix).toContain(`object "${fields.object}"`);
            expect(reads.filter((r) => r.startsWith('object ')), JSON.stringify(fields)).toEqual([]);
        }

        // CONTROL: a query that fails for another reason reads the dataset's object for its label.
        const reads: string[] = [];
        const report = await runBuildProbes({
            engine: engineWithRows,
            getItem: async (type, name) => {
                reads.push(`${type} ${name}`);
                return ITEMS[`${type} ${name}`];
            },
            analytics: analyticsThrowing('measure "total" is not declared'),
            published: DASHBOARD,
            userTextLocales: ['en-US'],
        });
        expect(onlyIssue(report).code).toBe('widget_query_failed'); // adr0112-ok: D6c build-probe diagnostics code
        expect(reads).toContain('object crm_task');
    });

    it('the agent\'s text stays English and stays where it was: message and fix are not translated', async () => {
        const issue = onlyIssue(await CASES[0]!.run(['zh-CN']));
        expect(issue.message).toBe(
            'Seed "crm_task_seed" was published but object "crm_task" has no rows — the sample data never materialized.',
        );
        expect(issue.fix).toBe(
            "Check the publish response's seedApplied for the load error, fix the seed rows (field names/types), and republish the seed.",
        );
        // CONTROL: the same finding's other channel IS in the request's language.
        expect(issue.userMessage).toMatch(/[一-鿿]/);
        expect(`${issue.message}${issue.fix}`).not.toMatch(/[一-鿿]/);
    });
});

describe('the ladder: the request\'s locale, else the workspace default, else en', () => {
    const seed = CASES[0]!;
    const sentenceIn = (tag: PlatformLocaleTag) => BUILD_PROBE_USER_TEXT.seed_not_applied[tag]!(seed.params(tag));

    it.each<[string, Locales, PlatformLocaleTag]>([
        ['the request\'s locale wins over the workspace default', ['fr-FR', 'zh-CN'], 'fr'],
        ['no request locale: the workspace default answers', [undefined, 'zh-CN'], 'zh-Hans'],
        ['a request locale that names no platform locale takes the next rung', ['tlh', 'ja-JP'], 'ja'],
        ['neither names a platform locale: en', ['tlh', 'xx-YY'], 'en'],
        ['no candidates at all: en', [], 'en'],
        ['a region reads as its language', ['de-AT'], 'de'],
        ['Traditional Chinese is never handed the Simplified sentence', ['zh-TW'], 'zh-Hant'],
        ['a script subtag decides before a region does', ['zh-Hant-HK'], 'zh-Hant'],
    ])('%s', async (_title, locales, expected) => {
        const issue = onlyIssue(await seed.run(locales));
        expect(issue.userMessage).toBe(sentenceIn(expected));
        if (expected !== 'en') expect(issue.userMessage).not.toBe(sentenceIn('en'));
    });

    it('absent `userTextLocales` is the en floor, not a missing sentence', async () => {
        const issue = onlyIssue(await seed.run());
        expect(issue.userMessage).toBe(sentenceIn('en'));
    });
});

describe('a sentence names an artifact by its label where the probe can read one', () => {
    it('the label is resolved for the sentence\'s language, with the label map\'s own fallback', async () => {
        const empty = CASES.find((x) => x.code === 'empty_query')!; // adr0112-ok: D6c build-probe diagnostics code
        // `de` is a key of the dashboard's label map and of no other label here.
        const german = onlyIssue(await empty.run(['de-DE'])).userMessage!;
        expect(german).toContain('„Teamübersicht“');
        expect(german).toContain('„Open tasks“'); // the widget's map has no `de`: its English entry
        // `zh-CN` is a key of every map.
        const chinese = onlyIssue(await empty.run(['zh-CN'])).userMessage!;
        expect(chinese).toContain('“团队看板”');
        expect(chinese).toContain('“未完成任务”');
        expect(chinese).toContain('“任务汇总”');
    });

    it('an artifact with no label, a blank label, or a body the probe cannot read shows its API name', async () => {
        const items: Record<string, unknown> = {
            'seed s_plain': { object: 'crm_plain' },
            'object crm_plain': { name: 'crm_plain', fields: {} },
            'seed s_blank': { object: 'crm_blank' },
            'object crm_blank': { name: 'crm_blank', label: '   ', fields: {} },
            'seed s_gone': { object: 'crm_gone' },
            'dashboard crm_untitled': {
                name: 'crm_untitled',
                widgets: [{ id: 'w_untitled', dataset: 'crm_unlabelled_ds', values: ['total'] }],
            },
            'dataset crm_unlabelled_ds': { name: 'crm_unlabelled_ds', object: 'crm_gone', measures: [{ name: 'total' }] },
        };
        const report = await runBuildProbes({
            engine: engineEmpty,
            getItem: async (type, name) => items[`${type} ${name}`],
            analytics: analyticsThrowing('measure "total" is not declared'),
            published: [
                { type: 'seed', name: 's_plain' },
                { type: 'seed', name: 's_blank' },
                { type: 'seed', name: 's_gone' },
                { type: 'dashboard', name: 'crm_untitled' },
            ],
            userTextLocales: ['en-US'],
        });
        const sentences = report.issues.map((i) => i.userMessage);
        expect(sentences).toEqual([
            buildProbeUserMessage('seed_not_applied', { object: 'crm_plain', cause: 'no-rows' }, ['en']),
            buildProbeUserMessage('seed_not_applied', { object: 'crm_blank', cause: 'no-rows' }, ['en']),
            buildProbeUserMessage('seed_not_applied', { object: 'crm_gone', cause: 'no-rows' }, ['en']),
            buildProbeUserMessage(
                'widget_query_failed',
                { dashboard: 'crm_untitled', widget: 'w_untitled', dataset: 'crm_unlabelled_ds', object: 'crm_gone', cause: 'query' },
                ['en'],
            ),
        ]);
        expect(sentences[3]).toContain('"w_untitled" on dashboard "crm_untitled"');
        expect(sentences[3]).toContain('dataset "crm_unlabelled_ds"');
    });

    it('a label read that throws is the API name, never a failed probe', async () => {
        const report = await runBuildProbes({
            engine: engineEmpty,
            getItem: async (type, name) => {
                if (type === 'object') throw new Error('the metadata store is unreachable');
                return ITEMS[`${type} ${name}`];
            },
            published: [{ type: 'seed', name: 'crm_task_seed' }],
            userTextLocales: ['en-US'],
        });
        expect(onlyIssue(report).userMessage).toBe(
            buildProbeUserMessage('seed_not_applied', { object: 'crm_task', cause: 'no-rows' }, ['en']),
        );
    });
});

describe('the catalog holds exactly the probe\'s codes, each in every platform locale', () => {
    /** Every code literal the probe source emits, read from the tree. */
    const emitted = (): string[] => {
        const source = readFileSync(new URL('./build-probes.ts', import.meta.url), 'utf8');
        return [...new Set([...source.matchAll(/^\s+code: '([a-z_]+)',$/gm)].map((m) => m[1]!))].sort();
    };

    it('one entry per code the probe emits, and none it does not', () => {
        const codes = emitted();
        // CONTROL: the scan really found the emit sites (a regex that matched
        // nothing would make every comparison below pass on two empty lists).
        expect(codes.length).toBeGreaterThanOrEqual(8);
        expect(Object.keys(BUILD_PROBE_USER_TEXT).sort()).toEqual(codes);
    });

    it('every code is exercised by a real run: the cases above plus the rule-failure suite', () => {
        const exercised = [...new Set([...CASES.map((c) => c.code), RULE_FAILED])].sort();
        expect(exercised).toEqual(emitted());
    });

    it('every entry answers in every platform locale, and in no other', () => {
        for (const [code, entry] of Object.entries(BUILD_PROBE_USER_TEXT)) {
            expect(Object.keys(entry).sort(), code).toEqual([...PLATFORM_LOCALE_TAGS].sort());
        }
    });

    it('each locale has its own wording: no sentence is the English one, and no two branches share a sentence', () => {
        const rendered = [
            ...CASES.map((c) => ({ code: c.code, params: c.params })),
            { code: RULE_FAILED, params: () => ({ object: TASKS }) },
        ];
        for (const tag of PLATFORM_LOCALE_TAGS) {
            const sentences = rendered.map((r) => BUILD_PROBE_USER_TEXT[r.code][tag]!(r.params(tag)));
            expect(new Set(sentences).size, `distinct sentences in ${tag}`).toBe(sentences.length);
            for (const s of sentences) expect(s).not.toMatch(/undefined|\$\{|\[object/);
            if (tag === 'en') continue;
            rendered.forEach((r, i) => {
                expect(sentences[i], `${r.code} in ${tag}`).not.toBe(BUILD_PROBE_USER_TEXT[r.code].en(r.params(tag)));
            });
        }
    });

    it('the rule-failure sentence names the object and says the check is what failed', () => {
        for (const tag of PLATFORM_LOCALE_TAGS) {
            expect(BUILD_PROBE_USER_TEXT[RULE_FAILED][tag]!({ object: TASKS })).toContain(TASKS);
        }
        expect(BUILD_PROBE_USER_TEXT[RULE_FAILED].en({ object: TASKS })).toBe(
            '"Tasks" was published, but its field settings could not be checked. The problem is in the check itself, '
                + 'not necessarily in "Tasks"; contact your administrator if it happens again.',
        );
    });
});
