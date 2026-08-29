// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12104 — the in-repo half] What the five `return res.json()` methods of the
 * `analytics.*` / `automation.*` families actually resolve to, measured against
 * their REAL producers.
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
 * NOT. So a `res.json()` method resolves to the WHOLE body, and the shape of
 * that body is decided by which surface serves the route:
 *
 *   - `query` / `meta` / `explain` and `automation.trigger` are DISPATCHER
 *     routes, and every dispatcher domain answers through `deps.success(v)` —
 *     `{ success: true, data: v }`. Their true type is the envelope, not `v`.
 *   - `queryDataset` is a REST route (`@objectstack/rest` mounts it; the
 *     dispatcher mounts no twin) and it answers `res.json(result)` — BARE. Its
 *     true type is `v` itself.
 *
 * Binding the payload where the envelope is served (or the reverse) would
 * typecheck against `any` and ship a false declaration, which is the census's
 * highest-risk band (`return-type-precision.test.ts`, shape class 2). Hence one
 * driven case per method rather than a family-wide assumption.
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
 * That asymmetry is the whole reason both files exist; the ablation is recorded
 * on the PR against the halves a declaration change can move.
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

describe('#12104 — the four DISPATCHER-served methods resolve to the envelope, not the payload', () => {
    it('analytics.query answers `{ success, data: AnalyticsResult }`', async () => {
        const { client, analytics } = producerBackedClient();

        const body = await client.analytics.query({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        });

        // ① The envelope is the value — NOT the payload. This is the whole
        //    difference between `res.json()` and `unwrapResponse`.
        expect(Object.keys(body).sort()).toEqual(['data', 'meta', 'success']);
        expect(body.success).toBe(true);
        // ② …and `data` is verbatim what the producer's own contract method
        //    returned, asserted against a second call to the service itself
        //    rather than against a literal written here.
        expect(body.data).toEqual(await analytics.query({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        }));
        expect(body.data.rows).toEqual(ROWS);
    });

    it('analytics.meta answers `{ success, data: CubeMeta[] }`', async () => {
        const { client, analytics } = producerBackedClient();

        const body = await client.analytics.meta();

        expect(body.success).toBe(true);
        expect(body.data).toEqual(await analytics.getMeta());
        // A BARE array under `data` — there is no `cubes` wrapper (#6442).
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data[0]?.name).toBe('crm_account');
        expect(body.data[0]?.measures.map((m) => m.name)).toContain('crm_account.account_count');
    });

    it('analytics.explain answers `{ success, data: { sql, params } }`', async () => {
        const { client } = producerBackedClient();

        const body = await client.analytics.explain({
            cube: 'crm_account',
            measures: ['account_count'],
            dimensions: ['industry'],
        });

        expect(body.success).toBe(true);
        expect(Object.keys(body.data).sort()).toEqual(['params', 'sql']);
        expect(body.data.sql).toMatch(/SELECT/i);
        expect(Array.isArray(body.data.params)).toBe(true);
    });

    it('automation.trigger answers `{ success, data: AutomationResult }` — the whole result', async () => {
        const { client } = producerBackedClient();

        const body = await client.automation.trigger('approve_account', {});

        expect(body.success).toBe(true);
        // The keys `TriggerFlowResponseSchema.data` did NOT declare before
        // #13078, served by the real engine: this measurement is why the
        // annotation binds `AutomationResult` (and, since #13078, why the
        // schema had to move to parity with it).
        expect(body.data.status).toBe('paused');
        expect(typeof body.data.runId).toBe('string');
        expect(body.data.screen?.title).toBe('Approve the account');
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

describe('#12104 — the premise the four envelope annotations rest on', () => {
    it('the dispatcher wraps exactly once, and `res.json()` strips nothing', async () => {
        // Runtime-observable and deliberately so: every envelope annotation this
        // card adds describes the PRE-unwrap value, so if a domain stopped
        // wrapping (or the SDK started unwrapping here) the declarations would
        // become false without a single type error.
        const { client, dispatcher } = producerBackedClient();

        const raw = await dispatcher.handleAnalytics('/meta', 'GET', undefined, CONTEXT(), {});
        const produced: any = raw.response?.body;

        expect(produced.success).toBe(true);
        expect(Array.isArray(produced.data)).toBe(true);

        // The SDK hands the caller the producer's body itself — envelope included.
        expect(await client.analytics.meta()).toEqual(produced);
    });
});
