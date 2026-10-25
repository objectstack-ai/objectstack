/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4664 — `relatedListFilter` on the FK reaches the derived descriptor.
 *
 * This is the FIRST hop only. The load-bearing subject — the composed `$filter`
 * on the wire, and the badge/row parity it buys — is asserted end to end in
 * `app-shell/src/views/RecordDetailView.relatedListFilter-4664.test.tsx`, for
 * the reason stated there: every hop between here and the query re-drops the
 * descriptor onto a fresh literal, so a green assertion here says nothing about
 * what the page sends.
 *
 * What this file DOES decide is the one thing the page test cannot show cheaply:
 * exactly which authored values count as a declaration. The spec types the key
 * `FilterConditionSchema` — a plain object — and this reader neither coerces
 * anything into that shape nor accepts an alias for it (AGENTS.md #0.1). The
 * counter-probes below are that refusal, written down.
 */

import { describe, it, expect } from 'vitest';
import { deriveRelatedLists } from '../deriveRelatedLists';

const PARENT = 'task_version';

const parent = { name: PARENT, label: 'Task Version', fields: {} };

const child = (fkExtras: Record<string, unknown>) => ({
  name: 'check_item',
  label: 'Check Item',
  fields: {
    [PARENT]: { type: 'master_detail', reference: PARENT, label: 'Task Version', ...fkExtras },
  },
});

const derive = (fkExtras: Record<string, unknown>) =>
  deriveRelatedLists(parent, [parent, child(fkExtras)]);

describe('deriveRelatedLists — relatedListFilter (objectui#4664)', () => {
  it('carries a declared FilterCondition through VERBATIM', () => {
    const declared = { status: { $ne: 'archived' } };
    const [list] = derive({ relatedListFilter: declared });
    // Verbatim, not normalized: the canonical Query-DSL object is exactly what
    // `record:related_list.filter` already accepts, so re-spelling it here
    // would be inventing a second dialect for derived pages — the one thing
    // this card's third requirement forbids.
    expect(list.filter).toEqual(declared);
  });

  it('carries a multi-key condition without flattening or reordering it', () => {
    const declared = { status: { $ne: 'archived' }, is_active: true };
    expect(derive({ relatedListFilter: declared })[0].filter).toEqual(declared);
  });

  it('COUNTER-PROBE — the key is ABSENT, not undefined, when nothing is declared', () => {
    const [list] = derive({});
    // `'filter' in list` rather than a `toBeUndefined()`: an explicit
    // `filter: undefined` is a different fact from "the author said nothing",
    // and it is the one that would travel onto the synthesized node.
    expect('filter' in list).toBe(false);
  });

  it('COUNTER-PROBE — an empty object is silence, not a declaration', () => {
    // The spec's own rule for empty combinators makes `{}` a boolean identity,
    // so forwarding it would put a key on the node meaning exactly what saying
    // nothing means — and would change the emitted node's bytes for no effect.
    expect('filter' in derive({ relatedListFilter: {} })[0]).toBe(false);
  });

  it.each([
    ['an array (the ViewFilterRule vocabulary, which this key is not)', [{ field: 'status' }]],
    ['a string', 'status != archived'],
    ['null', null],
    ['a number', 7],
    ['a boolean', true],
  ])('COUNTER-PROBE — %s is refused, not coerced', (_label, value) => {
    // Refusing keeps a malformed value from travelling as though it were
    // authored. Coercing it into "something that works" is what #0.1 calls the
    // second de-facto contract.
    expect('filter' in derive({ relatedListFilter: value as unknown })[0]).toBe(false);
  });

  it('the declared filter rides ALONGSIDE its sibling keys, not instead of them', () => {
    const [list] = derive({
      relatedListFilter: { status: { $ne: 'archived' } },
      relatedListTitle: 'Open Checks',
      relatedListColumns: ['name', 'status'],
      relatedList: 'primary',
    });
    expect(list.filter).toEqual({ status: { $ne: 'archived' } });
    expect(list.title).toBe('Open Checks');
    expect(list.columns).toEqual(['name', 'status']);
    expect(list.isPrimary).toBe(true);
    // The parent-relationship facts the filter may only narrow are untouched.
    expect(list.referenceField).toBe(PARENT);
    expect(list.childObject).toBe('check_item');
  });

  it('an opted-out relationship stays out, filter or no filter', () => {
    expect(derive({ relatedList: false, relatedListFilter: { status: 'open' } })).toEqual([]);
  });
});
