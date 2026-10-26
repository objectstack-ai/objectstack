/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9048: the RULE-ENTRY filter form refuses an empty or non-string
 * `icontains` comparand, reading the spec's own predicate.
 *
 * ## The split this closes
 *
 * `@objectstack/spec`'s `FILTER_TEXT_CASES` declares two shapes REFUSED for the
 * case-insensitive contains operator: an empty comparand and a non-string one,
 * each `INVALID_FILTER`, each with `mustMention: ['$icontains']`. This adapter
 * already refused both when the filter arrived as an OBJECT, because that
 * branch delegates to `convertFiltersToAST` (objectui#9001). The ARRAY branch,
 * where a filter arrives as `[{ field, operator, value }, ...]`, lowered the
 * same condition to `['name', 'icontains', '']` and sent it. The same wire node
 * was refused or sent depending on how the filter was spelled.
 *
 * ## Why every refusal below is checked against the wire
 *
 * The defect was a request that went OUT, so each refusal also asserts that no
 * `/data/` request was made. A throw raised after the request would be a
 * refusal that let the query through. The accepted comparand `'acme'` is the
 * control: it must still reach the wire unchanged, in both forms and on both
 * routes, or a test that expected a throw could pass on a translator that
 * throws on everything.
 *
 * ## What is derived rather than written down
 *
 * The refused inputs come from the spec's own rejection rows, and the operator
 * spellings from this package's `FILTER_OPERATOR_ALIASES`. The reason text is
 * checked against `textComparandRefusalReason` rather than restated, because
 * `mustMention` makes those bytes the contract and a copy here would drift.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FILTER_TEXT_CASES,
  isRefusedTextComparand,
  textComparandRefusalReason,
} from '@objectstack/spec/data';
import { ValueDataSource } from '@object-ui/core';
import {
  ObjectStackAdapter,
  FILTER_OPERATOR_ALIASES,
  MalformedFilterError,
  clearSharedDiscoveryCache,
  isMalformedFilterError,
} from './index';

type Route = 'plain' | 'expand';
const ROUTES: readonly Route[] = ['plain', 'expand'];

type FindParams = Parameters<ObjectStackAdapter['find']>[1];
type AggregateParams = Parameters<ObjectStackAdapter['aggregate']>[1];

/** A 200 whose JSON body is `body`, in the shape the client reads. */
function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

function makeAdapter() {
  const urls: string[] = [];
  const analyticsBodies: unknown[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return ok({ success: true, data: { version: 'v1', routes: {} } });
    }
    if (u.includes('/api/v1/analytics/query')) {
      analyticsBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return ok({ rows: [] });
    }
    return ok({ success: true, data: { object: 'account', records: [], total: 0 } });
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { adapter, urls, analyticsBodies };
}

/** What `find()` did with this filter: the `filter=` it sent, or the error it raised. */
async function runFind($filter: unknown, route: Route) {
  const { adapter, urls } = makeAdapter();
  let error: unknown = null;
  try {
    await adapter.find('account', {
      $filter,
      ...(route === 'expand' ? { $expand: ['owner'] } : {}),
    } as FindParams);
  } catch (e) {
    error = e;
  }
  const dataCalls = urls.filter((u) => u.includes('/data/account'));
  const raw = dataCalls.length > 0 ? new URL(dataCalls[dataCalls.length - 1]).searchParams.get('filter') : null;
  return { error, dataCalls: dataCalls.length, wire: raw === null ? undefined : JSON.parse(raw) };
}

/** The refusal this card adds, asserted as an envelope rather than as "it threw". */
async function expectEntryRefusal(
  $filter: unknown,
  route: Route,
  expected: { field: string; arrived: string; comparand: unknown; index: number },
) {
  const { error, dataCalls } = await runFind($filter, route);
  expect(error).toBeInstanceOf(MalformedFilterError);
  const err = error as MalformedFilterError;
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.httpStatus).toBe(400);
  expect(isMalformedFilterError(err)).toBe(true);
  // An ordinary MalformedFilterError, not a look-alike: the name callers match
  // on, and a stack header carrying the refusal rather than the shape advice
  // the constructor wrote before the sentence replaced it.
  expect(err.name).toBe('MalformedFilterError');
  expect(String(err.stack)).toContain(`Filter entry ${expected.index} is refused.`);
  expect(String(err.stack)).not.toContain('is not a usable filter rule');
  expect(err.index).toBe(expected.index);
  expect(err.message).toContain(`Filter entry ${expected.index} is refused.`);
  // The contract's reason, seated verbatim and naming the spelling that arrived.
  expect(err.message).toContain(
    textComparandRefusalReason(expected.field, expected.arrived, expected.comparand),
  );
  // Refused before anything was sent.
  expect(dataCalls).toBe(0);
  return err;
}

/** The spec's rejection rows for this operator's comparand, as `{ field, comparand, row }`. */
const TEXT_COMPARAND_ROWS = FILTER_TEXT_CASES.flatMap((row) => {
  if (!('expectRejection' in row) || !row.expectRejection) return [];
  const entries = Object.entries(row.filter as Record<string, unknown>);
  if (entries.length !== 1) return [];
  const [field, condition] = entries[0];
  if (!condition || typeof condition !== 'object') return [];
  const keys = Object.keys(condition);
  if (keys.length !== 1 || keys[0] !== '$icontains') return [];
  return [{ field, comparand: (condition as Record<string, unknown>).$icontains, row }];
});

describe('objectui#9048: the rule-entry form refuses what FILTER_TEXT_CASES refuses', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('the spec still publishes the two rows this card is about', () => {
    // Guards the derivation below: an empty selection would make every
    // row-driven case vacuous rather than red.
    expect(TEXT_COMPARAND_ROWS.map((r) => r.comparand)).toEqual(expect.arrayContaining(['', 42]));
  });

  for (const route of ROUTES) {
    for (const { field, comparand, row } of TEXT_COMPARAND_ROWS) {
      it(`"${row.name}" — the entry form is refused with the row's code and mentions (${route})`, async () => {
        const err = await expectEntryRefusal(
          [{ field, operator: 'icontains', value: comparand }],
          route,
          { field, arrived: 'icontains', comparand, index: 0 },
        );
        expect(err.code).toBe(row.code);
        for (const mention of row.mustMention) expect(err.message).toContain(mention);
      });
    }

    it(`an empty comparand is refused (${route})`, async () => {
      await expectEntryRefusal(
        [{ field: 'name', operator: 'icontains', value: '' }],
        route,
        { field: 'name', arrived: 'icontains', comparand: '', index: 0 },
      );
    });

    it(`a number comparand is refused (${route})`, async () => {
      await expectEntryRefusal(
        [{ field: 'name', operator: 'icontains', value: 42 }],
        route,
        { field: 'name', arrived: 'icontains', comparand: 42, index: 0 },
      );
    });

    it(`CONTROL: a non-empty string comparand is sent unchanged (${route})`, async () => {
      const { error, wire } = await runFind([{ field: 'name', operator: 'icontains', value: 'acme' }], route);
      expect(error).toBeNull();
      expect(wire).toEqual(['name', 'icontains', 'acme']);
    });
  }
});

describe('objectui#9048: every spelling that folds to `icontains` meets the same door', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // Read off the alias table, so a new row that folds here is covered by
  // adding it; plus two case variants, because the fold lower-cases first.
  const FOLDING_ROWS = Object.entries(FILTER_OPERATOR_ALIASES)
    .filter(([, symbol]) => symbol === 'icontains')
    .map(([spelling]) => spelling);
  const SPELLINGS = [...FOLDING_ROWS, 'ICONTAINS', 'iContains'];

  it('the alias table has at least one row that folds to `icontains`', () => {
    expect(FOLDING_ROWS).toContain('icontains');
  });

  for (const route of ROUTES) {
    for (const spelling of SPELLINGS) {
      it(`\`operator: '${spelling}'\` is refused, naming the spelling that arrived (${route})`, async () => {
        const err = await expectEntryRefusal(
          [{ field: 'name', operator: spelling, value: '' }],
          route,
          { field: 'name', arrived: spelling, comparand: '', index: 0 },
        );
        // The rows spell the operator in the `$` dialect; the tail names that twin.
        expect(err.message).toContain("'$icontains'");
      });

      it(`CONTROL: \`operator: '${spelling}'\` with a non-empty string is sent (${route})`, async () => {
        const { error, wire } = await runFind([{ field: 'name', operator: spelling, value: 'acme' }], route);
        expect(error).toBeNull();
        expect(wire).toEqual(['name', 'icontains', 'acme']);
      });
    }

    it(`the \`op\` shorthand key is judged the same way (${route})`, async () => {
      await expectEntryRefusal(
        [{ field: 'name', op: 'icontains', value: '' }],
        route,
        { field: 'name', arrived: 'icontains', comparand: '', index: 0 },
      );
    });

    it(`SCOPE: the case-sensitive \`contains\` has no such row and still sends '' (${route})`, async () => {
      // The table declares the refusal for the case-insensitive operator only.
      // Widening it to the siblings by analogy is the table's call, so the
      // boundary is pinned rather than left to look like an oversight.
      const { error, wire } = await runFind([{ field: 'name', operator: 'contains', value: '' }], route);
      expect(error).toBeNull();
      expect(wire).toEqual(['name', 'contains', '']);
    });
  }
});

describe('objectui#9048: both dialects now refuse the same node', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  for (const route of ROUTES) {
    for (const comparand of ['', 42] as const) {
      it(`${JSON.stringify(comparand)}: the object form and the entry form are both refused (${route})`, async () => {
        const object = await runFind({ name: { $icontains: comparand } }, route);
        const entry = await runFind([{ field: 'name', operator: 'icontains', value: comparand }], route);
        for (const { error, dataCalls } of [object, entry]) {
          expect(isMalformedFilterError(error)).toBe(true);
          const envelope = error as { code?: unknown; httpStatus?: unknown };
          expect(envelope.code).toBe('INVALID_FILTER');
          expect(envelope.httpStatus).toBe(400);
          expect(String((error as Error).message)).toContain("'$icontains'");
          expect(dataCalls).toBe(0);
        }
        // One reason, each naming the spelling its own dialect arrived in.
        expect((object.error as Error).message).toContain(
          textComparandRefusalReason('name', '$icontains', comparand),
        );
        expect((entry.error as Error).message).toContain(
          textComparandRefusalReason('name', 'icontains', comparand),
        );
      });
    }

    it(`CONTROL: 'acme' puts the identical node on the wire in both forms (${route})`, async () => {
      const object = await runFind({ name: { $icontains: 'acme' } }, route);
      const entry = await runFind([{ field: 'name', operator: 'icontains', value: 'acme' }], route);
      expect(object.error).toBeNull();
      expect(entry.error).toBeNull();
      expect(entry.wire).toEqual(['name', 'icontains', 'acme']);
      expect(object.wire).toEqual(entry.wire);
    });
  }
});

describe('objectui#9048: the adapter refuses exactly what ValueDataSource refuses', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  /**
   * `ValueDataSource` reads the same rule-entry form and refuses by excluding
   * rows and logging; this adapter has no rows and refuses by throwing. The
   * delivery differs by design. What must not differ is WHICH comparands are
   * refused, so both faces are driven with the identical filter.
   */
  async function valueDataSourceRefuses($filter: unknown): Promise<boolean> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ds = new ValueDataSource({ items: [{ id: 1, name: 'Acme' }] });
      const result = await ds.find('rows', { $filter } as Parameters<ValueDataSource['find']>[1]);
      const refused = warn.mock.calls.length > 0;
      // A refusal excludes every row; an accepted comparand matches the row.
      expect(result.data.map((r) => r.id)).toEqual(refused ? [] : [1]);
      return refused;
    } finally {
      warn.mockRestore();
    }
  }

  const COMPARANDS: Array<[string, Record<string, unknown>]> = [
    ["''", { value: '' }],
    ['42', { value: 42 }],
    ['null', { value: null }],
    ['undefined', { value: undefined }],
    ['no value key', {}],
    ['true', { value: true }],
    ["['a']", { value: ['a'] }],
    ['{}', { value: {} }],
    ["'acme' (CONTROL)", { value: 'acme' }],
  ];

  for (const [label, valuePart] of COMPARANDS) {
    it(`${label}: both faces give the same verdict, and it is the spec's`, async () => {
      const filter = [{ field: 'name', operator: 'icontains', ...valuePart }];
      const adapterRefuses = isMalformedFilterError((await runFind(filter, 'plain')).error);
      expect(adapterRefuses).toBe(await valueDataSourceRefuses(filter));
      expect(adapterRefuses).toBe(isRefusedTextComparand(valuePart.value));
    });
  }

  it('an absent value is refused with the non-string reason, not sent as JSON null', async () => {
    // This translator always emits a 3-tuple, so an absent value used to reach
    // the wire as `["name","icontains",null]`.
    await expectEntryRefusal(
      [{ field: 'name', operator: 'icontains' }],
      'plain',
      { field: 'name', arrived: 'icontains', comparand: undefined, index: 0 },
    );
  });
});

describe('objectui#9048: the door is on the translator, so every place it runs is covered', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  for (const route of ROUTES) {
    it(`a later entry is named by its own index (${route})`, async () => {
      await expectEntryRefusal(
        [
          { field: 'stage', operator: 'eq', value: 'won' },
          { field: 'name', operator: 'icontains', value: '' },
        ],
        route,
        { field: 'name', arrived: 'icontains', comparand: '', index: 1 },
      );
    });

    it(`a rule group nested under \`and\` is refused (${route})`, async () => {
      await expectEntryRefusal(
        ['and', [{ field: 'name', operator: 'icontains', value: 42 }], ['x', '=', 1]],
        route,
        { field: 'name', arrived: 'icontains', comparand: 42, index: 0 },
      );
    });

    it(`a bare rule spread under \`and\` is refused, named by its position (${route})`, async () => {
      await expectEntryRefusal(
        ['and', ['x', '=', 1], { field: 'name', operator: 'icontains', value: '' }],
        route,
        { field: 'name', arrived: 'icontains', comparand: '', index: 2 },
      );
    });
  }

  it('aggregate() refuses it too, and posts nothing', async () => {
    const { adapter, urls, analyticsBodies } = makeAdapter();
    const error = await adapter
      .aggregate('account', {
        function: 'count',
        field: 'id',
        groupBy: '_all',
        filter: [{ field: 'name', operator: 'icontains', value: '' }],
      } as AggregateParams)
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(MalformedFilterError);
    expect((error as Error).message).toContain(textComparandRefusalReason('name', 'icontains', ''));
    expect(analyticsBodies).toHaveLength(0);
    expect(urls.some((u) => u.includes('/analytics/query') || u.includes('/data/account'))).toBe(false);
  });

  it('a BigInt comparand gets the contract reason, not a serialisation TypeError', async () => {
    // Driven through aggregate(), which reaches the translator with a BigInt
    // intact. The refusal is built by constructing a MalformedFilterError over
    // the entry, and a bare `JSON.stringify` in that constructor throws on a
    // BigInt, so the TypeError would reach the caller in the refusal's place.
    // (`find()` never gets this far with a BigInt: its request-coalescing key
    // stringifies the params first.)
    const { adapter, analyticsBodies } = makeAdapter();
    const error = await adapter
      .aggregate('account', {
        function: 'count',
        field: 'id',
        groupBy: '_all',
        filter: [{ field: 'name', operator: 'icontains', value: BigInt(10) }],
      } as AggregateParams)
      .then(() => null, (e) => e);
    expect(error).toBeInstanceOf(MalformedFilterError);
    expect((error as Error).message).toContain(
      textComparandRefusalReason('name', 'icontains', BigInt(10)),
    );
    expect(analyticsBodies).toHaveLength(0);
  });
});

describe('objectui#9048: the published class is unchanged', () => {
  it('the public constructor still takes two arguments', () => {
    // The refusal sentence is seated module-privately. A third constructor
    // parameter would widen a published signature no consumer asked for.
    expect(MalformedFilterError.length).toBe(2);
  });

  it('the shape refusal is built without throwing for an entry carrying a BigInt', () => {
    const entry = { field: '', operator: 'eq', value: BigInt(3) };
    let built: unknown;
    expect(() => {
      built = new MalformedFilterError(entry, 0);
    }).not.toThrow();
    expect(built).toBeInstanceOf(MalformedFilterError);
    expect((built as MalformedFilterError).code).toBe('INVALID_FILTER');
    expect((built as MalformedFilterError).entry).toBe(entry);
  });
});
