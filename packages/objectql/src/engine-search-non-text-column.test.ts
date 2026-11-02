// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29394] The `$search` expansion emits no text clause over a column whose
 * DECLARED type can never hold a string — the #15661 door's own verdict
 * (`textOperatorDoorVerdict`, `@objectstack/spec/data`), read, never re-listed.
 *
 * The door judges the caller's `where` before `expandSearchOnAst` runs, so the
 * expansion's `$icontains` never met it: a declared `searchableFields` naming a
 * `number` / `boolean` / `date` / `json` column (and, once `searchable: true`
 * joins the auto set, a flagged one) sent the driver exactly the predicate the
 * door refuses when a caller writes it. Beneath the door each backend answered
 * that predicate its own way: the SQL family refuses it on a JSON column
 * (`INVALID_FILTER`, so the whole search fails) and type-gates it to no-match
 * on a numeric / boolean / temporal one, while a value-keyed evaluator matches
 * the value's text rendering (`42` hits `'4'`, a date hits `'2026'`).
 *
 * The answer chosen is SKIP: such a column contributes no clause. A search
 * term is text, and a column that can never hold text has nothing for it to
 * match, on any backend — the same declared no-match the SQL faces compile.
 * The resolved search set is unchanged, so every refusal judged on it (#24284
 * empty set, #28120 override) answers as before, and a set holding ONLY such
 * columns answers no rows: each term's `$or` has no arm, which is FALSE
 * (`FILTER_LOGIC_CASES`, "empty $or is FALSE"). Not an error, not every row.
 *
 * Dialect-neutral: the pin is on the AST the driver receives. The real-driver
 * half is `packages/rest/src/data-search-non-text-column-door.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TEXT_OPERATOR_DOOR_FIXTURE,
  TEXT_OPERATOR_DOOR_FIXTURE_OBJECT,
  textOperatorDoorVerdict,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { findTextOperatorOverNonTextField } from './text-operator-declared-type-door.js';

type Row = Record<string, unknown>;

const OBJECT = 'search_non_text_29394';
const ONLY_NON_TEXT = 'search_only_non_text_29394';
const AUTO_FLAGGED = 'search_auto_flagged_29394';

const FIELDS = {
  name: { type: 'text' },
  qty: { type: 'number' },
  born: { type: 'date' },
  active: { type: 'boolean' },
  meta: { type: 'json' },
} as const;

const ROWS: Row[] = [
  { id: 'r1', name: 'qq9-alpha', qty: 42, born: '2026-01-05', active: true, meta: { k: 'qq9' } },
  { id: 'r2', name: 'qq9-beta', qty: 7, born: '2025-03-01', active: false, meta: { k: 'x' } },
  { id: 'r3', name: 'other', qty: 420, born: '2026-02-02', active: true, meta: { k: 'qq9' } },
];

/** The keys every clause of an emitted search `$or` names — the fields the search scanned. */
function scannedFields(where: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [k, v] of Object.entries(node as Row)) {
      if (k === '$and' || k === '$or') { for (const arm of v as unknown[]) walk(arm); continue; }
      if (!k.startsWith('$')) out.add(k);
    }
  };
  walk(where);
  return [...out].sort();
}

/**
 * A value-keyed evaluator, the shape of the in-memory faces: a text operator
 * reads the stored value's text rendering. That is exactly how a search term
 * matched `42` or a date on such a face before the skip.
 */
const MATCHERS: Record<string, (value: unknown, operand: unknown) => boolean> = {
  $icontains: (value, operand) => value != null && String(value).toLowerCase().includes(String(operand).toLowerCase()),
};

function matches(row: Row, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where as Row)) {
    if (k === '$and') { if (!(v as unknown[]).every((w) => matches(row, w))) return false; continue; }
    if (k === '$or') { if (!(v as unknown[]).some((w) => matches(row, w))) return false; continue; }
    if (k.startsWith('$')) throw new Error(`matcher: unimplemented key ${k}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [op, operand] of Object.entries(v as Row)) {
        const m = MATCHERS[op];
        if (!m) throw new Error(`matcher: unimplemented operator ${op}`);
        if (!m(row[k], operand)) return false;
      }
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function makeDriver() {
  const reads: Array<{ object: string; where: unknown }> = [];
  const read = (object: string, ast: any) => {
    reads.push({ object, where: ast?.where });
    const rows = ([OBJECT, ONLY_NON_TEXT, AUTO_FLAGGED].includes(object) ? ROWS : []).filter((r) => matches(r, ast?.where));
    return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
  };
  const driver: any = {
    name: 'mem', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { return read(object, ast).map((r) => ({ ...r })); },
    async findOne(object: string, ast: any) { return read(object, ast)[0] ?? null; },
    async count(object: string, ast: any) { return read(object, ast).length; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

describe('[#29394] $search emits no text clause over a never-string-capable column', () => {
  let engine: ObjectQL;
  let reads: ReturnType<typeof makeDriver>['reads'];
  const lastWhere = (object = OBJECT) => [...reads].reverse().find((r) => r.object === object)?.where;

  beforeEach(async () => {
    const made = makeDriver();
    reads = made.reads;
    engine = new ObjectQL();
    engine.registerDriver(made.driver, true);
    await engine.init();
    const registry = engine.registry as any;
    registry.registerObject({
      name: OBJECT,
      searchableFields: ['name', 'qty', 'born', 'active', 'meta'],
      fields: FIELDS,
    }, 'test');
    registry.registerObject({
      name: ONLY_NON_TEXT,
      searchableFields: ['qty', 'born', 'active', 'meta'],
      fields: FIELDS,
    }, 'test');
    // The AUTO branch (ruling 6573569376 letter A): no `searchableFields`, so
    // every field marked `searchable: true` joins the set, of any type. The
    // resolver admits the flagged number / date / json fields; the expansion
    // must still emit no text clause for them.
    registry.registerObject({
      name: AUTO_FLAGGED,
      fields: {
        name: { type: 'text' },
        qty: { type: 'number', searchable: true },
        born: { type: 'date', searchable: true },
        meta: { type: 'json', searchable: true },
      },
    }, 'test');
    registry.registerObject({
      ...TEXT_OPERATOR_DOOR_FIXTURE,
      // Every fixture field the declared branch keeps: one per FieldType member.
      searchableFields: Object.keys(TEXT_OPERATOR_DOOR_FIXTURE.fields).filter((f) => f !== 'id'),
    }, 'test');
  });

  it('the declared set over every FieldType: the emitted search is one the #15661 door passes', async () => {
    await engine.find(TEXT_OPERATOR_DOOR_FIXTURE_OBJECT, { search: 'zz', context: { isSystem: true } });
    const where = lastWhere(TEXT_OPERATOR_DOOR_FIXTURE_OBJECT);
    // The door's own walk, over the expansion's output: no text operator aimed
    // at a column the door would refuse it on.
    expect(findTextOperatorOverNonTextField(TEXT_OPERATOR_DOOR_FIXTURE, where)).toBeNull();
    const scanned = scannedFields(where);
    const fields = TEXT_OPERATOR_DOOR_FIXTURE.fields as Record<string, { type: string; returnType?: string }>;
    for (const f of scanned) expect(textOperatorDoorVerdict(fields[f]!), f).not.toBe('door-refusal');
    // Control: the string-capable columns are still scanned (text, an option
    // code, a reference id, a multi-valued option field).
    for (const f of ['f_text', 'f_select', 'f_lookup', 'f_tags']) expect(scanned, f).toContain(f);
  });

  it('a mixed declared set scans only the text column: number, date, boolean and json contribute no clause', async () => {
    const rows = await engine.find(OBJECT, { search: 'qq9' });
    expect(scannedFields(lastWhere())).toEqual(['name']);
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('a term matching only a non-text value\'s text rendering matches nothing — 42, 2026, true', async () => {
    for (const term of ['42', '2026', 'true']) {
      expect(await engine.find(OBJECT, { search: term }), term).toEqual([]);
      expect(scannedFields(lastWhere()), term).toEqual(['name']);
    }
  });

  it('multi-term: every term\'s $or carries only the text column', async () => {
    const rows = await engine.find(OBJECT, { search: 'qq9 alpha' });
    expect(rows.map((r) => r.id)).toEqual(['r1']);
    expect(lastWhere()).toEqual({ $and: [
      { $or: [{ name: { $icontains: 'qq9' } }] },
      { $or: [{ name: { $icontains: 'alpha' } }] },
    ] });
  });

  it('a set of only non-text columns answers NO rows — the driver is asked, nothing is refused, not every row', async () => {
    for (const term of ['qq9', '42', '2026']) {
      const before = reads.length;
      expect(await engine.find(ONLY_NON_TEXT, { search: term }), term).toEqual([]);
      expect(await engine.count(ONLY_NON_TEXT, { search: term }), term).toBe(0);
      expect(reads.length - before, 'the driver answered the read').toBe(2);
      expect(lastWhere(ONLY_NON_TEXT), term).toEqual({ $or: [] });
    }
    // A blank term is still not a search: every row.
    expect(await engine.find(ONLY_NON_TEXT, { search: '  ' })).toHaveLength(3);
  });

  it('an override naming a declared non-text column is honoured as that column: no rows, no refusal', async () => {
    expect(await engine.find(OBJECT, { search: '42', searchFields: ['qty'] })).toEqual([]);
    expect(lastWhere()).toEqual({ $or: [] });
    // Control: naming the text column beside it still matches through it.
    const rows = await engine.find(OBJECT, { search: 'qq9', searchFields: ['qty', 'name'] });
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(scannedFields(lastWhere())).toEqual(['name']);
  });

  it('the auto branch: flagged searchable: true number / date / json fields get no clause; the text control is still scanned', async () => {
    const rows = await engine.find(AUTO_FLAGGED, { search: 'qq9' });
    expect(scannedFields(lastWhere(AUTO_FLAGGED))).toEqual(['name']);
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    for (const term of ['42', '2026']) {
      expect(await engine.find(AUTO_FLAGGED, { search: term }), term).toEqual([]);
    }
    // The flag still admits them into the set: naming one is honoured, not
    // refused, and answers no rows.
    expect(await engine.find(AUTO_FLAGGED, { search: '42', searchFields: ['qty'] })).toEqual([]);
    expect(lastWhere(AUTO_FLAGGED)).toEqual({ $or: [] });
  });

  it('control: an override outside the declared set is still refused, judged on the unchanged set', async () => {
    await expect(engine.find(OBJECT, { search: 'qq9', searchFields: ['nope'] }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FIELD', param: 'searchFields', field: 'nope' });
  });
});
