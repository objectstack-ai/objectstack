// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The data API's host-configured read limits — the rule itself, door-free.
 * The door halves are `@objectstack/rest`'s `data-query-read-limits.test.ts`
 * (the list doors over a real `SqlDriver`) and `service-analytics`'
 * `query-read-limits.test.ts` (the analytics and dataset doors).
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { resolveThrownHttpError } from './thrown-http-error.js';
import {
  DATA_DEFAULT_PAGE_SIZE_ENV,
  DATA_MAX_PAGE_SIZE_ENV,
  DATA_QUERY_ROW_BUDGET_ENV,
  QUERY_PAGE_SIZE_EXCEEDED,
  QUERY_ROW_BUDGET_EXCEEDED,
  QueryReadLimitError,
  assertQueryReadRows,
  planQueryReadWindow,
  resolveQueryReadLimits,
  type QueryReadRequest,
} from './query-read-limits.js';

function recorder() {
  const lines: string[] = [];
  return { lines, logger: { warn: (m: string) => { lines.push(m); } } };
}

function refusalOf(run: () => unknown): QueryReadLimitError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(QueryReadLimitError);
    return e as QueryReadLimitError;
  }
  throw new Error('expected a refusal, got none');
}

const list = (over: Partial<QueryReadRequest> = {}): QueryReadRequest => ({ surface: 'list', object: 'crm_account', ...over });
const analytics = (over: Partial<QueryReadRequest> = {}): QueryReadRequest => ({ surface: 'analytics', object: 'crm_account', ...over });

describe('resolveQueryReadLimits — host configuration', () => {
  it('nothing set is no limit on any axis (today\'s behaviour)', () => {
    expect(resolveQueryReadLimits({})).toEqual({});
    expect(resolveQueryReadLimits({ [DATA_MAX_PAGE_SIZE_ENV]: '', [DATA_QUERY_ROW_BUDGET_ENV]: '  ' })).toEqual({});
  });

  it('reads all three variables', () => {
    expect(resolveQueryReadLimits({
      [DATA_DEFAULT_PAGE_SIZE_ENV]: '50',
      [DATA_MAX_PAGE_SIZE_ENV]: ' 200 ',
      [DATA_QUERY_ROW_BUDGET_ENV]: '10000',
    })).toEqual({ defaultPageSize: 50, maxPageSize: 200, rowBudget: 10000 });
  });

  it('a value that is not a positive integer fails loudly, naming the variable — never reads as unset', () => {
    for (const bad of ['0', '-5', '1.5', 'abc', '10k', '1e3']) {
      expect(() => resolveQueryReadLimits({ [DATA_QUERY_ROW_BUDGET_ENV]: bad }), bad)
        .toThrow(`${DATA_QUERY_ROW_BUDGET_ENV} must be a positive integer`);
    }
  });

  it('a default page size above the maximum is refused at configuration', () => {
    expect(() => resolveQueryReadLimits({ [DATA_DEFAULT_PAGE_SIZE_ENV]: '500', [DATA_MAX_PAGE_SIZE_ENV]: '200' }))
      .toThrow(`${DATA_DEFAULT_PAGE_SIZE_ENV} (500) is larger than ${DATA_MAX_PAGE_SIZE_ENV} (200)`);
  });
});

describe('planQueryReadWindow — no limits configured leaves every read untouched', () => {
  it('returns the caller\'s own limit, or none', () => {
    expect(planQueryReadWindow(list(), {})).toEqual({});
    expect(planQueryReadWindow(list({ limit: 1_000_000, offset: 5_000_000 }), {})).toEqual({ limit: 1_000_000 });
    expect(planQueryReadWindow(analytics(), {})).toEqual({});
    expect(planQueryReadWindow(analytics({ limit: 0 }), {})).toEqual({ limit: 0 });
  });
});

describe('planQueryReadWindow — the maximum page size refuses, never clamps', () => {
  const limits = { maxPageSize: 200 };

  it('a limit within the maximum runs as asked', () => {
    expect(planQueryReadWindow(list({ limit: 200 }), limits)).toEqual({ limit: 200 });
    expect(planQueryReadWindow(analytics({ limit: 10 }), limits)).toEqual({ limit: 10 });
  });

  it('a limit over it is a 400 QUERY_PAGE_SIZE_EXCEEDED naming the spelling and the maximum', () => {
    const { lines, logger } = recorder();
    const err = refusalOf(() => planQueryReadWindow(list({ limit: 201, limitParam: '$top' }), limits, logger));
    expect(err.status).toBe(400);
    expect(err.code).toBe(QUERY_PAGE_SIZE_EXCEEDED);
    expect(err.limit).toBe(200);
    expect(err.message).toContain("Query parameter '$top' asks for 201 rows");
    expect(err.message).toContain('maximum page size is 200');
    expect(lines).toEqual([
      '[data] read refused: code=QUERY_PAGE_SIZE_EXCEEDED surface=list object=crm_account rows=201 limit=200',
    ]);
  });

  it('a read naming no limit takes the maximum as its page when no default is set', () => {
    expect(planQueryReadWindow(list(), limits)).toEqual({ limit: 200 });
  });
});

describe('planQueryReadWindow — the default page size', () => {
  const limits = { defaultPageSize: 50, maxPageSize: 200 };

  it('a list read naming no limit gets the default page (its answer says hasMore)', () => {
    expect(planQueryReadWindow(list(), limits)).toEqual({ limit: 50 });
    expect(planQueryReadWindow(list({ offset: 100 }), limits)).toEqual({ limit: 50 });
  });

  it('an analytics read naming no limit runs one row past the default, as a probe', () => {
    const plan = planQueryReadWindow(analytics(), limits);
    expect(plan.limit).toBe(51);
    expect(plan.probe).toEqual({ maxRows: 50, code: QUERY_PAGE_SIZE_EXCEEDED, limit: 50, maxPageSize: 200 });
  });

  it('an analytics answer within the default is served; one past it is refused, never cut', () => {
    const request = analytics();
    const plan = planQueryReadWindow(request, limits);
    expect(() => assertQueryReadRows(request, plan, 50)).not.toThrow();
    const { lines, logger } = recorder();
    const err = refusalOf(() => assertQueryReadRows(request, plan, 51, logger));
    expect(err.code).toBe(QUERY_PAGE_SIZE_EXCEEDED);
    expect(err.limit).toBe(50);
    expect(err.message).toContain('answers more than 50 rows');
    expect(err.message).toContain('Name a limit of at most 200 and page with offset');
    expect(lines).toHaveLength(1);
  });

  it('a plan without a probe never refuses an answer', () => {
    const request = list();
    expect(() => assertQueryReadRows(request, planQueryReadWindow(request, limits), 1_000)).not.toThrow();
  });
});

describe('planQueryReadWindow — the row budget counts offset plus the rows returned', () => {
  const limits = { defaultPageSize: 50, maxPageSize: 200, rowBudget: 1_000 };

  it('a window within the budget runs', () => {
    expect(planQueryReadWindow(list({ limit: 200, offset: 800 }), limits)).toEqual({ limit: 200 });
  });

  it('a window past it is a 400 QUERY_ROW_BUDGET_EXCEEDED naming the budget, before any read', () => {
    const { lines, logger } = recorder();
    const err = refusalOf(() => planQueryReadWindow(list({ limit: 200, offset: 801 }), limits, logger));
    expect(err.status).toBe(400);
    expect(err.code).toBe(QUERY_ROW_BUDGET_EXCEEDED);
    expect(err.limit).toBe(1_000);
    expect(err.message).toContain('would read 1001 rows');
    expect(err.message).toContain('query row budget of 1000');
    expect(lines).toEqual([
      '[data] read refused: code=QUERY_ROW_BUDGET_EXCEEDED surface=list object=crm_account rows=1001 limit=1000',
    ]);
  });

  it('the default page counts against the budget too', () => {
    const err = refusalOf(() => planQueryReadWindow(list({ offset: 960 }), limits));
    expect(err.code).toBe(QUERY_ROW_BUDGET_EXCEEDED);
  });

  it('with no page size at all, an unpaged read probes one row past what the budget leaves', () => {
    const budgetOnly = { rowBudget: 100 };
    const request = list({ offset: 40 });
    const plan = planQueryReadWindow(request, budgetOnly);
    expect(plan).toEqual({ limit: 61, probe: { maxRows: 60, code: QUERY_ROW_BUDGET_EXCEEDED, limit: 100 } });
    expect(() => assertQueryReadRows(request, plan, 60)).not.toThrow();
    const err = refusalOf(() => assertQueryReadRows(request, plan, 61));
    expect(err.code).toBe(QUERY_ROW_BUDGET_EXCEEDED);
    expect(err.limit).toBe(100);
    expect(refusalOf(() => planQueryReadWindow(list({ offset: 101 }), budgetOnly)).code).toBe(QUERY_ROW_BUDGET_EXCEEDED);
  });
});

describe('the refusal on the wire', () => {
  it('both codes are registered, so a door answers them verbatim at 400', () => {
    for (const code of [QUERY_PAGE_SIZE_EXCEEDED, QUERY_ROW_BUDGET_EXCEEDED]) {
      expect(ErrorCode.safeParse(code).success, code).toBe(true);
      const answer = resolveThrownHttpError(new QueryReadLimitError(code as never, 'over', 10));
      expect(answer.status).toBe(400);
      expect(answer.code).toBe(code);
      expect(answer.declaredCode).toBe(code);
    }
  });

  it('the log line names object, counts and limit — never a row value', () => {
    const { lines, logger } = recorder();
    refusalOf(() => planQueryReadWindow(list({ object: 'crm_contact', limit: 5 }), { maxPageSize: 2 }, logger));
    expect(lines[0]).toMatch(/^\[data\] read refused: code=\w+ surface=list object=crm_contact rows=5 limit=2$/);
  });
});
