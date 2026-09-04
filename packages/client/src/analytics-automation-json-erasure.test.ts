// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12104 — the in-repo half; #13079 — the convergence] What the five
 * `analytics.*` / `automation.trigger` methods actually resolve to, measured
 * against their REAL producers.
 *
 * ## The erasure these five carried
 *
 * Each method carried no return annotation and never named `any`, `Promise` or
 * `unwrapResponse` — so no grep could see it — while its published type was
 * `Promise< any >`, inherited from `lib.dom`'s `Response.json(): Promise< any >`.
 *
 * ## The half a wire test can prove, and the half it cannot
 *
 * `return-type-precision.test.ts`'s header states the rule and it is why this
 * file exists as the second half of the pair:
 *
 *   - a runtime test cannot observe a return-type narrowing at all — the value
 *     is identical whatever the declaration says. The DECLARATION half is
 *     pinned type-level in `return-type-precision.test.ts`.
 *   - a type test cannot observe whether the declaration is TRUE. That is this
 *     file's job, and it is why nothing here mocks a response body: a mock body
 *     would assert my own assumption about the producer, which is the mistake
 *     that produces a bound-but-false declaration.
 *
 * So every chain below is real end to end — the real `AnalyticsService`
 * (`@objectstack/service-analytics`), the real `AutomationEngine`
 * (`@objectstack/service-automation`), the real `HttpDispatcher`
 * (`@objectstack/runtime`) and the real `RestServer` (`@objectstack/rest`)
 * answering them, and the real `ObjectStackClient` reading the result. The only
 * stand-in is the socket: `fetch` hands the request to the producer in-process
 * instead of over TCP, and hands back the producer's own body untouched.
 *
 * ## The load-bearing fact these five share, and the one that splits them
 *
 * `unwrapResponse` strips the `{ success, data }` envelope; `res.json()` does
 * NOT. The shape of the body is decided by which surface serves the route,
 * and the reader has to match it:
 *
 *   - `query` / `meta` / `explain` and `automation.trigger` are DISPATCHER
 *     routes, and every dispatcher domain answers through `deps.success(v)` —
 *     `{ success: true, data: v }`. Since #13079 (maintainer ruling
 *     2026-08-31, option A) all four end `unwrapResponse`, so they resolve to
 *     `v`; until then they ended `res.json()` and resolved to the envelope,
 *     which #12104 had stated in their declarations.
 *   - `queryDataset` is a REST route (`@objectstack/rest` mounts it; the
 *     dispatcher mounts no twin) and it answers `res.json(result)` — BARE. It
 *     keeps `res.json()`, which there IS the payload read; ⛔ PROTECTED by the
 *     ruling from being "converged" into the others' shape.
 *
 * So all five now resolve to `v`, by two different readers, and each
 * (reader, surface) pair is driven here against the real producer: converting
 * the bare route to `unwrapResponse`, or sliding a dispatcher route back to
 * `res.json()`, would leave the declarations false with no type error — this
 * file's cases are what go red. Hence one driven case per method rather than
 * a family-wide assumption.
 *
 * ## Two spec response schemas WERE narrower than their producer — measured here
 *
 * When #12104 landed, `AnalyticsResultResponseSchema.data` and
 * `TriggerFlowResponseSchema.data` were stale projections of
 * `AnalyticsResult` / `AutomationResult`: the fixtures below serve keys those
 * schemas did not then declare (`fields[].label`, and a paused run's
 * `status` / `runId` / `screen`). That is why the two annotations bind the
 * PRODUCER's contract type rather than those two response types — binding
 * them would have been a false narrowing of exactly the kind #12034 removed.
 * #13078 has since widened both schemas to parity (pinned schema ≡ contract
 * in `spec/api/analytics.test.ts` / `spec/api/automation-api.zod.test.ts`);
 * the annotations stay on the contracts, which are the source the routes
 * relay. The other two route schemas (`AnalyticsMetadataResponseSchema`,
 * `AnalyticsSqlResponseSchema`) agreed with their producer's declared return
 * all along, and the annotations use them.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Removing an annotation from any of the five leaves THIS file green — the wire
 * value does not change — and turns `return-type-precision.test.ts` RED under
 * `tsc`, plus `check:exported-any-returns` red on the un-deleted ledger entry.
 * Reverting one of the four #13079 conversions (`unwrapResponse` back to
 * `res.json()`) turns THIS file red on that method's case — the resolved value
 * regains the envelope — and `return-type-precision.test.ts` red on its
 * reversed pin. Both asymmetries are why the files exist as a pair.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { Logger } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AnalyticsService } from '@objectstack/service-analytics';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { HttpDispatcher } from '@objectstack/runtime';
import { RestServer } from '@objectstack/rest';
import { ObjectStackClient } from './index';

const BASE_URL = 'http://localhost:3000';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const CONTEXT = (): any => ({
    request: {},
    executionContext: { userId: 'usr_1', isSystem: false, systemPermissions: [] },
});

// ─────────────────────────────────────────────────────────────────────────────
// analytics — a REAL AnalyticsService on the native-SQL path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One cube with a LABELLED measure and dimension. The labels are load-bearing
 * rather than decorative: `AnalyticsResult.fields[].label` was a key
 * `AnalyticsResultResponseSchema.data.fields` did not declare when #12104
 * measured it, so serving it is what proved that schema a narrower projection
 * than the producer's contract — the measurement the annotation choice rests
 * on (#13078 has since widened the schema to parity; the served key is the
 * evidence either way).
 */
const ACCOUNT_CUBE: Cube = {
    name: 'crm_account',
    title: 'Accounts',
    sql: 'crm_account',
    measures: {
        account_count: { name: 'account_count', label: 'Account count', type: 'count', sql: '*' },
    },
    dimensions: {
        industry: { name: 'industry', label: 'Industry', type: 'string', sql: 'industry' },
    },
};

const ROWS = [{ industry: 'tech', account_count: 3 }];

/**
 * The ADR-0021 dataset the REST-served `queryDataset` route runs. Its dimension
 * carries a `label` on purpose: the dataset executor enriches
 * `AnalyticsResult.fields[].label` from it — the key whose serving proved the
 * pre-#13078 schema narrower than the contract (see the cube above).
 */
const DATASET = {
    name: 'account_metrics',
    label: 'Account metrics',
    object: 'crm_account',
    dimensions: [{ name: 'industry', label: 'Industry', field: 'industry', type: 'string' }],
    measures: [{ name: 'account_count', label: 'Account count', aggregate: 'count' }],
};

function realAnalytics(): AnalyticsService {
    return new AnalyticsService({
        cubes: [ACCOUNT_CUBE],
        logger: silent as any,
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
        executeRawSql: async () => ROWS,
        isRegisteredObject: (n: string) => n === 'crm_account',
        getObjectFieldNames: (n: string) => (n === 'crm_account' ? ['id', 'industry'] : undefined),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// automation — a REAL AutomationEngine that PAUSES at a screen node
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `resumeAuthority: 'any'` because a node type declaring none is gated shut
 * since #5561; this fixture only needs the pause to be reachable.
 */
const gate = defineActionDescriptor({
    type: 'gate',
    version: '1.0.0',
    name: 'gate',
    supportsPause: true,
    resumeAuthority: 'any',
});

/**
 * start → gate (pauses) → end. A PAUSED run is chosen deliberately: it is the
 * arm whose `AutomationResult` carries `status` / `runId` / `screen`, none of
 * which `TriggerFlowResponseSchema.data` declared before #13078 widened it.
 */
function realAutomation(): AutomationEngine {
    const engine = new AutomationEngine(
        { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } as never,
        new InMemorySuspendedRunStore(),
    );
    engine.registerNodeExecutor({
        type: 'gate',
        descriptor: gate,
        async execute() {
            return {
                success: true,
                suspend: true,
                correlation: 'approval:req-1',
                screen: {
                    nodeId: 'gate',
                    title: 'Approve the account',
                    fields: [{ name: 'verdict', type: 'text', label: 'Verdict' }],
                },
            };
        },
    } as never);
    engine.registerFlow('approve_account', {
        name: 'approve_account',
        label: 'Approve account',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'gate', type: 'gate', label: 'Approval' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'gate' },
            { id: 'e1', source: 'gate', target: 'end' },
        ],
    } as never);
    return engine;
}

// ─────────────────────────────────────────────────────────────────────────────
// the in-process socket
// ─────────────────────────────────────────────────────────────────────────────

/** The REST route object for `POST {base}/analytics/dataset/query`, really registered. */
function datasetRoute(analytics: AnalyticsService) {
    const noopServer = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
    };
    const rest = new RestServer(
        noopServer as any, protocol as any, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        async () => analytics,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'usr_1' });
    rest.registerRoutes();
    const route = rest.getRoutes().find(
        (r: any) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'),
    );
    expect(route, 'POST /analytics/dataset/query must be mounted by @objectstack/rest').toBeTruthy();
    return route as any;
}

/**
 * Everything either side of this function is production code: the URL the
 * client built goes in, the body the producer wrote comes back, and nothing in
 * between rewrites a key.
 */
function producerBackedClient() {
    const analytics = realAnalytics();
    const automation = realAutomation();
    const services: Record<string, unknown> = { analytics, automation };
    const resolve = (name: string): unknown => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const dataset = datasetRoute(analytics);

    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const query = Object.fromEntries(parsed.searchParams);

        // The REST-served route first — it is a longer prefix of the same family.
        if (parsed.pathname === '/api/v1/analytics/dataset/query') {
            const res: any = { statusCode: 200, body: undefined };
            res.status = (c: number) => { res.statusCode = c; return res; };
            res.json = (b: any) => { res.body = b; return res; };
            res.end = () => res;
            await dataset.handler({ method: 'POST', params: {}, headers: {}, query, body } as any, res);
            return {
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: String(res.statusCode),
                headers: new Headers(),
                json: async () => res.body,
            };
        }

        const dispatched = parsed.pathname.startsWith('/api/v1/analytics')
            ? await dispatcher.handleAnalytics(
                parsed.pathname.slice('/api/v1/analytics'.length), method, body, CONTEXT(), query)
            : await dispatcher.handleAutomation(
                parsed.pathname.slice('/api/v1/automation'.length), method, body, CONTEXT(), query);

        expect(dispatched.handled, `the dispatcher must serve ${method} ${parsed.pathname}`).toBe(true);
        const status = dispatched.response?.status ?? 500;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            headers: new Headers(),
            json: async () => dispatched.response?.body,
        };
    };

    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchImpl as any });
    return { client, dispatcher, analytics, automation };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('#13079 — the four DISPATCHER-served methods resolve to the PAYLOAD, measured against the real producers', () => {
    it('analytics.query answers the AnalyticsResult itself — the producer\'s own return, no envelope', async () => {
        const { client, analytics } = producerBackedClient();

        const result = await client.analytics.query({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        });

        // ① The payload is the value — NOT the envelope. Before #13079 the
        //    keys here were `['data', 'meta', 'success']`; `unwrapResponse`
        //    strips exactly that layer and nothing else.
        expect('success' in result).toBe(false);
        expect('data' in result).toBe(false);
        // ② …and the value is verbatim what the producer's own contract method
        //    returned, asserted against a second call to the service itself
        //    rather than against a literal written here.
        expect(result).toEqual(await analytics.query({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        }));
        expect(result.rows).toEqual(ROWS);
    });

    it('analytics.meta answers the bare CubeMeta[] — no envelope, no `cubes` wrapper', async () => {
        const { client, analytics } = producerBackedClient();

        const cubes = await client.analytics.meta();

        expect(cubes).toEqual(await analytics.getMeta());
        // A BARE array — there is no `cubes` wrapper (#6442) and, since
        // #13079, no `{ success, data }` around it either.
        expect(Array.isArray(cubes)).toBe(true);
        expect(cubes[0]?.name).toBe('crm_account');
        expect(cubes[0]?.measures.map((m) => m.name)).toContain('crm_account.account_count');
    });

    it('analytics.explain answers `{ sql, params }`', async () => {
        const { client } = producerBackedClient();

        const dryRun = await client.analytics.explain({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        });

        expect(Object.keys(dryRun).sort()).toEqual(['params', 'sql']);
        expect(dryRun.sql).toMatch(/SELECT/i);
        expect(Array.isArray(dryRun.params)).toBe(true);
    });

    it('automation.trigger answers the AutomationResult — the whole run, the same value `execute` answers', async () => {
        const { client } = producerBackedClient();

        const run = await client.automation.trigger('approve_account', {});

        // The keys `TriggerFlowResponseSchema.data` did NOT declare before
        // #13078, served by the real engine and — since #13079 — read at the
        // top level, exactly where `automation.execute` has always put them.
        expect(run.status).toBe('paused');
        expect(typeof run.runId).toBe('string');
        expect(run.screen?.title).toBe('Approve the account');
        // `AutomationResult` carries its OWN `success`; the envelope's is gone.
        expect(run.success).toBe(true);
        expect('data' in run).toBe(false);
    });
});

describe('#12104 — the REST-served method resolves to the BARE payload', () => {
    it('analytics.queryDataset answers the AnalyticsResult itself, with no envelope', async () => {
        const { client } = producerBackedClient();

        const body = await client.analytics.queryDataset({
            dataset: DATASET,
            selection: { measures: ['account_count'], dimensions: ['industry'] },
        });

        // No envelope keys at all — the route ends `res.json(result)`.
        expect('success' in (body as object)).toBe(false);
        expect('data' in (body as object)).toBe(false);
        // …and the payload is right there at the top level.
        expect(body.rows).toEqual(ROWS);
        expect(Array.isArray(body.fields)).toBe(true);
    });

    it('and it serves the `fields[].label` that proved the pre-#13078 response schema narrower', async () => {
        // The measurement behind one of the two annotation choices. `query` and
        // `queryDataset` are the SAME contract return — `IAnalyticsService`
        // declares `Promise< AnalyticsResult >` for both — so a key the service
        // really emits is a key `AnalyticsResult` really carries. When #12104
        // measured this, `AnalyticsResultResponseSchema.data.fields` declared
        // only `{ name, type }`, so binding that schema on `analytics.query`
        // would have been a FALSE narrowing of the contract the route relays;
        // #13078 has since widened the schema to parity with the contract.
        const { client } = producerBackedClient();

        const body = await client.analytics.queryDataset({
            dataset: DATASET,
            selection: { measures: ['account_count'], dimensions: ['industry'] },
        });

        const labelled = (body.fields ?? []).filter((f) => f.label !== undefined);
        expect(labelled.map((f) => f.label)).toContain('Industry');
    });
});

describe('#13079 — the premise the four payload annotations rest on', () => {
    it('the dispatcher wraps exactly once, and `unwrapResponse` strips exactly once', async () => {
        // Runtime-observable and deliberately so: every payload annotation
        // describes the POST-unwrap value, so if a domain stopped wrapping (the
        // SDK would then hand back `data`'s `data`, or the pass-through) or a
        // method slid back to `res.json()` (the envelope would return) the
        // declarations would become false without a single type error.
        const { client, dispatcher } = producerBackedClient();

        const raw = await dispatcher.handleAnalytics('/meta', 'GET', undefined, CONTEXT(), {});
        const produced: any = raw.response?.body;

        expect(produced.success).toBe(true);
        expect(Array.isArray(produced.data)).toBe(true);

        // The SDK hands the caller the producer's `data` — one envelope
        // stripped, nothing else touched.
        expect(await client.analytics.meta()).toEqual(produced.data);
    });
});
