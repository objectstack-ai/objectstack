// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit proof of ADR-0055 P0 — related-record topological synthesis in
// `deriveCrudCases`. Pure-function tests over synthetic configs (no stack boot):
// dependency ordering, optional vs required relations, and the honest `blocked`
// verdicts (external/missing target, cascade, required-reference cycle).

import { describe, it, expect } from 'vitest';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from '@objectstack/verify';

const obj = (name: string, fields: Record<string, any>) => ({ name, fields });
const cfg = (...objects: any[]) => ({ manifest: { id: 'fixture' }, objects });

function byName(cases: CrudCase[]): Map<string, CrudCase> {
  return new Map(cases.map((c) => [c.object, c]));
}
function liveOrder(cases: CrudCase[]): string[] {
  return cases.filter((c) => !c.blocked).map((c) => c.object);
}

describe('deriveCrudCases — topological synthesis (ADR-0055 P0)', () => {
  it('orders a required master_detail chain master-before-detail', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('line', {
          name: { type: 'text', required: true },
          order: { type: 'master_detail', reference: 'order', required: true },
        }),
        obj('order', {
          name: { type: 'text', required: true },
          account: { type: 'lookup', reference: 'account', required: true },
        }),
        obj('account', { name: { type: 'text', required: true } }),
      ),
    );
    // account (no deps) → order (needs account) → line (needs order)
    expect(liveOrder(cases)).toEqual(['account', 'order', 'line']);
    const line = byName(cases).get('line')!;
    expect(line.blocked).toBeUndefined();
    expect(line.relationalRefs).toEqual([
      { field: 'order', target: 'order', required: true, multiple: false },
    ]);
  });

  it('records an optional relation as a ref but never blocks on it', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('note', {
          name: { type: 'text', required: true },
          related: { type: 'lookup', reference: 'account' }, // optional
        }),
        obj('account', { name: { type: 'text', required: true } }),
      ),
    );
    const note = byName(cases).get('note')!;
    expect(note.blocked).toBeUndefined();
    expect(note.relationalRefs?.[0]).toMatchObject({ field: 'related', target: 'account', required: false });
  });

  it('blocks an object whose REQUIRED relation target is external/missing', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('thing', {
          name: { type: 'text', required: true },
          ext: { type: 'lookup', reference: 'not_in_app', required: true },
        }),
      ),
    );
    expect(byName(cases).get('thing')!.blocked).toMatch(/not in app config/);
  });

  it('skips (does not block) an OPTIONAL relation to an external target', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('thing', {
          name: { type: 'text', required: true },
          ext: { type: 'lookup', reference: 'not_in_app' }, // optional
        }),
      ),
    );
    const t = byName(cases).get('thing')!;
    expect(t.blocked).toBeUndefined();
    expect(t.skippedFields?.some((s) => s.reason.includes('external'))).toBe(true);
  });

  it('cascade-blocks a dependent when its required target is itself blocked', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('detail', {
          name: { type: 'text', required: true },
          parent: { type: 'master_detail', reference: 'parent', required: true },
        }),
        obj('parent', {
          name: { type: 'text', required: true },
          ext: { type: 'lookup', reference: 'missing', required: true }, // blocks parent
        }),
      ),
    );
    const m = byName(cases);
    expect(m.get('parent')!.blocked).toMatch(/not in app config/);
    expect(m.get('detail')!.blocked).toMatch(/required relational target "parent"/);
  });

  it('blocks a required-reference cycle (incl. required self-reference)', () => {
    const cases = deriveCrudCases(
      cfg(
        obj('a', { name: { type: 'text', required: true }, b: { type: 'lookup', reference: 'b', required: true } }),
        obj('b', { name: { type: 'text', required: true }, a: { type: 'lookup', reference: 'a', required: true } }),
        obj('tree', { name: { type: 'text', required: true }, parent: { type: 'tree', reference: 'tree', required: true } }),
      ),
    );
    const m = byName(cases);
    expect(m.get('a')!.blocked).toMatch(/cycle/);
    expect(m.get('b')!.blocked).toMatch(/cycle/);
    expect(m.get('tree')!.blocked).toMatch(/cycle/);
  });

  it('allows an OPTIONAL self-reference (a tree root with null parent)', () => {
    const cases = deriveCrudCases(
      cfg(obj('cat', { name: { type: 'text', required: true }, parent: { type: 'tree', reference: 'cat' } })),
    );
    expect(byName(cases).get('cat')!.blocked).toBeUndefined();
  });
});

describe('fillRelationalRefs — id threading', () => {
  const c: CrudCase = {
    object: 'line',
    body: { name: 'verify-sample' },
    relationalRefs: [
      { field: 'order', target: 'order', required: true, multiple: false },
      { field: 'tags', target: 'tag', required: false, multiple: true },
    ],
  };

  it('fills required + multiple refs from the created registry', () => {
    const created = new Map([['order', 'o1'], ['tag', 't1']]);
    const { body, missing } = fillRelationalRefs(c, created);
    expect(missing).toBeUndefined();
    expect(body).toEqual({ name: 'verify-sample', order: 'o1', tags: ['t1'] });
  });

  it('reports missing when a REQUIRED target was not created', () => {
    const { missing } = fillRelationalRefs(c, new Map());
    expect(missing).toMatch(/required relation "order"/);
  });

  it('leaves an OPTIONAL ref unset when its target was not created', () => {
    const created = new Map([['order', 'o1']]);
    const { body, missing } = fillRelationalRefs(c, created);
    expect(missing).toBeUndefined();
    expect(body).toEqual({ name: 'verify-sample', order: 'o1' }); // no tags
  });
});
