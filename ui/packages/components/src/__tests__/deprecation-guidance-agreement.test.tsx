/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A deprecated type's migration guidance is stated TWICE, and this file is the
 * only thing holding the two statements together (objectui#6823).
 *
 * 1. the human-facing console notice — `DIV_DEPRECATION_NOTICE` /
 *    `SPAN_DEPRECATION_NOTICE`, string literals inside the renderers, and
 * 2. the machine-readable `deprecated.replacement` on the same file's
 *    registration, which objectui#6674 added so a gate can tell an author what
 *    to write instead.
 *
 * Both say the same thing today, in different words, because the second was
 * transcribed from the first by hand. Nothing asserted they still agree, so a
 * reword of either left the other stale — and the stale one is the copy an
 * automated gate reads and repeats to authors, at a scale no console notice
 * reaches. This is the shape objectui#4580 ruled about and objectui#6067 /
 * #5671 / #5893 executed three times since; the unit here is a sentence rather
 * than a type, and unlike those it fails SILENTLY, because there is no `tsc` to
 * notice a string literal drifting away from another string literal.
 *
 * ## Why this ASSERTS the agreement instead of deriving one text from the other
 *
 * Deriving the notice's guidance line from the declaration is the direction
 * that class of ruling usually takes, and triage weighed it here and ruled
 * against it (2026-08-29, on objectui#6823). Those precedents were about TYPES,
 * enforced by `tsc`, with no competing ruling on their wording. This sentence
 * is pinned BYTE-FOR-BYTE by four existing tests —
 * `div-deprecation-provenance`, `div-deprecation-warn-once`,
 * `span-deprecation-provenance`, `span-deprecation-warn-once` — and those pins
 * are themselves a deliberate maintainer ruling: objectui#4000 records that the
 * guidance is "byte-for-byte what it was." Converging the two statements means
 * MOVING those pins, i.e. trading one ruled invariant for another, which is a
 * judged change of its own and not a rider on a drift-prevention card.
 *
 * The assertion below buys the whole drift protection without touching
 * objectui#4000 at all.
 *
 * ## What is compared, and why it is EXTRACTED rather than restated
 *
 * Restating either text here would be a THIRD copy of the sentence — the very
 * defect, one layer up, and the point at which this file would have to stop and
 * escalate instead. So nothing below spells out any guidance text. Both
 * statements are reduced, mechanically, to the thing they are both about: the
 * set of component type names offered as the replacement, read out of each text
 * as its double-quoted runs. That convention is one both texts already follow —
 * a replacement type is named in double quotes on both sides — and it is the
 * half that has to agree: prose framing may differ (the notice explains WHEN to
 * reach for each, the declaration is one line for a gate to repeat), the
 * alternatives on offer may not.
 *
 * Set equality, not containment, and that is deliberate: containment one way
 * catches a name added to the declaration but not the notice, and misses the
 * reverse. Drift has no preferred direction, so both directions are asserted at
 * once.
 *
 * ## Scope — the notice's SCOPE sentence is deliberately not read here
 *
 * The `surfaces` / `isHtmlTierNode` half is already pinned to itself by
 * objectui#6674, in the two provenance tests. Extraction below is confined to
 * the notice's guidance BULLETS, so this file cannot start failing because that
 * sentence was reworded — the bullets are what `deprecated.replacement`
 * restates, and their layout is itself part of what objectui#4000's four pins
 * hold in place.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/**
 * The component type names a piece of guidance offers: its double-quoted runs.
 *
 * Deliberately not a list of names kept here. A hard-coded list would be the
 * third copy this file exists to avoid, and would go stale in exactly the way
 * the two statements it compares can.
 */
function offeredTypeNames(guidance: string): Set<string> {
  return new Set([...guidance.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/**
 * The notice's migration guidance: its bullet lines, and only those.
 *
 * Everything else in the notice — the header naming the type, the SCOPE
 * sentence objectui#6674 already pins elsewhere, the docs link — is out of
 * scope for this comparison, and reading past the bullets is how this file
 * would acquire a coupling to text that is not its business.
 */
function guidanceBullets(notice: string): string {
  return notice
    .split('\n')
    .filter((line) => line.trimStart().startsWith('- '))
    .join('\n');
}

/**
 * Render one JSON-authored node of `type` and return the deprecation notices it
 * emitted.
 *
 * The notice literal is module-private, as it should be — exporting it to test
 * it would widen the package's surface for a test's convenience. It is read the
 * way every reader reads it: off the console. The warn-once guard
 * (objectui#3965) is a module-level Set per renderer module, so each type may be
 * rendered in exactly one case of this file; the count assertion in each case is
 * what would catch that rule being broken later.
 */
function deprecationNoticesFor(type: string): string[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const Component = ComponentRegistry.get(type);
  if (!Component) throw new Error(`Component "${type}" is not registered`);
  render(<Component schema={{ type }} />);
  const deprecation = new RegExp(`The "${type}" component is deprecated`);
  return warn.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((message) => deprecation.test(message));
}

/**
 * One case's body, shared so both renderers are held to the identical check and
 * a third deprecated type joins them in one line rather than by transcription —
 * which is the failure mode this whole file is about.
 */
function expectGuidanceAndDeclarationAgree(type: string): void {
  const notices = deprecationNoticesFor(type);
  // Control FIRST: an agreement between two texts proves nothing if one of them
  // was never produced. Zero notices (a renderer that stopped warning, a type
  // that stopped resolving) would otherwise read as a pass on empty sets.
  expect(notices).toHaveLength(1);

  const bullets = guidanceBullets(notices[0]);
  // Control: the notice really carries bullet guidance. A reflow that dissolves
  // the bullets is a reword of the guidance, and it has to come back through
  // here rather than silently emptying the comparison.
  expect(bullets).not.toBe('');

  const declared = ComponentRegistry.deprecationFor(type, 'json')?.replacement;
  // Control: the declaration objectui#6674 added is still there and still says
  // something. Without this, deleting `replacement` would turn this case green.
  expect(declared).toBeTruthy();

  const fromDeclaration = offeredTypeNames(declared as string);
  // Control: the comparison is not vacuous. Guidance rewritten without quoted
  // names on the declaration side would otherwise satisfy an empty-vs-empty
  // equality while saying nothing at all.
  expect(fromDeclaration.size).toBeGreaterThan(0);

  const fromNotice = offeredTypeNames(bullets);

  // The whole point: the alternatives the human is offered and the alternatives
  // a gate would repeat are the same set. Reword either side's list — add,
  // drop or rename one — and this goes red.
  expect([...fromNotice].sort()).toEqual([...fromDeclaration].sort());
}

describe('deprecation guidance — the console notice and `deprecated.replacement` agree (#6823)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('div: the notice offers exactly the alternatives the declaration names', () => {
    expectGuidanceAndDeclarationAgree('div');
  });

  it('span: the notice offers exactly the alternatives the declaration names', () => {
    expectGuidanceAndDeclarationAgree('span');
  });
});
