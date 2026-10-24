// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25561] `POST /analytics/dataset/query` — a read gate that could not reach a
 * verdict answers `503 SERVICE_UNAVAILABLE`, and a real denial still answers
 * `403 PERMISSION_DENIED`.
 *
 * Three of the analytics door's refusals are operator-side FAULTS: the
 * object-level admission provider threw, the field-level read permissions could
 * not be resolved, or the API exposure declaration could not be read. Each
 * answered the wire body of a real denial, `403 PERMISSION_DENIED`, so a caller
 * could not tell "you may not read this" from "the server could not decide".
 * The producer now declares the fault — `SERVICE_UNAVAILABLE` / 503, the
 * spelling `@objectstack/core`'s `authz-store-unavailable.ts` chose for the same
 * class — and this route relays a declared 5xx's status and code (the #11718
 * declared-fault arm), never collapsing it onto `500 ANALYTICS_QUERY_FAILED`.
 *
 * ## Why this file boots the REAL analytics service
 *
 * The relay is pinned for a hand-built declared 503
 * (`analytics-filter-refusal-envelope.test.ts`), and the producer is pinned per
 * site in `service-analytics`. Either can be green while the caller still sees
 * the wrong answer, so this file asserts the SEAM: the error crossing into the
 * route's catch is the one the real `AnalyticsService` throws.
 *
 * Every fault row sits beside its verdict twin on the same route — the same
 * gate answering "no" — so a fault row cannot pass because the route never
 * reached the gate, and a fix that moved the denial along with the fault goes
 * red on the twin.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { AnalyticsService, type AnalyticsServiceConfig } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
  };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

/** Build a RestServer over an analytics provider (positional arg #15). */
function buildRoute(analyticsProvider: unknown) {
  const rest = new RestServer(
    mockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    analyticsProvider as any,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  return rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'))!;
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

type Gates = Pick<AnalyticsServiceConfig, 'admitObjectRead' | 'getReadableFields' | 'getObjectDeclaration'>;

/** A real `AnalyticsService` on the ObjectQL aggregate path, with the gates under test. */
function analytics(gates: Gates, executed: string[]): AnalyticsService {
  return new AnalyticsService({
    logger: silent,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (object: string) => {
      executed.push(object);
      return [{ stage: 'won', revenue: 100 }];
    },
    isRegisteredObject: () => true,
    ...gates,
  });
}

const OBJECT = 'crm_opportunity';
const body = {
  dataset: {
    name: 'pipeline',
    label: 'Pipeline',
    object: OBJECT,
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
  },
  selection: { dimensions: ['stage'], measures: ['revenue'] },
};

async function post(gates: Gates) {
  const executed: string[] = [];
  const route = buildRoute(analytics(gates, executed));
  const res = mockRes();
  const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  } finally {
    logSpy.mockRestore();
  }
  return { status: res.statusCode as number, body: res.body, executed };
}

const exploded = () => {
  throw new Error('permission resolver exploded');
};

const ROWS: Array<{ gate: string; fault: Gates; verdict: Gates; verdictCode: string; verdictStatus: number }> = [
  {
    gate: 'the object-level read admission',
    fault: { admitObjectRead: exploded },
    verdict: { admitObjectRead: () => false },
    verdictCode: 'PERMISSION_DENIED',
    verdictStatus: 403,
  },
  {
    gate: 'the field-level read permissions',
    fault: { getReadableFields: exploded },
    verdict: { getReadableFields: () => ['stage'] },
    verdictCode: 'PERMISSION_DENIED',
    verdictStatus: 403,
  },
  {
    gate: 'the API exposure declaration',
    fault: { getObjectDeclaration: exploded },
    verdict: { getObjectDeclaration: () => ({ enable: { apiEnabled: false } }) },
    verdictCode: 'OBJECT_API_DISABLED',
    verdictStatus: 404,
  },
];

describe('[#25561] a read gate that could not decide answers 503 SERVICE_UNAVAILABLE on the dataset door', () => {
  it('the control: with every gate admitting, the route serves the query', async () => {
    const res = await post({
      admitObjectRead: () => true,
      getReadableFields: () => ['stage', 'amount'],
      getObjectDeclaration: () => ({}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.executed).toEqual([OBJECT]);
  });

  describe.each(ROWS)('$gate', ({ fault, verdict, verdictCode, verdictStatus }) => {
    it('a resolver that THROWS answers 503 SERVICE_UNAVAILABLE — not the denial, not ANALYTICS_QUERY_FAILED — and nothing runs', async () => {
      const res = await post(fault);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.code).not.toBe('PERMISSION_DENIED');
      expect(res.body.code).not.toBe('ANALYTICS_QUERY_FAILED');
      // A declared server fault's prose is the operator's: withheld here, kept
      // in the server log. Neither the cause nor a layer reaches the caller.
      expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
      expect(JSON.stringify(res.body)).not.toContain('exploded');
      expect(res.executed).toEqual([]);
    });

    it(`its verdict twin — the same gate answering "no" — still answers ${verdictStatus} ${verdictCode}`, async () => {
      const res = await post(verdict);
      expect(res.status).toBe(verdictStatus);
      expect(res.body.code).toBe(verdictCode);
      expect(res.executed).toEqual([]);
    });
  });
});
