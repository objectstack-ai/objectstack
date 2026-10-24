/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7638 — the `useNavigationOverlay` doc comment must not re-seed the
 * bare `objectName: schema.objectName` call-site spelling.
 *
 * ## Why a source-text pin, which is not this repo's usual instrument
 *
 * The three call sites converted by objectui#7638 are pinned behaviourally, in
 * their own packages, by the URL a real click produces. Nothing pins the
 * PROSE — and the prose is the reason there were three copies to convert. The
 * hook's `@example` block prescribed `objectName: schema.objectName`, so every
 * component author who reached for this hook copied the divergence out of the
 * documentation, correctly, as written. #7627 hit the identical trap.
 *
 * A behavioural test cannot reach a doc comment: it is erased before anything
 * runs. So the guard has to read the source, and that is a deliberate, narrow
 * exception rather than a new habit.
 *
 * ## Why this is not covered by the objectui#7617 gate, despite the card
 *
 * Both card #7638 and its dispatch ruling state that the doc comment is
 * "the exact defect class the gate landed by PR #7617 exists to catch". It is
 * NOT, and this file is where that correction is recorded so the next reader
 * does not go looking for enforcement that was never there.
 *
 * PR #7617 modified `scripts/check-spec-symbol-derivation.mjs`, whose rule 4
 * judges CITATIONS OF `@objectstack/spec` at member granularity — a comment
 * that names `SelectOptionSchema.description` when the spec's own shape has no
 * `description` key. The prose here cites no spec symbol at all; it prescribes
 * a LOCAL call-site spelling. That gate reads this file and finds nothing to
 * say about this comment, which is the correct outcome for that gate and the
 * reason this pin has to exist separately.
 *
 * ## What it asserts, kept deliberately loose
 *
 * Only that the example's `objectName:` argument resolves a record source
 * rather than reading a bare `schema.objectName`. It does not pin wording,
 * ordering, or the surrounding prose — a doc comment that cannot be edited is
 * its own defect.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOOK_SOURCE = readFileSync(
  fileURLToPath(new URL('../useNavigationOverlay.ts', import.meta.url)),
  'utf8',
);

/**
 * The hook's leading JSDoc block — everything up to its `export function`.
 * Scoping to it keeps the pin off the implementation below, where
 * `const { navigation, objectName, ... } = options` legitimately spells the
 * parameter name on its own.
 */
const DOC_BLOCK = HOOK_SOURCE.slice(0, HOOK_SOURCE.indexOf('export function useNavigationOverlay'));

describe('useNavigationOverlay doc comment prescribes the record source (objectui#7638)', () => {
  it('LIT CONTROL: the doc block was actually read and does document this hook', () => {
    // Reads non-zero, or every assertion below is a claim about an empty
    // string: a moved/renamed source file, or a changed `export function`
    // spelling, would otherwise leave this file silently green.
    expect(DOC_BLOCK.length).toBeGreaterThan(200);
    expect(DOC_BLOCK).toContain('useNavigationOverlay({');
    expect(DOC_BLOCK).toContain('objectName:');
  });

  it('does not hand the example a bare `schema.objectName`', () => {
    expect(
      DOC_BLOCK,
      'The @example is what component authors copy. Prescribing the bare ' +
        'top-level key here is what put the same divergence in three ' +
        'components (objectui#7638); the example must resolve the record ' +
        'source instead.',
    ).not.toContain('objectName: schema.objectName');
  });

  it('points the example at the ONE shared record-source reader', () => {
    expect(DOC_BLOCK).toContain('resolveRecordSourceObjectName');
  });

  it('says what a caller with no data config should pass, so rung three is not read as a bug', () => {
    // Not every caller has a data config — `ObjectKanban` has none, and its
    // `schema.objectName` IS its record source. Without this sentence the
    // guidance above reads as "never pass `schema.objectName`", which would be
    // wrong and would send the next author looking for a ladder that is not
    // there.
    expect(DOC_BLOCK).toMatch(/no data config/i);
  });
});
