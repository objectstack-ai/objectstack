// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The seam's own pins (#14105). `validate-dataset-references.test.ts` exercises
// this module through one caller; these pin the VERDICTS directly, because the
// queued siblings (#14148 widget filter keys + sortBy, #14107 list-view field
// positions) consume the verdict union rather than that caller's findings. A
// verdict that silently changes kind would break them with a green suite here
// otherwise.

import { describe, it, expect } from 'vitest';
import {
  indexObjectGraph,
  resolveFieldPath,
  isUnjudgeable,
  nearestName,
  listNames,
  RELATIONSHIP_FIELD_TYPES,
} from './object-graph.js';
import { walkFilterFieldKeys, type FilterFieldKey } from './filter-walk.js';

const stack = {
  objects: [
    {
      name: 'crm_opportunity',
      fields: {
        amount: { type: 'currency', label: 'Amount' },
        account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
        untargeted: { type: 'lookup', label: 'Dangling' },
      },
    },
    {
      name: 'crm_account',
      fields: {
        region: { type: 'text', label: 'Region' },
        owner: { type: 'user', label: 'Owner', reference: 'crm_person' },
      },
    },
    { name: 'crm_person', fields: { email: { type: 'email', label: 'Email' } } },
    // No readable field map — ADR-0015 external / introspected.
    { name: 'ext_thing', datasource: 'remote' },
  ],
};

const graph = indexObjectGraph(stack);

describe('object-graph — resolveFieldPath verdicts', () => {
  it('resolves a base field', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'amount')).toMatchObject({
      kind: 'ok',
      object: 'crm_opportunity',
      field: 'amount',
    });
  });

  it('resolves a two-hop path onto the object the LEAF lives on', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'account.owner.email')).toMatchObject({
      kind: 'ok',
      object: 'crm_person',
      field: 'email',
    });
  });

  it('reports the leaf miss against the object it landed on', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'account.regionn')).toMatchObject({
      kind: 'field-unknown',
      object: 'crm_account',
      field: 'regionn',
    });
  });

  it('reports an unknown hop with its 0-based position', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'accunt.region')).toMatchObject({
      kind: 'hop-unknown',
      at: 0,
      segment: 'accunt',
      object: 'crm_opportunity',
    });
  });

  it('distinguishes a hop through a NON-relationship from an unknown one', () => {
    // The distinction is the whole reason the verdict is a union: "amount is
    // not a relationship" and "accunt is not a field" need different fixes.
    expect(resolveFieldPath(graph, 'crm_opportunity', 'amount.x')).toMatchObject({
      kind: 'hop-not-relationship',
      at: 0,
      segment: 'amount',
      type: 'currency',
    });
  });

  it('treats a relationship with no reference target as unanswerable', () => {
    const verdict = resolveFieldPath(graph, 'crm_opportunity', 'untargeted.x');
    expect(verdict).toMatchObject({ kind: 'hop-untargeted' });
    expect(isUnjudgeable(verdict)).toBe(true);
  });

  it('marks an injected leaf so a caller cannot mistake it for a typed field', () => {
    const verdict = resolveFieldPath(graph, 'crm_opportunity', 'created_at');
    expect(verdict).toMatchObject({ kind: 'ok', injected: true });
    expect((verdict as { meta?: unknown }).meta).toBeUndefined();
  });

  it('skips an object not in the stack, and one with no field map', () => {
    expect(isUnjudgeable(resolveFieldPath(graph, 'not_here', 'x'))).toBe(true);
    expect(resolveFieldPath(graph, 'not_here', 'x')).toMatchObject({ reason: 'object-not-in-stack' });
    expect(resolveFieldPath(graph, 'ext_thing', 'x')).toMatchObject({ reason: 'no-field-map' });
  });

  it('skips a hop through an injected column rather than guessing its target', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'owner_id.name')).toMatchObject({
      kind: 'unknowable',
      reason: 'injected-hop',
    });
  });

  it('answers undefined when there is nothing to resolve', () => {
    expect(resolveFieldPath(graph, undefined, 'amount')).toBeUndefined();
    expect(resolveFieldPath(graph, 'crm_opportunity', '')).toBeUndefined();
    expect(isUnjudgeable(undefined)).toBe(true);
  });

  it('reads the name-keyed collection shape', () => {
    const mapGraph = indexObjectGraph({ objects: { a: { fields: { n: { type: 'text' } } } } });
    expect(resolveFieldPath(mapGraph, 'a', 'n')).toMatchObject({ kind: 'ok' });
  });

  it('carries the relationship type set the platform traverses', () => {
    expect([...RELATIONSHIP_FIELD_TYPES].sort()).toEqual(['lookup', 'master_detail', 'tree', 'user']);
  });
});

describe('object-graph — suggestion helpers', () => {
  it('suggests within the budget and stays silent outside it', () => {
    expect(nearestName('regionn', ['region', 'amount'])).toBe('region');
    expect(nearestName('zzzzzzzz', ['region', 'amount'])).toBeUndefined();
  });

  it('lists names sorted, or `(none)`', () => {
    expect(listNames(['b', 'a'])).toBe('a, b');
    expect(listNames([])).toBe('(none)');
  });
});

describe('filter-walk — walkFilterFieldKeys across the three authored shapes', () => {
  const keys = (node: unknown): FilterFieldKey[] => {
    const out: FilterFieldKey[] = [];
    walkFilterFieldKeys(node, 'f', (k) => out.push(k));
    return out;
  };

  it('reads a Mongo condition object, operators and all', () => {
    expect(keys({ status: 'open', amount: { $gt: 10 } })).toEqual([
      { field: 'status', path: 'f.status' },
      { field: 'amount', path: 'f.amount' },
    ]);
  });

  it('descends combinators without reporting them as fields', () => {
    expect(keys({ $or: [{ a: 1 }, { $not: { b: 2 } }] })).toEqual([
      { field: 'a', path: 'f.$or[0].a' },
      { field: 'b', path: 'f.$or[1].$not.b' },
    ]);
  });

  it('composes a nested condition object into one relationship path', () => {
    expect(keys({ account: { region: 'emea' } })).toEqual([
      { field: 'account.region', path: 'f.account.region' },
    ]);
  });

  it('reports the hop itself when the nested object is empty', () => {
    expect(keys({ account: {} })).toEqual([{ field: 'account', path: 'f.account' }]);
  });

  it('reads the { field, operator, value } rule shape', () => {
    expect(keys([{ field: 'status', operator: 'equals', value: 'open' }])).toEqual([
      { field: 'status', path: 'f[0].field' },
    ]);
  });

  it('reads triples and their and/or groups', () => {
    expect(keys(['and', ['status', '=', 'open'], ['amount', '>', 1]])).toEqual([
      { field: 'status', path: 'f[1][0]' },
      { field: 'amount', path: 'f[2][0]' },
    ]);
  });

  it('does not descend an unrecognised $ operator', () => {
    expect(keys({ $weird: { a: 1 } })).toEqual([]);
  });

  it('tolerates non-filter input', () => {
    expect(keys(undefined)).toEqual([]);
    expect(keys('a string')).toEqual([]);
  });
});
