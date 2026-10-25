/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `toPredicateRecord` — bind a fetched record the way the SERVER binds it
 * (objectui#3501).
 *
 * The table these cases pin is the one measured against a live runtime: with
 * the payload as delivered, `record.<relation>` means the id on a plain read
 * and the whole related record on an expanded one, so no predicate spelling is
 * right on every surface. Collapsing to the id makes the plain-read column the
 * only one — and the same one the server's CEL engine sees.
 */

import { describe, it, expect } from 'vitest';
import { toPredicateRecord } from '../predicate-record';

const FIELDS = {
  title: { type: 'text' },
  project: { type: 'master_detail', reference: 'showcase_project' },
  account: { type: 'lookup', reference: 'showcase_account' },
  accounts: { type: 'lookup', reference: 'showcase_account', multiple: true },
  owner: { type: 'user' },
  // No `reference` — optional on a `tree`, and must name the declaring
  // object when present (objectstack#14892). This map declares none, and
  // `toPredicateRecord` collapses by declared TYPE, never by target
  // (objectui#7839).
  parent: { type: 'tree' },
  config: { type: 'json' },
};

describe('toPredicateRecord', () => {
  it('collapses an expanded relation to the id it stands for', () => {
    const out = toPredicateRecord(
      { title: 'T', project: { id: 'P1', name: 'Website Relaunch' } },
      FIELDS,
    );

    expect(out.project).toBe('P1');
    // Everything else is carried untouched.
    expect(out.title).toBe('T');
  });

  it('leaves an unexpanded foreign key alone', () => {
    const record = { title: 'T', project: 'P1' };
    const out = toPredicateRecord(record, FIELDS);

    // Nothing to collapse → the SAME object, so downstream memos hold.
    expect(out).toBe(record);
  });

  it('collapses every relational field type, not just `lookup`', () => {
    const out = toPredicateRecord(
      {
        project: { id: 'P1' },
        account: { id: 'A1' },
        owner: { id: 'U1' },
        parent: { id: 'C1' },
      },
      FIELDS,
    );

    expect(out).toEqual({ project: 'P1', account: 'A1', owner: 'U1', parent: 'C1' });
  });

  it('collapses a multi-value relation element-wise', () => {
    const out = toPredicateRecord(
      { accounts: [{ id: 'A1', name: 'Acme' }, { id: 'A2', name: 'Globex' }] },
      FIELDS,
    );

    expect(out.accounts).toEqual(['A1', 'A2']);
  });

  it('leaves a mixed array member that is already an id', () => {
    const out = toPredicateRecord({ accounts: ['A1', { id: 'A2' }] }, FIELDS);

    expect(out.accounts).toEqual(['A1', 'A2']);
  });

  it('keeps an EMPTY relation as null — a clean false, not a fault', () => {
    const record = { account: null };
    const out = toPredicateRecord(record, FIELDS);

    expect(out).toBe(record);
    expect(out.account).toBeNull();
  });

  it('does NOT touch a non-relational object field', () => {
    // The reason this is schema-driven rather than a shape sniff: a `json`
    // payload that happens to carry an `id` must keep meaning what it says.
    const record = { config: { id: 'not-a-relation', retries: 3 } };
    const out = toPredicateRecord(record, FIELDS);

    expect(out).toBe(record);
    expect(out.config).toEqual({ id: 'not-a-relation', retries: 3 });
  });

  it('collapses nothing without a schema — a caller that cannot name the relations must not guess', () => {
    const record = { project: { id: 'P1' } };

    expect(toPredicateRecord(record, undefined)).toBe(record);
    expect(toPredicateRecord(record, {})).toBe(record);
  });

  it('reads the ARRAY field-container shape too', () => {
    const out = toPredicateRecord({ project: { id: 'P1' } }, [
      { name: 'title', type: 'text' },
      { name: 'project', type: 'master_detail' },
    ]);

    expect(out.project).toBe('P1');
  });

  it('accepts `_id` as the id key', () => {
    const out = toPredicateRecord({ project: { _id: 'P1', name: 'x' } }, FIELDS);

    expect(out.project).toBe('P1');
  });

  it('leaves an expanded record with no id at all', () => {
    // Nothing to collapse TO — dropping it would lose the only value there is.
    const record = { project: { name: 'Website Relaunch' } };
    const out = toPredicateRecord(record, FIELDS);

    expect(out).toBe(record);
  });

  it('tolerates a null/undefined record', () => {
    expect(toPredicateRecord(null, FIELDS)).toBeNull();
    expect(toPredicateRecord(undefined, FIELDS)).toBeUndefined();
  });

  it('never mutates the input record', () => {
    const record = { project: { id: 'P1', name: 'Website Relaunch' } };
    toPredicateRecord(record, FIELDS);

    expect(record.project).toEqual({ id: 'P1', name: 'Website Relaunch' });
  });
});
