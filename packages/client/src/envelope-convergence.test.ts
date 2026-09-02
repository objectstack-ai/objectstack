// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13079] `analytics.query` / `analytics.meta` / `analytics.explain` and
 * `automation.trigger` resolve to the PAYLOAD — the value under the
 * dispatcher's `{ success, data }` envelope — through `unwrapResponse`, the
 * reader every other dispatcher-served method of `ObjectStackClient` uses.
 * One SDK, one calling convention (maintainer ruling on #13079, 2026-08-31:
 * option A, with the `cloud` population ruled NOT MEASURED).
 *
 * ## What this file pins, and what its sibling pins instead
 *
 * The transport is MOCKED here on purpose. `fetch` answers a literal
 * dispatcher body, so every assertion below is about what the SDK DOES with
 * such a body — strips the envelope exactly once, hands `data` back, changes
 * nothing on the rejection path. Whether the body a real producer sends has
 * that shape is a different question, and
 * `analytics-automation-json-erasure.test.ts` answers it by driving the real
 * `AnalyticsService`, `AutomationEngine`, `HttpDispatcher` and `RestServer`.
 * Two halves, separately falsifiable: a mocked body cannot vouch for the
 * producer, and a producer-backed run cannot isolate the reader.
 *
 * ## Red first
 *
 * Against the pre-#13079 client every payload case in section 1 FAILS: the
 * four methods ended `return res.json()`, which strips nothing, so `value`
 * was the envelope — `value.rows` undefined, `'success' in value` true. The
 * `'success' in value` / `'data' in value` refusals are the direction that
 * catches a HALF-conversion: a method switched to `unwrapResponse` against a
 * route that answered bare would still satisfy the equality, and only the key
 * refusals say the envelope was really there to strip.
 *
 * ## The failure path, stated per door — the migration's sharpest edge
 *
 * `unwrapResponse` NEVER throws. Every non-2xx answer is thrown by
 * `ObjectStackClient.fetch` BEFORE any reader runs, carrying the ADR-0112
 * envelope on the error (`err.code`, `err.httpStatus`) — true before #13079,
 * true after it — so a `catch` written for a failed `trigger` (#9378: 400
 * `FLOW_FAILED`; #9415: 409 `FLOW_DISABLED` / 422 `FLOW_NO_START_NODE`) does
 * not change. A 2xx body WITHOUT a `data` key passes through `unwrapResponse`
 * unchanged; no dispatcher door behind these four routes sends one, and the
 * pass-through is pinned so the migration note's claim stays mechanically
 * true rather than remembered.
 *
 * `analytics.queryDataset` is the PROTECTED counter-example (ruling item 1):
 * served bare by `@objectstack/rest`, it keeps `res.json()` and resolves to
 * the same bare body — pinned last so a sweep cannot fold it in.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

const BASE_URL = 'http://localhost:3000';

/** A client whose transport answers `body` at `status`, nothing else. */
function clientAnswering(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        headers: new Headers(),
        json: async () => body,
    });
    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchMock });
    return { client, fetchMock };
}

/** The envelope every dispatcher domain answers through `deps.success(v)`. */
function enveloped<T>(data: T) {
    return { success: true as const, data, meta: { timestamp: '2026-09-02T00:00:00.000Z' } };
}

const QUERY = { cube: 'crm_account', measures: ['account_count'], dimensions: ['industry'] };

const RESULT = {
    rows: [{ industry: 'tech', account_count: 3 }],
    fields: [
        { name: 'industry', type: 'string', label: 'Industry' },
        { name: 'account_count', type: 'number', label: 'Account count' },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────

describe('#13079 §1 — the four dispatcher-served methods resolve to the PAYLOAD', () => {
    it('analytics.query resolves to the AnalyticsResult under `data`, not to the envelope', async () => {
        const { client } = clientAnswering(enveloped(RESULT));

        const value = await client.analytics.query(QUERY);

        expect(value).toEqual(RESULT);
        expect(value.rows).toEqual(RESULT.rows);
        // The envelope keys are GONE — this is what `res.json()` never did.
        expect('success' in value).toBe(false);
        expect('data' in value).toBe(false);
        expect('meta' in value).toBe(false);
    });

    it('analytics.meta resolves to the bare cube list — no `data`, no `cubes` wrapper', async () => {
        const cubes = [
            {
                name: 'crm_account',
                title: 'Accounts',
                measures: [{ name: 'crm_account.account_count', type: 'count' }],
                dimensions: [{ name: 'crm_account.industry', type: 'string' }],
            },
        ];
        const { client } = clientAnswering(enveloped(cubes));

        const value = await client.analytics.meta();

        expect(Array.isArray(value)).toBe(true);
        expect(value).toEqual(cubes);
        expect(value[0]?.name).toBe('crm_account');
        expect(value[0]?.measures.map((m) => m.name)).toEqual(['crm_account.account_count']);
    });

    it('analytics.explain resolves to `{ sql, params }`', async () => {
        const dryRun = { sql: 'SELECT industry, COUNT(*) FROM crm_account GROUP BY industry', params: [] };
        const { client } = clientAnswering(enveloped(dryRun));

        const value = await client.analytics.explain(QUERY);

        expect(Object.keys(value).sort()).toEqual(['params', 'sql']);
        expect(value.sql).toMatch(/^SELECT/);
        expect(value.params).toEqual([]);
    });

    it('automation.trigger resolves to the AutomationResult — the run itself, as `execute` does', async () => {
        // A PAUSED run: the arm whose result carries `status` / `runId` /
        // `screen`, the keys a caller most needs to reach without `.data`.
        const run = {
            success: true,
            status: 'paused',
            runId: 'run_1',
            screen: { nodeId: 'gate', title: 'Approve the account', fields: [] },
            durationMs: 4,
        };
        const { client } = clientAnswering(enveloped(run));

        const value = await client.automation.trigger('approve_account', {});

        expect(value).toEqual(run);
        expect(value.status).toBe('paused');
        expect(value.runId).toBe('run_1');
        expect(value.screen?.title).toBe('Approve the account');
        // `AutomationResult` carries its OWN `success` (the run's flag), so on
        // this door the envelope-vs-payload difference is `data`, not
        // `success`: the value has no `data` under it, and its `success` is
        // the run's, reached at the top level exactly as `execute` hands it.
        expect('data' in value).toBe(false);
        expect(value.success).toBe(true);
    });

    it('strips the envelope exactly ONCE — a payload that itself carries `success` is not unwrapped again', async () => {
        // `unwrapResponse` keys on `success` + `data` together (its #12038 §8.2
        // hazard is pinned in `unwrapper-misfire`-style suites for the REST
        // surface). A run result has `success` but no `data`, so after the
        // one strip nothing looks like a second envelope.
        const run = { success: false, status: 'failed', error: 'node create_opportunity failed', durationMs: 9 };
        const { client } = clientAnswering(enveloped(run));

        const value = await client.automation.trigger('flow_that_reports_its_own_flag', {});

        expect(value).toEqual(run);
        expect(value.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#13079 §2 — the failure path is unchanged: a non-2xx throws BEFORE any reader runs', () => {
    const failedRun = {
        success: false,
        error: {
            code: 'FLOW_FAILED',
            message: "Node 'create_opportunity' failed: amount must be positive",
            httpStatus: 400,
            details: { errorMessage: 'Check the amount and try again.' },
        },
    };

    it('automation.trigger: 400 FLOW_FAILED rejects with the ADR-0112 code and status', async () => {
        const { client } = clientAnswering(failedRun, 400);

        const err: any = await client.automation
            .trigger('my_flow', { amount: 0 })
            .then(() => { throw new Error('expected the failed trigger to reject'); }, (e) => e);

        // The classification, not merely that it threw (a bare `Error` would
        // satisfy `.rejects.toThrow()` while losing everything a caller
        // branches on).
        expect(err.code).toBe('FLOW_FAILED');
        expect(err.httpStatus).toBe(400);
        expect(err.message).toMatch(/Node 'create_opportunity' failed/);
        expect(err.details?.errorMessage).toBe('Check the amount and try again.');
    });

    it('automation.trigger: 409 FLOW_DISABLED rejects the same way — never dispatched, never FLOW_FAILED', async () => {
        const { client } = clientAnswering({
            success: false,
            error: { code: 'FLOW_DISABLED', message: "Flow 'welcome_flow' is disabled", httpStatus: 409 },
        }, 409);

        const err: any = await client.automation
            .trigger('welcome_flow', {})
            .then(() => { throw new Error('expected the disabled flow to reject'); }, (e) => e);

        expect(err.code).toBe('FLOW_DISABLED');
        expect(err.httpStatus).toBe(409);
        expect(err.code).not.toBe('FLOW_FAILED');
    });

    it('analytics.query: a refused query rejects with the envelope code and status', async () => {
        const { client } = clientAnswering({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: "Unknown measure 'revenue' on cube 'crm_account'", httpStatus: 400 },
        }, 400);

        const err: any = await client.analytics
            .query({ cube: 'crm_account', measures: ['revenue'] })
            .then(() => { throw new Error('expected the refused query to reject'); }, (e) => e);

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.httpStatus).toBe(400);
        expect(err.message).toMatch(/Unknown measure 'revenue'/);
    });

    it('a 2xx body with NO `data` key passes through `unwrapResponse` unchanged (documented pass-through)', async () => {
        // No dispatcher door behind these four routes sends a 2xx without
        // `data` (a failed run has been a thrown 400 since #9378). The
        // pass-through is `unwrapResponse`'s own contract on every method that
        // uses it, pinned here so the migration note can say so mechanically.
        const stray = { success: false, error: { code: 'FLOW_FAILED', message: 'a 200 nothing sends' } };
        const { client } = clientAnswering(stray, 200);

        const value: unknown = await client.automation.trigger('my_flow', {});

        expect(value).toEqual(stray);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('#13079 §3 — `analytics.queryDataset` is PROTECTED: served bare by @objectstack/rest, kept on res.json()', () => {
    it('resolves to the bare body the REST route answers, with nothing stripped and nothing added', async () => {
        // ⛔ Deliberately NOT `enveloped(...)`: the route ends `res.json(result)`.
        const { client } = clientAnswering(RESULT);

        const value = await client.analytics.queryDataset({
            datasetName: 'account_metrics',
            selection: { measures: ['account_count'], dimensions: ['industry'] },
        });

        expect(value).toEqual(RESULT);
        expect(value.rows).toEqual(RESULT.rows);
        expect('success' in value).toBe(false);
        expect('data' in value).toBe(false);
    });
});
