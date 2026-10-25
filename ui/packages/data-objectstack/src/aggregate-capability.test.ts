/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `aggregate()` against an analytics endpoint that cannot answer.
 *
 * WHY THIS EXISTS. `@objectstack/client@17.2.0`'s `analytics.query()` DOES call
 * `res.json()`, but only after `this.fetch(...)` — `ObjectStackClient.fetch` in
 * the installed client's `dist/index.mjs` — which throws on `!res.ok` before
 * `analytics.query` ever reaches its own `res.json()`. So today a non-2xx never
 * arrives as data; it arrives as a thrown, decorated `Error` (`code` flattened
 * from `errorBody?.code ?? errorBody?.error?.code`, plus `httpStatus`,
 * `message`, `details`), and every test below this header depends on that catch
 * firing. This paragraph used to describe the opposite: a client that returned
 * `res.json()` WITHOUT checking `res.ok`, so the error body arrived where rows
 * were expected, the adapter's row parser matched none of its shapes, produced
 * `[]`, and returned it as a RESULT — the `catch` that promises a client-side
 * fallback never ran, and a KPI on a deployment without
 * `@objectstack/service-analytics` rendered a confident **zero**. That defect is
 * why this file and `classifyAnalyticsFailure` exist; it is no longer what the
 * installed client does, so it is recorded here as history rather than as the
 * present-tense mechanism (objectui#5954).
 *
 * That is the same lie framework#3891 removed from the server side (a degraded
 * shim answering 200 with unscoped numbers), reproduced one layer up. These
 * tests pin every branch of `classifyAnalyticsFailure` onto exactly one of the
 * three outcomes a failed `aggregate()` can take:
 *
 *   | server said                    | outcome            |
 *   |--------------------------------|--------------------|
 *   | 501 `NOT_IMPLEMENTED`          | degrade LOUDLY     |
 *   | 404 `ROUTE_NOT_FOUND`          | degrade LOUDLY     |
 *   | 404/501, no `code` at all      | degrade LOUDLY     |
 *   | 400 `VALIDATION_FAILED`        | THROW              |
 *   | 400, any OTHER code (or none)  | THROW              |
 *   | 401 `UNAUTHENTICATED`          | THROW              |
 *   | 404 `CUBE_NOT_FOUND`           | THROW              |
 *   | 5xx, network, unknown code     | degrade SILENTLY   |
 *   | 2xx                            | rows, untouched    |
 *
 * The rows that matter most are the two 404s with DIFFERENT outcomes
 * (objectui#5721): they are the same transport status, so only the ADR-0112
 * `code` can tell them apart, and a status-first classifier fails them both.
 *
 * The "400, any OTHER code" row (objectui#7755) is the opposite lesson on the
 * SAME classifier: a `VALIDATION_FAILED`-only check let a coded 400 the
 * classifier does not enumerate — `service-analytics` ships its own 400
 * `INVALID_FILTER` on a filter shape it refuses — fall through every branch to
 * `unknown`, which `aggregate()`'s catch has no arm for, so it silently
 * answered the refusal with `aggregateViaFind`'s client-side numbers. Here the
 * transport status alone is decisive once it is 400, regardless of code.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const RECORDS = [
  { id: '1', stage: 'won', amount: 100 },
  { id: '2', stage: 'won', amount: 50 },
  { id: '3', stage: 'lost', amount: 20 },
];

/**
 * A fetch mock answering discovery, the analytics query (with `analyticsBody`
 * at `analyticsStatus`), and the `/data` read the fallback performs.
 */
function makeFetch(analyticsStatus: number, analyticsBody: unknown) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/analytics/query')) {
      return {
        ok: analyticsStatus >= 200 && analyticsStatus < 300,
        status: analyticsStatus,
        statusText: 'x',
        json: async () => analyticsBody,
      } as any;
    }
    // The fallback's scoped read.
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'opportunity', records: RECORDS, total: RECORDS.length } }),
    } as any;
  });
  return { fetchImpl, calls };
}

function makeAdapter(fetchImpl: any) {
  return new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000',
    autoReconnect: false,
    fetch: fetchImpl as any,
  });
}

const SUM_BY_STAGE = { function: 'sum', field: 'amount', groupBy: 'stage' };

describe('aggregate() when the analytics capability is absent', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('404 (routes not mounted, framework#4019) falls back instead of returning an empty result', async () => {
    const { fetchImpl, calls } = makeFetch(404, { error: 'Not found' });
    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

    // Pre-fix this was `[]` — a chart reading "no data" on a populated table.
    expect(rows.length).toBeGreaterThan(0);
    const won = rows.find((r: any) => r.stage === 'won');
    expect(won?.amount).toBe(150);
    // It really did fall back to a server-side read (not invent numbers).
    expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(true);
  });

  it('501 NOT_IMPLEMENTED (REST route, no service) falls back the same way', async () => {
    const { fetchImpl } = makeFetch(501, {
      code: 'NOT_IMPLEMENTED',
      message: 'Analytics is not available on this deployment.',
    });
    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);
    expect(rows.find((r: any) => r.stage === 'won')?.amount).toBe(150);
  });

  it('warns ONCE per adapter, not once per widget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetchImpl } = makeFetch(404, { error: 'Not found' });
      const adapter = makeAdapter(fetchImpl);
      await adapter.aggregate('opportunity', SUM_BY_STAGE);
      await adapter.aggregate('opportunity', SUM_BY_STAGE);
      await adapter.aggregate('opportunity', SUM_BY_STAGE);

      const capabilityWarnings = warn.mock.calls.filter((c) =>
        String(c[0]).includes('analytics capability unavailable'),
      );
      expect(capabilityWarnings).toHaveLength(1);
      expect(String(capabilityWarnings[0][0])).toContain('@objectstack/service-analytics');
    } finally {
      warn.mockRestore();
    }
  });

  it('forwards the widget filter into the fallback (never aggregates the whole table)', async () => {
    const { fetchImpl, calls } = makeFetch(404, { error: 'Not found' });
    await makeAdapter(fetchImpl).aggregate('opportunity', { ...SUM_BY_STAGE, filter: { stage: 'won' } });

    const dataCall = calls.find((c) => c.includes('/api/v1/data'));
    expect(dataCall).toBeDefined();
    expect(decodeURIComponent(dataCall!)).toContain('won');
  });
});

describe('aggregate() when the server REJECTS our query body', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // framework#4010 validates /analytics/query at the entry. A 400 means the
  // adapter sent an off-contract body — answering it with numbers from the
  // client-side path would bury our own bug behind plausible output, which is
  // exactly the misdirection framework#3878 documented.
  it('400 VALIDATION_FAILED throws — it must NOT be answered by the fallback', async () => {
    const { fetchImpl, calls } = makeFetch(400, {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        httpStatus: 400,
        message: 'Invalid AnalyticsQuery body: measures: Invalid input',
        details: { fields: [{ field: 'measures', code: 'invalid_type' }] },
      },
    });

    const err = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('ANALYTICS_QUERY_REJECTED');
    expect(String(err.message)).toContain('measures');
    // No silent second answer from a different code path.
    expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
  });

  /*
   * objectui#7755 — the pin for the coded-400 gap. `INVALID_FILTER` is the
   * real code `service-analytics` ships on a 400 for a filter shape it
   * refuses (spec/src/api/errors.zod.ts standard catalog), chosen deliberately
   * over a made-up code so this pin cannot pass by accident. Pre-fix,
   * `classifyAnalyticsFailure` only recognised `VALIDATION_FAILED` on a 400;
   * any OTHER code fell through every branch to `unknown`, which
   * `aggregate()`'s catch has no arm for, so it silently re-answered the
   * refusal through `aggregateViaFind` — a different door with a different
   * filter contract ($filter query-string parsing accepts array shapes the
   * analytics body does not) — producing a plausible number for a query the
   * server had just refused.
   */
  it('400 INVALID_FILTER (a coded 400 the classifier does not name) also throws — it must NOT be answered by the fallback', async () => {
    const { fetchImpl, calls } = makeFetch(400, {
      success: false,
      error: {
        code: 'INVALID_FILTER',
        httpStatus: 400,
        message: 'Invalid filter: unsupported operator "regex" for field "stage"',
      },
    });

    const err = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('ANALYTICS_QUERY_REJECTED');
    expect((err as { serverCode?: string }).serverCode).toBe('INVALID_FILTER');
    expect(String(err.message)).toContain('unsupported operator');
    // The point of this card: no silent second answer from a different door.
    expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
  });
});

describe('aggregate() on a healthy analytics endpoint', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('returns the server rows untouched (no false capability detection)', async () => {
    const { fetchImpl, calls } = makeFetch(200, {
      rows: [{ stage: 'won', amount_sum: 150 }],
      fields: [{ name: 'amount_sum', type: 'number' }],
    });

    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

    // Measure key mapped back to the caller's column (`amount`), rows from the server.
    expect(rows).toEqual([{ stage: 'won', amount: 150 }]);
    expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
  });

  it('a `{ success, data: { rows } }` envelope is still a result, not an error', async () => {
    const { fetchImpl } = makeFetch(200, { success: true, data: { rows: [{ stage: 'won', amount_sum: 150 }] } });
    const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);
    expect(rows).toEqual([{ stage: 'won', amount: 150 }]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#5721 — the code decides, the status is only the residual.
 *
 * WHAT WAS WRONG. `classifyAnalyticsFailure` tested `status === 404 || status
 * === 501` BEFORE the code operands that followed on the same line, so the
 * status short-circuited them: every 404 on this face was "the analytics
 * capability is not installed" whatever code it carried. An operator was told
 * to install a server plugin for a misspelled cube, and the chart was answered
 * from a different code path without saying so.
 *
 * ENVELOPE (measured, not assumed — objectui#5721 asks for exactly this).
 * `/analytics/query` does NOT answer in the flat family the dataset route
 * writes. It exits through `@objectstack/runtime`'s
 * `dispatcher-plugin.errorResponseBase` → `{ success: false, error: { code,
 * message, httpStatus } }`, while its 401 comes from `enforceAuth`'s FLAT
 * `ANONYMOUS_DENY_BODY` (`{ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED',
 * message }`). Both are used verbatim below because `@objectstack/client`'s
 * fetch wrapper flattens BOTH before it throws — `errorBody?.code ??
 * errorBody?.error?.code` onto `error.code`, plus `error.httpStatus =
 * res.status` — which is why the classifier reads one field and no envelope.
 * These tests run through the real client, so a client that stopped flattening
 * either family would turn them red rather than pass on a rewritten mock.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `errorResponseBase`'s wrapped envelope, verbatim in shape. */
function wrappedError(code: string, message: string, httpStatus: number) {
  return { success: false, error: { code, message, httpStatus } };
}

/** `@objectstack/core`'s `ANONYMOUS_DENY_BODY`, verbatim in shape. */
const ANONYMOUS_DENY_BODY = {
  error: 'UNAUTHENTICATED',
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required to access this endpoint.',
} as const;

const CUBE_NOT_FOUND_MESSAGE =
  "Cube 'opportunity_metrics' not found: no cube is registered under that name, and it is " +
  'not a registered object either (a cube can only be auto-inferred from a registered ' +
  'object). Define a Cube in your stack, or check the object name.';

describe('aggregate() — 404 `CUBE_NOT_FOUND` is an authoring mistake, not a missing capability', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  /*
   * OUTCOME: THROW. Not "degrade loudly", and the reason is measurable rather
   * than a preference: `assertInferableCube` (framework#3867) throws this only
   * when the name is neither a registered cube NOR a registered object, and
   * the fallback re-reads THE SAME NAME through `/data`, where objectql's
   * `assertObjectRegistered` (framework#3770) answers 404 `OBJECT_NOT_FOUND`.
   * So degrading cannot produce numbers — it can only replace a message that
   * names the fix with a distant one, behind a warning that instructs the
   * wrong repair.
   */
  it('throws with the server\'s own code and words, and never re-reads through find()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetchImpl, calls } = makeFetch(404, wrappedError('CUBE_NOT_FOUND', CUBE_NOT_FOUND_MESSAGE, 404));

      const err = await makeAdapter(fetchImpl).aggregate('opportunity_metrics', SUM_BY_STAGE).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      // The contract field survives the rethrow, so a caller can still branch
      // on it — that is why this one is rethrown rather than re-wrapped.
      expect((err as { code?: string }).code).toBe('CUBE_NOT_FOUND');
      expect((err as { httpStatus?: number }).httpStatus).toBe(404);
      // The producer's own repair instructions, not a restatement of them.
      expect(String(err.message)).toContain('Define a Cube in your stack');

      // No silent second answer from a different code path.
      expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
      // And no "install @objectstack/service-analytics" — analytics answered.
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('analytics capability unavailable')),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  /*
   * The control for the row above, and the pin that a status-first classifier
   * cannot satisfy: SAME 404, SAME wrapped envelope, different `code` — and
   * therefore a different outcome. OUTCOME: degrade LOUDLY, because this code
   * really does mean the routes were never mounted (framework#4019).
   */
  it('404 `ROUTE_NOT_FOUND` on the same status still degrades loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetchImpl, calls } = makeFetch(
        404,
        wrappedError('ROUTE_NOT_FOUND', 'No route matched POST /api/v1/analytics/query', 404),
      );

      const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

      expect(rows.find((r: any) => r.stage === 'won')?.amount).toBe(150);
      expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(true);
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('analytics capability unavailable')),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('aggregate() — 401 `UNAUTHENTICATED` is the session, not the deployment', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  /*
   * OUTCOME: THROW. Degrading here is futile as well as misleading — the
   * fallback's `find()` carries the SAME lapsed token and is refused the same
   * way — so the chart cannot be answered at all. Pre-fix this landed in
   * `unknown` and degraded SILENTLY: an expired session rendered a chart built
   * from a `find()` that was itself about to be refused.
   */
  it('throws AnalyticsUnauthenticatedError instead of degrading silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetchImpl, calls } = makeFetch(401, ANONYMOUS_DENY_BODY);

      const err = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: string }).code).toBe('ANALYTICS_UNAUTHENTICATED');
      expect(String(err.message)).toContain('not authenticated');
      // It must say the opposite of "capability missing" — an operator sent to
      // install a server plugin because a token lapsed is the same defect.
      expect(String(err.message)).toContain('says nothing about whether the analytics');
      expect((err as { serverCode?: string }).serverCode).toBe('UNAUTHENTICATED');

      expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('analytics capability unavailable')),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  /*
   * Branch ⑤, the 401 limb: a gateway that refused the call before any
   * ObjectStack route saw it declares no `code`, so the status is the best
   * signal available — and only because every code branch has already
   * declined. OUTCOME: THROW, same as the coded case.
   */
  it('a code-less 401 (a proxy, not a route) reaches the same branch by status', async () => {
    const { fetchImpl, calls } = makeFetch(401, { message: 'Unauthorized' });

    const err = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE).catch((e) => e);

    expect((err as { code?: string }).code).toBe('ANALYTICS_UNAUTHENTICATED');
    expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(false);
  });
});

describe('aggregate() — a coded failure that is none of the above still degrades SILENTLY', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  /*
   * OUTCOME: degrade SILENTLY. `ANALYTICS_QUERY_FAILED` is analytics answering
   * that its own execution broke — transient, and the numbers are still
   * obtainable the slow way. It must NOT become "capability missing" (a wrong
   * instruction to an operator) and must NOT throw (a chart lost to a blip).
   * This is also the guard on branch ①'s width: reading the `code` first must
   * not turn every named failure into a loud one.
   */
  it('500 `ANALYTICS_QUERY_FAILED` falls back with no capability warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetchImpl, calls } = makeFetch(
        500,
        wrappedError('ANALYTICS_QUERY_FAILED', 'Query execution failed', 500),
      );

      const rows = await makeAdapter(fetchImpl).aggregate('opportunity', SUM_BY_STAGE);

      expect(rows.find((r: any) => r.stage === 'won')?.amount).toBe(150);
      expect(calls.some((c) => c.includes('/api/v1/data'))).toBe(true);
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('analytics capability unavailable')),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
