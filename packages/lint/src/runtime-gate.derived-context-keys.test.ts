// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13977] `CONTEXT_STACK_KEYS` is derived from `RuntimeStackContext`, and the
 * ORDER it derives is load-bearing. This file pins the half a type cannot.
 *
 * ## The split, stated once
 *
 * COMPLETENESS — every context collection has an entry — is held by the
 * compiler and belongs there: the keyed record the set derives from is typed
 * `{ [K in keyof RuntimeStackContext]-?: true }`, so a collection added to the
 * interface without a row is a type error naming that collection, in
 * `runtime-gate.ts`, at `tsc --noEmit` and at the DTS build. ⛔ It is
 * deliberately NOT restated here as a runtime assertion: this package's
 * `tsconfig.json` excludes `**\/*.test.ts`, so no tsc program compiles this
 * file and a type-level witness written here would evaluate never — a phantom
 * check that deletes clean. The guard's own failure was measured instead, on
 * the card, by adding a collection and reading the build.
 *
 * ORDER is what a test can hold, and the derivation had to be chosen so as not
 * to break it — a mapped type does not guarantee declaration order. The order
 * reaches two consumers, one of which is measured here and one of which
 * `runtime-gate.derived-name-keys.test.ts` already covers:
 *
 * - the snapshot's own key order (`Object.keys(baseline)`), which that file
 *   reads back as a VALUE and asserts through an ordered `toEqual`;
 * - `TOP_LEVEL_INDEX`'s alternation, whose `source` #13390 keeps byte-identical
 *   to the literal it replaced.
 *
 * ## Why the pre-existing ordered pin is not enough
 *
 * It asserts the order of the NAME-KEYED subset, which drops `datasets` (no
 * write type maps into it). So swapping `datasets` with either neighbour left
 * it green while genuinely reordering the set the snapshot is built from. The
 * first test below closes exactly that gap, and is the reason ordering could be
 * reported as load-bearing rather than assumed either way.
 */

import { describe, expect, it } from 'vitest';

import { buildRuntimeWriteSnapshots } from './runtime-gate.js';

/**
 * The set as the GATE carries it, never as a constant re-imported or restated:
 * `buildRuntimeWriteSnapshots` gives the baseline one key per context
 * collection, in the order the derivation yields.
 */
const carriedStackKeys = () =>
  Object.keys(buildRuntimeWriteSnapshots({ type: 'object', item: { name: 'probe_object' } })!.baseline);

describe('the derived context-collection set (#13977)', () => {
  it('carries every context collection, in the declared stack-key order', () => {
    // The whole set, in order — including `datasets`, which the name-keyed pin
    // filters out and therefore cannot hold in position. A reordering of the
    // record `CONTEXT_STACK_KEYS` derives from lands here first.
    expect(carriedStackKeys()).toEqual(['objects', 'permissions', 'books', 'datasets', 'pages']);
  });

  it('derives the same set whatever the write is, since the write does not choose it', () => {
    // A write into a context collection replaces its stored self and a write
    // outside them adds its own collection — neither may change WHICH context
    // collections are carried, or the gate would judge different universes for
    // different write types.
    const forNonContextWrite = Object.keys(
      buildRuntimeWriteSnapshots({ type: 'flow', item: { name: 'probe_flow' } })!.baseline,
    );

    expect(forNonContextWrite).toEqual(carriedStackKeys());
  });

  it('carries a collection the host never passed, rather than omitting the key', () => {
    // Completeness has a runtime half after all: the loop writes every derived
    // key unconditionally, so an absent context yields empty collections and a
    // rule resolving into one reads "empty universe" from a key that EXISTS.
    // (`runtime-gate.test.ts` pins the same shape against the whole set; this
    // states why the loop may not skip a missing collection.)
    const baseline = buildRuntimeWriteSnapshots({ type: 'book', item: { name: 'b1' } })!.baseline;

    for (const key of carriedStackKeys()) {
      expect(baseline).toHaveProperty(key);
      expect(baseline[key]).toEqual([]);
    }
  });

  it('every carried collection is one the interface declares — validity, still', () => {
    // The half the old `satisfies` clause DID hold, kept measurable now that the
    // clause is gone: the derived keys are the record's keys, and the record is
    // pinned to `keyof RuntimeStackContext`. Asserted against the context the
    // gate accepts, so an entry naming a collection the host cannot pass fails.
    const context = {
      objects: [{ name: 'acme_thing' }],
      permissions: [{ name: 'sales' }],
      books: [{ name: 'handbook' }],
      datasets: [{ name: 'revenue' }],
      pages: [{ name: 'home' }],
    };
    const baseline = buildRuntimeWriteSnapshots({ type: 'flow', item: { name: 'f1' }, context })!.baseline;

    for (const key of carriedStackKeys()) {
      expect(context).toHaveProperty(key);
      expect(baseline[key]).toEqual(context[key as keyof typeof context]);
    }
  });
});
