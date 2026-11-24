// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36237] `findHopListEquality` — the `list-equality` refusal one
 * relationship hop away. `record.account.labels == 'vip'`, where `account` is
 * a reference and `labels` a list-valued field of its target, compares the
 * whole hydrated list with the scalar: one constant on every row, the root
 * case's defect (`validate-list-equality-36167.test.ts`). The hint carries the
 * root object's fields only, so the caller that resolves hop targets hands
 * the reference → list-valued-leaves map in.
 *
 * The first describe proves the premise on the evaluator, over the shape the
 * hop loader binds (the related row nested under the reference field).
 */

import { describe, it, expect } from 'vitest';

import { celEngine } from './cel-engine';
import { findHopListEquality } from './validate';

/** `account` reaches a target whose `labels` is list-valued. */
const LEAVES: ReadonlyMap<string, ReadonlySet<string>> = new Map([['account', new Set(['labels'])]]);

describe('the premise — a hydrated hop to a list, compared with a scalar, is a constant', () => {
  const run = (source: string, labels: unknown) =>
    celEngine.evaluate({ dialect: 'cel', source }, { record: { account: { id: 'a1', labels } } });
  it.each([[['vip', 'eu']], [['eu']], [[]], [null]])('labels = %j', (labels) => {
    expect(run("record.account.labels == 'vip'", labels)).toEqual({ ok: true, value: false });
    expect(run("record.account.labels != 'vip'", labels)).toEqual({ ok: true, value: true });
  });
});

describe('findHopListEquality — refused', () => {
  it.each([
    ["record.account.labels == 'vip'", '==', 'false'],
    ["'vip' != record.account.labels", '!=', 'true'],
    ["record['account']['labels'] == 'vip'", '==', 'false'],
    ["record.amount > 1 && record.account.labels != 'vip'", '!=', 'true'],
  ] as const)('%s, under the root case\'s code and params', (source, operator, answer) => {
    const errors = findHopListEquality(source, LEAVES);
    expect(errors).toHaveLength(1);
    const [e] = errors;
    expect(e.code).toBe('list-equality');
    expect(e.code === 'list-equality' && e.params.reference).toBe('record.account.labels');
    expect(e.code === 'list-equality' && e.params.operator).toBe(operator);
    expect(e.code === 'list-equality' && e.params.answer).toBe(answer);
    expect(e.source).toBe(source);
  });

  it('the prescribed rewrite answers per row on the hydrated hop, and is not itself refused', () => {
    const [eq] = findHopListEquality("record.account.labels == 'vip'", LEAVES);
    const [ne] = findHopListEquality("record.account.labels != 'vip'", LEAVES);
    const eqRewrite = eq!.code === 'list-equality' ? eq!.params.rewrite : '';
    const neRewrite = ne!.code === 'list-equality' ? ne!.params.rewrite : '';
    expect(eqRewrite).toBe('(has(record.account.labels) && record.account.labels != null && "vip" in record.account.labels)');
    const run = (source: string, labels: unknown) =>
      celEngine.evaluate({ dialect: 'cel', source }, { record: { account: { id: 'a1', labels } } });
    expect(run(eqRewrite, ['vip', 'eu'])).toEqual({ ok: true, value: true });
    expect(run(eqRewrite, ['eu'])).toEqual({ ok: true, value: false });
    expect(run(eqRewrite, null)).toEqual({ ok: true, value: false });
    expect(run(neRewrite, ['vip'])).toEqual({ ok: true, value: false });
    expect(run(neRewrite, null)).toEqual({ ok: true, value: true });
    expect(findHopListEquality(eqRewrite, LEAVES)).toEqual([]);
    expect(findHopListEquality(neRewrite, LEAVES)).toEqual([]);
  });
});

describe('findHopListEquality — CONTROL, accepted', () => {
  it.each([
    // A scalar field on the same hop target.
    "record.account.name == 'vip'",
    "record.account.labels == null",
    "'vip' in record.account.labels",
    // The list-valued field of the ROOT object is the shared validator's verdict, not this one's.
    "record.labels == 'vip'",
    // Another reference the map does not name.
    "record.parent.labels == 'vip'",
    // Two hops deep is the traversal checks' refusal.
    "record.account.owner.labels == 'vip'",
    // A comprehension macro binding `record` holds an item, not the row.
    "[{'account': {'labels': 'x'}}].exists(record, record.account.labels == 'x')",
  ])('%s', (source) => {
    expect(findHopListEquality(source, LEAVES)).toEqual([]);
  });

  it('an empty map, and a source that does not compile, get no verdict', () => {
    expect(findHopListEquality("record.account.labels == 'vip'", new Map())).toEqual([]);
    expect(findHopListEquality("record.account.labels == 'vip' &&", LEAVES)).toEqual([]);
  });
});
