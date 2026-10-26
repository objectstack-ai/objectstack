/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `composeDrillFilter` throws ONE refusal type — objectui#10789.
 *
 * The seam refuses at two steps. `mergeFilterNodes` throws a
 * `FilterOperatorError`; the spec's `parseFilterAST`, which judges comparand
 * shapes the converter passes through, threw a plain `Error` carrying
 * `code: 'INVALID_FILTER'` / `status: 400`. The drill callers catch the first
 * type only, so an array-dialect widget filter such as
 * `[['stage', 'in', 'won']]` (never judged by the converter) still threw the
 * chart into its error boundary on a click.
 *
 * - §1 — both spec-refused spellings come out as a `FilterOperatorError`,
 *   asserted on the ENVELOPE (`code`, `httpStatus`) and on the refusal's own
 *   sentence naming the operator.
 * - §2 — only `INVALID_FILTER` is re-raised; any other error from the spec
 *   passes through untouched (no broad catch).
 * - §3 — CONTROL: a well-formed pair still composes.
 */

import { describe, it, expect, vi } from 'vitest';
import { composeDrillFilter } from '../drill-down';
import { FilterOperatorError } from '../filter-converter';

function refusalOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('objectui#10789 — the spec’s refusal leaves the drill seam as a FilterOperatorError', () => {
  it.each([
    ['array dialect, scalar on a list operator', [['stage', 'in', 'won']]],
    ['object dialect, scalar on a list operator', { stage: { $in: 'won' } }],
  ])('%s', (_label, widgetFilter) => {
    const thrown = refusalOf(() => composeDrillFilter(widgetFilter, { region: 'emea' }));
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    const error = thrown as FilterOperatorError;
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.httpStatus).toBe(400);
    // The spec's own sentence, verbatim, naming the operator it refused.
    expect(error.message).toContain('$in');
  });
});

describe('objectui#10789 — only INVALID_FILTER is re-raised', () => {
  it('any other error from the spec passes through untouched', async () => {
    // A FRESH module graph with the spec's lowering replaced, undone in
    // `finally`: the `unit` project runs with `isolate: false`, so a
    // module-scope `vi.mock` would depend on whether an earlier file in the
    // worker had already loaded this seam — and would leak into later files.
    const defect = new TypeError('not a refusal');
    vi.resetModules();
    vi.doMock('@objectstack/spec/data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@objectstack/spec/data')>();
      return {
        ...actual,
        parseFilterAST: (() => {
          throw defect;
        }) as typeof actual.parseFilterAST,
      };
    });
    try {
      const fresh = await import('../drill-down');
      expect(refusalOf(() => fresh.composeDrillFilter({ region: 'emea' }, { stage: 'won' }))).toBe(defect);
    } finally {
      vi.doUnmock('@objectstack/spec/data');
      vi.resetModules();
    }
  });
});

describe('objectui#10789 — CONTROL', () => {
  it('a well-formed pair still composes to the object dialect', () => {
    expect(composeDrillFilter({ region: 'emea' }, { stage: 'won' })).toEqual({
      $and: [{ region: 'emea' }, { stage: 'won' }],
    });
  });
});
