// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27732] The in-process engine refuses a search-field override that names no
 * field, as the Data API doors (#27484) and the shared declarations (#27683)
 * do.
 *
 * `searchFields` and the object-form `search.fields` narrow which columns a
 * `search` scans; absent means "scan the object's default search fields". The
 * door refuses a value naming no field with `400 VALIDATION_ERROR`
 * (`assertSearchFieldsAreSearchable`, `@objectstack/metadata-protocol`), and
 * `QuerySchema.searchFields` / `FullTextSearchSchema.fields` refuse it too. The
 * engine never parses its options with those schemas, and `resolveSearchFields`
 * read an empty override as absent, so `find` / `findOne` / `count` /
 * `aggregate` scanned the whole default set: a caller who wrote the override
 * meant to narrow, and got the widest search instead, untold.
 *
 * Driven against a REAL {@link ObjectQL} engine over a driver double that
 * evaluates `$or` / `$icontains` and records each read, so "refused before any
 * driver read" is measured rather than assumed. `harbour` hits `name` on two
 * rows and `city` on a third, so a narrowing is observable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { QuerySchema, FullTextSearchSchema } from '@objectstack/spec/data';
import { mapDataError } from '@objectstack/types';
import { ObjectQL } from './engine.js';

const account = {
  name: 'acct_27732',
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    city: { name: 'city', label: 'City', type: 'text' as const },
    region: { name: 'region', label: 'Region', type: 'text' as const },
  },
};

const ROWS: ReadonlyArray<Record<string, unknown>> = [
  { id: 'a1', name: 'Harbour Freight', city: 'Boston', region: 'east' },
  { id: 'a2', name: 'Harbour Lights', city: 'Seattle', region: 'west' },
  { id: 'a3', name: 'Northgate Mills', city: 'Harbourton', region: 'east' },
  { id: 'a4', name: 'Riverside Co', city: 'Portland', region: 'west' },
];

/** The shared declarations' own refusal words, read off the published schemas. */
const declaredRefusal = (): string => {
  const parsed = (QuerySchema as any).shape.searchFields.safeParse([]);
  expect(parsed.success).toBe(false);
  const nested = FullTextSearchSchema.shape.fields.safeParse([]);
  expect(nested.success).toBe(false);
  expect(nested.error!.issues[0].message).toBe(parsed.error!.issues[0].message);
  return parsed.error!.issues[0].message;
};

function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === '$and') { if (!(v as unknown[]).every((w) => matches(row, w))) return false; continue; }
    if (k === '$or') { if (!(v as unknown[]).some((w) => matches(row, w))) return false; continue; }
    if (k.startsWith('$')) throw new Error(`driver double does not implement the '${k}' combinator`);
    if (v && typeof v === 'object' && '$icontains' in (v as any)) {
      if (!String(row[k] ?? '').toLowerCase().includes(String((v as any).$icontains).toLowerCase())) return false;
      continue;
    }
    const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
    if (row[k] !== expected) return false;
  }
  return true;
}

function makeDriver() {
  const reads: Array<{ via: string; where: unknown }> = [];
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) {
      reads.push({ via: 'find', where: ast?.where });
      const matched = ROWS.filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: any) {
      reads.push({ via: 'findOne', where: ast?.where });
      const hit = ROWS.find((r) => matches(r, ast?.where));
      return hit ? { ...hit } : null;
    },
    async count(_o: string, ast: any) {
      reads.push({ via: 'count', where: ast?.where });
      return ROWS.filter((r) => matches(r, ast?.where)).length;
    },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

/** The refusal as the REST door would answer it: `mapDataError`'s status and code. */
async function wireAnswer(read: Promise<unknown>) {
  const err = await read.then(
    () => { throw new Error('expected a refusal, got an answer'); },
    (e: unknown) => e,
  );
  const mapped = mapDataError(err);
  return { status: mapped.status, code: mapped.body.code, message: (err as Error).message, param: (err as any).param };
}

const COUNT = [{ function: 'count' as const, alias: 'n' }];

type Verb = 'find' | 'findOne' | 'count' | 'aggregate';
const VERBS: readonly Verb[] = ['find', 'findOne', 'count', 'aggregate'];

/** Run one verb with the search keys in `bag`. */
function run(engine: ObjectQL, verb: Verb, bag: Record<string, unknown>): Promise<unknown> {
  switch (verb) {
    case 'find': return engine.find(account.name, bag as any);
    case 'findOne': return engine.findOne(account.name, bag as any);
    case 'count': return engine.count(account.name, bag as any);
    case 'aggregate': return engine.aggregate(account.name, { groupBy: ['region'], aggregations: COUNT, ...bag } as any);
  }
}

/** The ids a verb's answer covers, so a narrowing is read off the result. */
async function answered(engine: ObjectQL, verb: Verb, bag: Record<string, unknown>): Promise<unknown> {
  const out: any = await run(engine, verb, bag);
  if (verb === 'find') return (out as any[]).map((r) => r.id).sort();
  if (verb === 'findOne') return out?.id ?? null;
  if (verb === 'count') return out;
  return Object.fromEntries((out as any[]).map((r) => [r.region, r.n]));
}

/** What each verb answers for `harbour` over the DEFAULT set, and narrowed to `name`. */
const DEFAULT_ANSWER: Record<Verb, unknown> = {
  find: ['a1', 'a2', 'a3'], findOne: 'a1', count: 3, aggregate: { east: 2, west: 1 },
};
const NAME_ONLY_ANSWER: Record<Verb, unknown> = {
  find: ['a1', 'a2'], findOne: 'a1', count: 2, aggregate: { east: 1, west: 1 },
};

describe('[#27732] the in-process engine refuses a search-field override naming no field', () => {
  let engine: ObjectQL;
  let reads: Array<{ via: string; where: unknown }>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const made = makeDriver();
    reads = made.reads;
    engine.registerDriver(made.driver, true);
    await engine.init();
    engine.registry.registerObject(account, 'test-package');
  });

  describe.each(VERBS)('%s', (verb) => {
    it('searchFields: [] is refused 400 VALIDATION_ERROR in the declarations\' words, before any driver read', async () => {
      const answer = await wireAnswer(run(engine, verb, { search: 'harbour', searchFields: [] }));
      expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'searchFields' });
      expect(answer.message).toContain(declaredRefusal());
      expect(reads).toEqual([]);
    });

    it('search: { query, fields: [] } is refused the same way (item 1, the search.fields coupling)', async () => {
      const answer = await wireAnswer(run(engine, verb, { search: { query: 'harbour', fields: [] } }));
      expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'search.fields' });
      expect(answer.message).toContain(declaredRefusal());
      expect(reads).toEqual([]);
    });

    it('a comma string naming no field (the GET transport form) is refused the same way', async () => {
      const answer = await wireAnswer(run(engine, verb, { search: 'harbour', searchFields: ' , ' }));
      expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'searchFields' });
      expect(reads).toEqual([]);
    });

    it('CONTROL: a named override still narrows', async () => {
      expect(await answered(engine, verb, { search: 'harbour', searchFields: ['name'] })).toEqual(NAME_ONLY_ANSWER[verb]);
      expect(await answered(engine, verb, { search: { query: 'harbour', fields: ['name'] } })).toEqual(NAME_ONLY_ANSWER[verb]);
    });

    it('CONTROL: an absent override still searches the default set', async () => {
      expect(await answered(engine, verb, { search: 'harbour' })).toEqual(DEFAULT_ANSWER[verb]);
      expect(await answered(engine, verb, { search: { query: 'harbour' } })).toEqual(DEFAULT_ANSWER[verb]);
    });
  });

  it('an empty override is refused whether or not a search term rode along, as the door judges it', async () => {
    const answer = await wireAnswer(engine.find(account.name, { searchFields: [] }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'searchFields' });
    expect(reads).toEqual([]);
  });

  it('a system-context read is refused too: the rule is about the shape, not the caller', async () => {
    const answer = await wireAnswer(engine.find(account.name, { search: 'harbour', searchFields: [], context: { isSystem: true } }));
    expect(answer).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(reads).toEqual([]);
  });

  it('the REST door answers the same status and code for the same override', async () => {
    const protocol = new ObjectStackProtocolImplementation(engine);
    const door = await wireAnswer(protocol.findData({ object: account.name, query: { search: 'harbour', searchFields: '' } as any }));
    const inProcess = await wireAnswer(engine.find(account.name, { search: 'harbour', searchFields: [] }));
    expect({ status: inProcess.status, code: inProcess.code }).toEqual({ status: door.status, code: door.code });
    expect(door).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(reads).toEqual([]);
  });

  it('CONTROL: a null override is a withdrawal and searches the default set', async () => {
    expect(await answered(engine, 'find', { search: 'harbour', searchFields: null })).toEqual(DEFAULT_ANSWER.find);
  });
});
