// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The record scope of a search (ADR-0161 K8, item 17, as its dated note of
// 2026-11-25 shapes it): the bounds a caller's scope is held to, the terms each
// source is handed, and the check every hit passes after the adapter answers.

import { describe, expect, it } from 'vitest';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import {
  SEARCH_SCOPE_MAX_ENTRIES,
  SEARCH_SCOPE_MAX_IDS,
  readSearchScope,
  scopeCheck,
  scopeTermsFor,
} from '../knowledge-search-scope.js';

/** A thrown error's ADR-0112 code and status, and its message. */
function refusalOf(fn: () => unknown): { code?: unknown; status?: unknown; message: string } {
  try {
    fn();
  } catch (err) {
    const e = err as Error & { code?: unknown; status?: unknown };
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal, got none');
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`);

describe('readSearchScope — the bounds, before any adapter is called', () => {
  it('the bounds are 10 entries and 500 ids per entry, as AdapterSearchOptions.scope states them', () => {
    expect(SEARCH_SCOPE_MAX_ENTRIES).toBe(10);
    expect(SEARCH_SCOPE_MAX_IDS).toBe(500);
  });

  it('absent is no scope; an empty list and an entry with no ids are kept, never read as "no scope"', () => {
    expect(readSearchScope(undefined)).toBeUndefined();
    expect(readSearchScope([])).toEqual([]);
    expect(readSearchScope([{ object: 'policy', ids: [] }])).toEqual([{ object: 'policy', ids: [] }]);
  });

  it('a scope at its bounds is accepted, as a copy', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({ object: `o${i}`, ids: ids(500) }));
    const out = readSearchScope(input)!;
    expect(out).toEqual(input);
    expect(out[0].ids).not.toBe(input[0].ids);
  });

  it.each([
    ['not a list', { object: 'policy', ids: ['p1'] }, /takes a list of \{ object, ids \} entries/],
    ['null', null, /takes a list/],
    ['11 entries', Array.from({ length: 11 }, () => ({ object: 'policy', ids: ['p1'] })), /at most 10 entries, got 11/],
    ['501 ids in one entry', [{ object: 'policy', ids: ids(501) }], /entry 0 takes at most 500 ids, got 501/],
    ['an entry that is not an object', ['policy'], /entry 0 is not an object/],
    ['an entry naming a field', [{ object: 'policy', ids: ['p1'], field: 'policy' }], /entry 0 has the key 'field'/],
    ['no object', [{ ids: ['p1'] }], /entry 0 needs object/],
    ['an empty object name', [{ object: '', ids: ['p1'] }], /entry 0 needs object/],
    ['ids not a list', [{ object: 'policy', ids: 'p1' }], /entry 0 needs ids, a list/],
    ['a numeric id', [{ object: 'policy', ids: [7] }], /entry 0 has an id that is not a non-empty string/],
    ['an empty id', [{ object: 'policy', ids: [''] }], /entry 0 has an id that is not a non-empty string/],
  ])('%s: a coded refusal naming the bound (VALIDATION_ERROR, 400)', (_label, scope, message) => {
    const refusal = refusalOf(() => readSearchScope(scope));
    expect(refusal).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refusal.message).toMatch(message);
  });
});

/** A clause source over `clause` that lists `fields` as metadata. */
function clauseSource(fields: string[]): KnowledgeSource {
  return {
    name: 'clauses',
    label: 'Clauses',
    adapter: 'memory',
    source: { kind: 'object', object: 'clause', content: ['body'], metadataFields: fields } as ObjectKnowledgeSource,
  } as KnowledgeSource;
}

const CLAUSE_FIELDS = {
  body: { type: 'textarea' },
  policy: { type: 'lookup', reference: 'policy' },
  chapter: { type: 'master_detail', reference: 'chapter' },
  owner: { type: 'user' },
  reviewer: { type: 'lookup', reference: 'sys_user' },
  parent_clause: { type: 'lookup', reference: 'clause' },
  supersedes: { type: 'tree', reference: 'clause' },
  audit_policy: { type: 'lookup', reference: 'policy', internal: true },
  status: { type: 'select' },
};
const schemaOf = (fields: Record<string, unknown> = CLAUSE_FIELDS) => (object: string): unknown =>
  object === 'clause' ? { name: 'clause', fields } : undefined;

describe('scopeTermsFor — the terms a source is handed', () => {
  it("an entry naming the source's own object is a record term, and nothing else", () => {
    const source = clauseSource(['parent_clause', 'supersedes', 'status']);
    expect(scopeTermsFor(source, [{ object: 'clause', ids: ['c1', 'c2'] }], schemaOf())).toEqual({
      terms: [{ kind: 'record', ids: ['c1', 'c2'] }],
      ambiguous: [],
    });
  });

  it('an entry naming a parent is a metadata term on the one listed lookup or master_detail field pointing at it', () => {
    const source = clauseSource(['policy', 'chapter', 'status']);
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], schemaOf()).terms).toEqual([
      { kind: 'metadata', field: 'policy', ids: ['p1'] },
    ]);
    expect(scopeTermsFor(source, [{ object: 'chapter', ids: ['ch1'] }], schemaOf()).terms).toEqual([
      { kind: 'metadata', field: 'chapter', ids: ['ch1'] },
    ]);
  });

  it('several entries are several terms, a union', () => {
    const source = clauseSource(['policy']);
    const scope = [
      { object: 'clause', ids: ['c1'] },
      { object: 'policy', ids: ['p1', 'p2'] },
    ];
    expect(scopeTermsFor(source, scope, schemaOf()).terms).toEqual([
      { kind: 'record', ids: ['c1'] },
      { kind: 'metadata', field: 'policy', ids: ['p1', 'p2'] },
    ]);
  });

  it('a field the source does not list reaches nothing', () => {
    const source = clauseSource(['status']);
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], schemaOf())).toEqual({ terms: [], ambiguous: [] });
  });

  it('a user field is not a parent link; a lookup to sys_user is', () => {
    const owner = clauseSource(['owner']);
    expect(scopeTermsFor(owner, [{ object: 'sys_user', ids: ['u1'] }], schemaOf()).terms).toEqual([]);
    const reviewer = clauseSource(['reviewer']);
    expect(scopeTermsFor(reviewer, [{ object: 'sys_user', ids: ['u1'] }], schemaOf()).terms).toEqual([
      { kind: 'metadata', field: 'reviewer', ids: ['u1'] },
    ]);
  });

  it('a field assembly withholds is not a parent link: no document carries it', () => {
    const source = clauseSource(['audit_policy']);
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], schemaOf()).terms).toEqual([]);
  });

  it('two listed fields pointing at the entry\'s object: the entry does not reach the source, and both are named', () => {
    const fields = { ...CLAUSE_FIELDS, cited_policy: { type: 'lookup', reference: 'policy' } };
    const source = clauseSource(['policy', 'cited_policy']);
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], schemaOf(fields))).toEqual({
      terms: [],
      ambiguous: [{ object: 'policy', fields: ['policy', 'cited_policy'] }],
    });
  });

  it('no registered definition: a parent entry reaches nothing, an own-object entry still does', () => {
    const source = clauseSource(['policy']);
    const none = (): unknown => undefined;
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], none).terms).toEqual([]);
    expect(scopeTermsFor(source, [{ object: 'clause', ids: ['c1'] }], none).terms).toEqual([{ kind: 'record', ids: ['c1'] }]);
  });

  it('a definition whose fields are a list is read as well', () => {
    const source = clauseSource(['policy']);
    const listed = (): unknown => ({ name: 'clause', fields: [{ name: 'policy', type: 'lookup', reference: 'policy' }] });
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], listed).terms).toEqual([
      { kind: 'metadata', field: 'policy', ids: ['p1'] },
    ]);
  });

  it('a field whose target cannot be read is no link', () => {
    const fields = { policy: { type: 'lookup', reference: { object: 'policy' } } };
    const source = clauseSource(['policy']);
    expect(scopeTermsFor(source, [{ object: 'policy', ids: ['p1'] }], schemaOf(fields)).terms).toEqual([]);
  });

  it('an entry with no ids gives no term', () => {
    const source = clauseSource(['policy']);
    expect(scopeTermsFor(source, [{ object: 'clause', ids: [] }, { object: 'policy', ids: [] }], schemaOf()).terms).toEqual([]);
  });

});

describe('scopeCheck — every hit, after the adapter answers', () => {
  const hit = (sourceRecordId: string | undefined, metadata?: Record<string, unknown>): KnowledgeHit => ({
    chunkId: 'x#0', documentId: 'x', sourceId: 'clauses', score: 1, snippet: '',
    ...(sourceRecordId === undefined ? {} : { sourceRecordId }),
    ...(metadata === undefined ? {} : { metadata }),
  });

  it("a record term holds on the hit's sourceRecordId", () => {
    const check = scopeCheck([{ kind: 'record', ids: ['c1'] }]);
    expect(check(hit('c1'))).toBe(true);
    expect(check(hit('c2'))).toBe(false);
    expect(check(hit(undefined))).toBe(false);
  });

  it("a metadata term holds on the hit's metadata[field] — a list when any element does", () => {
    const check = scopeCheck([{ kind: 'metadata', field: 'policy', ids: ['p1'] }]);
    expect(check(hit('c1', { policy: 'p1' }))).toBe(true);
    expect(check(hit('c1', { policy: ['p3', 'p1'] }))).toBe(true);
    expect(check(hit('c1', { policy: ['p3'] }))).toBe(false);
    expect(check(hit('c1', { policy: 'p2' }))).toBe(false);
  });

  it('values are compared as strings: a number matches its id; an object, null or a boolean never does', () => {
    expect(scopeCheck([{ kind: 'metadata', field: 'policy', ids: ['7'] }])(hit('c1', { policy: 7 }))).toBe(true);
    const objectId = scopeCheck([{ kind: 'metadata', field: 'policy', ids: ['[object Object]', 'null', 'true'] }]);
    expect(objectId(hit('c1', { policy: { id: 'p1' } }))).toBe(false);
    expect(objectId(hit('c1', { policy: null }))).toBe(false);
    expect(objectId(hit('c1', { policy: true }))).toBe(false);
  });

  it('a hit without the value is out of scope (fail closed)', () => {
    const check = scopeCheck([{ kind: 'metadata', field: 'policy', ids: ['p1'] }]);
    expect(check(hit('c1'))).toBe(false);
    expect(check(hit('c1', {}))).toBe(false);
  });

  it('terms are a union; no term holds for nothing', () => {
    const check = scopeCheck([
      { kind: 'record', ids: ['c9'] },
      { kind: 'metadata', field: 'policy', ids: ['p1'] },
    ]);
    expect(check(hit('c9'))).toBe(true);
    expect(check(hit('c1', { policy: 'p1' }))).toBe(true);
    expect(check(hit('c1', { policy: 'p2' }))).toBe(false);
    expect(scopeCheck([])(hit('c1', { policy: 'p1' }))).toBe(false);
  });
});
