// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13390] The name-keyed collection set is DERIVED, and this is what makes the
 * derivation load-bearing rather than decorative.
 *
 * ## What was wrong with the list
 *
 * The set of collections a per-write snapshot carries was written down in five
 * places. `NAME_KEYED_STACK_KEYS` was the one with no guard of any kind, and it
 * carries a real invariant: a collection the CONTEXT fills **and** that some
 * write type maps into must be name-keyed, or a finding's `path` is a positional
 * index into an in-memory snapshot the caller has never seen and cannot
 * enumerate — the #10064 defect. Adding `pages` (#13216) had to touch all five
 * and only one announced itself. Omitting this one produced correct-LOOKING
 * findings and no test, type or gate went red.
 *
 * ## What this file pins, and why in this shape
 *
 * The four keys that exist today agree with the list they replaced. That shows
 * the answer is right, and cannot show the derivation is the REASON — the whole
 * value of this card is about the NEXT widening. So every claim here is made
 * one of two ways:
 *
 * - against the module's own inputs (`WRITTEN_STACK_KEYS` and the context set
 *   read back out of a real snapshot), never against a restated list — a test
 *   that hand-listed the members would be a sixth spelling of the same set;
 * - on SYNTHETIC inputs through the exported pure builders, which is the only
 *   way to exercise a widening that has not happened, and the only way to
 *   exercise the two hazards a derived regex has and a literal did not.
 */

import { describe, expect, it } from 'vitest';

import {
  WRITTEN_STACK_KEYS,
  buildRuntimeWriteSnapshots,
  buildTopLevelIndexPattern,
  deriveNameKeyedStackKeys,
  nameKeyFindingPath,
} from './runtime-gate.js';

/**
 * The context set, read back from a REAL snapshot rather than imported as a
 * constant: `buildRuntimeWriteSnapshots` gives the baseline one key per context
 * collection, so this is the set the gate actually carries, not a claim about it.
 */
const contextStackKeys = Object.keys(
  buildRuntimeWriteSnapshots({ type: 'object', item: { name: 'probe_object' } })!.baseline,
);

describe('the derived name-keyed set (#13390)', () => {
  it('reproduces exactly the membership the hand list carried — four, in the same order', () => {
    expect(deriveNameKeyedStackKeys(contextStackKeys, WRITTEN_STACK_KEYS)).toEqual([
      'objects',
      'permissions',
      'books',
      'pages',
    ]);
  });

  it('excludes `datasets` by derivation, not by a written-down exception', () => {
    // The old comment had to STATE this. Now it falls out: the context fills
    // `datasets`, and no write type lands an item in it, so a `datasets[0]`
    // path is not a position in anything the caller cannot enumerate.
    expect(contextStackKeys).toContain('datasets');
    expect(WRITTEN_STACK_KEYS.has('datasets')).toBe(false);
  });

  it.each(contextStackKeys)(
    '%s is name-keyed exactly when a write type maps into it',
    (key) => {
      // The invariant end to end, asked per context collection against the same
      // table the gate consults. A hand-kept list that forgot a member — the
      // #13216 near-miss — fails here; so does one that name-keys a
      // context-only collection.
      const candidate = { [key]: [{ name: 'acme_thing' }] };
      const rewritten = nameKeyFindingPath(`${key}[0].sharingModel`, candidate);

      expect(rewritten).toBe(
        WRITTEN_STACK_KEYS.has(key)
          ? `${key}.acme_thing.sharingModel`
          : `${key}[0].sharingModel`,
      );
    },
  );

  it('takes the context order, so a write-table reordering cannot move it', () => {
    expect(deriveNameKeyedStackKeys(['c', 'b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('a write type mapping onto a NON-context key contributes nothing', () => {
    // `flow` -> `flows` is a real mapping onto a collection the context never
    // fills; `flows[0]` IS the write, trivially stable, and must stay positional.
    expect(deriveNameKeyedStackKeys(['objects'], ['objects', 'flows'])).toEqual(['objects']);
    expect(nameKeyFindingPath('flows[0].name', { flows: [{ name: 'acme_flow' }] })).toBe(
      'flows[0].name',
    );
  });

  it('the next widening cannot half-land', () => {
    // The acceptance criterion, stated synthetically because the real widening
    // has not happened yet: adding a context collection that a write type maps
    // into name-keys it and joins the pattern, with no second edit to forget.
    const widenedContext = [...contextStackKeys, 'reports'];
    const widenedWrites = new Set([...WRITTEN_STACK_KEYS, 'reports']);

    const derived = deriveNameKeyedStackKeys(widenedContext, widenedWrites);
    expect(derived).toContain('reports');
    expect(buildTopLevelIndexPattern(derived).exec('reports[7].title')?.[1]).toBe('reports');
  });
});

describe('the derived top-level index pattern (#13390)', () => {
  it('rebuilds the literal it replaced, source for source', () => {
    // Constructive preservation, byte for byte: same members, same order, so
    // the derived pattern and the hand-written one are the same regex.
    expect(buildTopLevelIndexPattern(['objects', 'permissions', 'books', 'pages']).source).toBe(
      /^(objects|permissions|books|pages)\[(\d+)\](.*)$/.source,
    );
  });

  it('escapes members instead of trusting them to be `[a-z]+`', () => {
    const re = buildTopLevelIndexPattern(['a.c']);
    expect(re.test('a.c[0].x')).toBe(true);
    // An unescaped `.` matches any character — the silent-widening direction.
    expect(re.test('abc[0].x')).toBe(false);
  });

  it.each([
    ['short branch first', ['page', 'pages']],
    ['long branch first', ['pages', 'page']],
  ])('resolves a prefix pair regardless of order (%s)', (_label, keys) => {
    // Alternation IS ordered, so `page|pages` reads as though it shadows
    // `pages`. The `\[` anchor fails the short branch and forces a backtrack
    // into the long one — measured here in both orders, which is why the
    // builder does not carry a longest-first sort it would never exercise.
    const re = buildTopLevelIndexPattern(keys);
    expect(re.exec('pages[3].x')?.[1]).toBe('pages');
    expect(re.exec('page[3].x')?.[1]).toBe('page');
  });

  it('an empty set matches nothing, rather than every top-level index', () => {
    const re = buildTopLevelIndexPattern([]);
    expect(re.test('objects[0].x')).toBe(false);
    expect(re.test('[0].x')).toBe(false);
  });
});
