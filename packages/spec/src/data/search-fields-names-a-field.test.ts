// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27683] The published search-field override declarations —
 * `QueryTransportParamsSchema.$searchFields`, `QuerySchema.searchFields` and
 * `FullTextSearchSchema.fields` — refuse a value naming no field, the set the
 * protocol door refuses with a 400 since #27484: a blank string, only commas
 * and spaces, an empty list, and an empty structured `search.fields`. They used
 * to admit all of it, so the published JSON Schema admitted what the door
 * refuses. The door-level parity pin (the same probe values against both
 * doors) is rest's `data-empty-search-fields-door.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { QuerySchema, FullTextSearchSchema } from './query.zod';
import {
  EngineAggregateOptionsSchema,
  EngineCountOptionsSchema,
  EngineQueryOptionsSchema,
  QueryTransportParamsSchema,
  QueryWithTransportSchema,
} from './data-engine.zod';
import { FindDataRequestSchema } from '../api/protocol.zod';
import { SEARCH_FIELDS_ACCEPT_SET, SEARCH_FIELDS_NAMES_NO_FIELD } from './search-fields-names-a-field';

type Schema = { safeParse(v: unknown): { success: boolean; data?: any; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } } };

/** The first issue a schema raises for `input`, or a failed expectation when it parses. */
function firstIssue(schema: Schema, input: unknown) {
  const parsed = schema.safeParse(input);
  expect(parsed.success, `refuses ${JSON.stringify(input)}`).toBe(false);
  return parsed.error!.issues[0]!;
}

/** Every spelling of "names no field" the door refuses, string arm first. */
const REFUSED_STRINGS: ReadonlyArray<readonly [string, string]> = [
  ['a blank string', ''],
  ['whitespace only', '   '],
  ['a comma', ','],
  ['commas and spaces only', ' , '],
];
const REFUSED_LIST: readonly [string, string[]] = ['an empty list', []];

const KEPT_STRINGS: ReadonlyArray<readonly [string, string]> = [
  ['one name', 'name'],
  ['a spaced comma list', ' name , email '],
];
const KEPT_LISTS: ReadonlyArray<readonly [string, string[]]> = [
  ['one name', ['name']],
  ['two names', ['name', 'email']],
  // Not "naming no field" to the door either: it is a name the door looks up,
  // and refuses as an unknown field when the object is known.
  ['a blank member', ['']],
];

describe('QueryTransportParamsSchema.$searchFields', () => {
  it.each([...REFUSED_STRINGS, REFUSED_LIST])('refuses %s with the accept-set sentence', (_name, value) => {
    const issue = firstIssue(QueryTransportParamsSchema, { $searchFields: value });
    expect(issue.path).toEqual(['$searchFields']);
    expect(issue.message).toBe(SEARCH_FIELDS_NAMES_NO_FIELD);
  });

  it.each([...KEPT_STRINGS, ...KEPT_LISTS])('keeps %s unchanged', (_name, value) => {
    const parsed = QueryTransportParamsSchema.safeParse({ $searchFields: value });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.$searchFields).toEqual(value);
  });

  it('still reads an explicit null as a withdrawal', () =>
    expect(QueryWithTransportSchema.parse({ object: 'a', $searchFields: null })).toEqual({ object: 'a' }));

  it('lowers a kept comma list onto `searchFields` as the door does', () =>
    expect(QueryWithTransportSchema.parse({ object: 'a', $searchFields: ' name , email ' }))
      .toEqual({ object: 'a', searchFields: ['name', 'email'] }));
});

describe('QuerySchema.searchFields', () => {
  it('refuses an empty list with the accept-set sentence', () => {
    const issue = firstIssue(QuerySchema, { object: 'a', searchFields: [] });
    expect(issue.path).toEqual(['searchFields']);
    expect(issue.message).toBe(SEARCH_FIELDS_NAMES_NO_FIELD);
  });

  it.each(KEPT_LISTS)('keeps %s unchanged', (_name, value) => {
    const parsed = QuerySchema.safeParse({ object: 'a', searchFields: value });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.searchFields).toEqual(value);
  });
});

describe('FullTextSearchSchema.fields', () => {
  it('refuses an empty list with the accept-set sentence', () => {
    const issue = firstIssue(FullTextSearchSchema, { query: 'x', fields: [] });
    expect(issue.path).toEqual(['fields']);
    expect(issue.message).toBe(SEARCH_FIELDS_NAMES_NO_FIELD);
  });

  it.each(KEPT_LISTS)('keeps %s unchanged', (_name, value) => {
    const parsed = FullTextSearchSchema.safeParse({ query: 'x', fields: value });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fields).toEqual(value);
  });

  it('keeps a structured search with no `fields` at all', () =>
    expect(FullTextSearchSchema.safeParse({ query: 'x' }).success).toBe(true));
});

describe('the transport-aware query slot and the POST /data/:object/query body', () => {
  /** Each body-side spelling of the override, as a query bag carrying `value`. */
  const SPELLINGS: ReadonlyArray<readonly [string, (value: unknown) => Record<string, unknown>, boolean]> = [
    ['$searchFields', (value) => ({ $searchFields: value }), true],
    ['searchFields', (value) => ({ searchFields: value }), false],
    ['search.fields', (value) => ({ search: { query: 'x', fields: value } }), false],
    ['$search.fields', (value) => ({ $search: { query: 'x', fields: value } }), false],
  ];

  for (const [spelling, bag, takesStrings] of SPELLINGS) {
    const refused = takesStrings ? [...REFUSED_STRINGS, REFUSED_LIST] : [REFUSED_LIST];
    it.each(refused)(`refuses \`${spelling}\` as %s, in both slots`, (_name, value) => {
      expect(QueryWithTransportSchema.safeParse({ object: 'a', ...bag(value) }).success).toBe(false);
      expect(FindDataRequestSchema.safeParse({ object: 'a', query: { object: 'a', ...bag(value) } }).success).toBe(false);
    });

    it(`keeps \`${spelling}\` naming a field`, () => {
      expect(QueryWithTransportSchema.safeParse({ object: 'a', ...bag(['name']) }).success).toBe(true);
      expect(FindDataRequestSchema.safeParse({ object: 'a', query: { object: 'a', ...bag(['name']) } }).success).toBe(true);
    });
  }
});

describe('the declarations state the accept set they enforce', () => {
  const members: ReadonlyArray<readonly [string, { description?: string } | undefined]> = [
    ['QueryTransportParamsSchema.$searchFields', QueryTransportParamsSchema.shape.$searchFields],
    ['QuerySchema.searchFields', (QuerySchema as unknown as { shape: Record<string, { description?: string }> }).shape.searchFields],
    ['FullTextSearchSchema.fields', FullTextSearchSchema.shape.fields],
  ];
  it.each(members)('%s carries the shared sentence', (_name, member) =>
    expect(member?.description).toContain(SEARCH_FIELDS_ACCEPT_SET));
});

describe('stage boundary: the engine-side searchFields declarations are the next stage', () => {
  // The in-process engine still reads an empty override as absent, and its own
  // declarations still say so; the engine stage moves them together.
  it.each([
    ['EngineQueryOptionsSchema', EngineQueryOptionsSchema],
    ['EngineAggregateOptionsSchema', EngineAggregateOptionsSchema],
    ['EngineCountOptionsSchema', EngineCountOptionsSchema],
  ] as const)('%s.searchFields still admits an empty list', (_name, schema) =>
    expect((schema as Schema).safeParse({ searchFields: [] }).success).toBe(true));
});
