/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tier's half of objectui#6771 — the retired `body` child-list dialect.
 *
 * ## Why this file exists at all
 *
 * The retirement's acceptance evidence was measured on the BUILT CLI, and that
 * reading is about the ZOD tier: `objectui validate` parses through
 * `@object-ui/types`' mirrors, where `body` is an `aliasKeyRefusal`. ⛔ It says
 * NOTHING about `validateTree`, which is a different tier with a different
 * vocabulary — it parses a manifest, never a zod schema, and it is the tier the
 * card was FILED about: the original defect was that `validateTree` answered
 * `unknown-prop` on `body`, the one spelling a dozen registrations resolved.
 *
 * ⇒ a change that moves what this tier says about `body` needs its own pin, or
 * the card's own subject is the one surface with no coverage.
 *
 * ## The two verdicts, and why they are two
 *
 * The ruling's step 4 has two clauses: the tier teaches `children` only, and a
 * `body` child list under a non-container draws the same `not-a-container` the
 * `children` spelling draws. `./body-dialect.ts` answers both by REPLACING the
 * prop walk's diagnostic rather than adding to it — two diagnostics for one
 * mistake is the shape `checkMemberTypes` already refuses (objectui#8067).
 *
 * ## ⚠️ What each row must not be allowed to pass on
 *
 * Every assertion below names a CODE and asserts the message names `children`.
 * The code alone is not enough: the pre-retirement tier already answered
 * `unknown-prop` for `body`, so a row asserting only that code is green in BOTH
 * worlds and measures nothing. What moved is that the answer now carries the
 * remedy, which is the whole reason the replacement exists rather than a bare
 * refusal. And the `children` control beside each row is what keeps "the tier
 * refuses `body`" a reading rather than "this tier refuses everything".
 */
import { describe, expect, it } from 'vitest';
import { RETIRED_CHILD_LIST_KEY, manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, Manifest, SchemaElement } from '../types.js';

/**
 * Two blocks and nothing else: one that accepts children and one that does not.
 * The containment verdict is keyed on the declared `children` slot input —
 * ⛔ not on `isContainer`, since objectui#9910 — so those two are the whole
 * population this rule can distinguish. `box` carries the flag too, as the
 * layout fact it still is; `acceptsChildren` in `../validate.ts` never reads it.
 */
const manifest: Manifest = manifestFromConfigs([
  { type: 'box', namespace: 'ui', isContainer: true, inputs: [{ name: 'className', type: 'string' }, { name: 'children', type: 'slot' }] },
  { type: 'badge', namespace: 'ui', inputs: [{ name: 'label', type: 'string' }] },
  // Declared so the CHILD below resolves: `validateTree` descends `children`,
  // and an undeclared child draws `unknown-component`, which would make the
  // silence controls below assert the wrong absence.
  { type: 'text', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  // Declares `body` as its OWN input — the carve-out this rule must respect.
  { type: 'detail', namespace: 'plugin-detail', inputs: [{ name: 'body', type: 'string' }] },
] as unknown as Parameters<typeof manifestFromConfigs>[0]);

const CHILD = { type: 'text', content: 'measured' };
const diagnose = (node: unknown): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

describe('objectui#6771 — the tier answers the retired `body` with its replacement', () => {
  it('the exported key IS the retired spelling, so the rule and its pin cannot drift', () => {
    expect(RETIRED_CHILD_LIST_KEY).toBe('body');
  });

  it('a `body` child list under a NON-container draws `not-a-container` — the ruling clause, verbatim', () => {
    const found = diagnose({ type: 'badge', body: [CHILD] });
    expect(found.map((d) => d.code)).toContain('not-a-container');
    // The SAME code the live spelling draws — that is what "the same
    // `not-a-container` the `children` spelling draws" means, and a consumer
    // keying on the code cannot tell the two spellings apart.
    expect(diagnose({ type: 'badge', children: [CHILD] }).map((d) => d.code)).toContain('not-a-container');
    // …and only the retired one also names the remedy.
    expect(found.find((d) => d.code === 'not-a-container')!.message).toContain('"children"');
  });

  it('ONE diagnostic, not two — the replacement replaces', () => {
    // ⛔ The failure this guards is the obvious implementation: leave the prop
    // walk's `unknown-prop` in place and ADD a containment branch that reads
    // `body`. That author gets two reports for one mistake.
    const found = diagnose({ type: 'badge', body: [CHILD] });
    expect(found.filter((d) => d.message.includes('"body"'))).toHaveLength(1);
  });

  it('a `body` child list under a CONTAINER draws `unknown-prop` naming `children`', () => {
    const found = diagnose({ type: 'box', body: [CHILD] });
    const own = found.filter((d) => d.message.includes('"body"'));
    expect(own).toHaveLength(1);
    expect(own[0]!.code).toBe('unknown-prop');
    expect(own[0]!.message).toContain('"children"');
    // CONTROL — the live spelling under the same block is silent, so the row
    // above is about the key and not about the block.
    expect(diagnose({ type: 'box', children: [CHILD] })).toHaveLength(0);
  });

  it('a SCALAR `body` is a dead key and nothing more — no containment sentence', () => {
    // The containment wording names a shape; naming it for `body: "hi"` would
    // describe a child list the author did not write.
    const found = diagnose({ type: 'badge', body: 'hi' });
    const own = found.filter((d) => d.message.includes('"body"'));
    expect(own).toHaveLength(1);
    expect(own[0]!.code).toBe('unknown-prop');
    expect(own[0]!.message).toContain('"children"');
  });

  it('⛔ a component that DECLARES its own `body` input is untouched', () => {
    // ⚠️ The fixture below is SYNTHETIC — a manifest is an argument to
    // `validateTree`, so this file can ask what the rule says about any shape.
    // The real component this carve-out exists for is `record:alert`, the one
    // registration in the tree that declares an input named `body` (its value is
    // an inline translation map, not a child list); the extension's own gate
    // names it, and `sdui-parser` needs no list because it asks inside the
    // `!input` branch, deliberately: the claim is about a key nobody declares.
    expect(diagnose({ type: 'detail', body: 'Updated the deal stage.' })).toHaveLength(0);
  });

  it('the tier still teaches `children` ONLY — `body` never became a base prop', () => {
    // The option the ruling REFUSED was adding `body` to `BASE_PROPS`, which
    // would have made it a blessed second spelling forever. If it were there,
    // every row above would be silent.
    expect(diagnose({ type: 'box', body: [CHILD] }).length).toBeGreaterThan(0);
  });
});
