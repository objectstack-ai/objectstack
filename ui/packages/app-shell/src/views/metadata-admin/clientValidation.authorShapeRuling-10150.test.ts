// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10150 — the `AUTHOR_SHAPE_ONLY_TYPES` header carries the ruling that
 * keeps `sharing_rule` in the set, at the place its reader meets the condition.
 *
 * ## The trap this keeps shut
 *
 * The header in `clientValidation.ts` used to end on a plan: switch the
 * `sharing_rule` edit gate on once the `_diagnostics` ingress is closed. The
 * ingress was closed (objectui#7603, hoisted by objectui#8181), the switch was
 * put to the maintainer on objectui#7612 with that already measured, and the
 * ruling was option A: the edit door stays with the server. A header that still
 * reads as the plan sends its next reader, who checks the condition and finds
 * it met, straight back to re-filing objectui#7612.
 *
 * ## What this pins
 *
 * NAMED SUBJECTS inside ONE docblock, the one directly above the set: the
 * ruling's card, and the function that closed the ingress. Inside that docblock
 * and not merely somewhere in the file, because a citation moved to another
 * comment is one the reader of the condition never meets.
 *
 * ## What it cannot pin, said here so it is not assumed
 *
 * - ⛔ Not the ruling's wording. The header quotes it verbatim; nothing parses
 *   that quotation, so it is not pinned as text.
 * - ⛔ Not prose intent. A header that cites objectui#7612 AND re-states the
 *   old plan passes here. Catching that is review's job.
 * - ⛔ Not whether the ingress is still closed. That is behaviour, and
 *   `ResourceEditPage.readDecorationStrip.test.tsx` is its instrument.
 *
 * The first case is the lit CONTROL. The same reader finds the measurement the
 * header must keep, and finds it only between the docblock's own bounds, so an
 * empty or misplaced read cannot let the second case pass as a scan of nothing.
 *
 * If a later ruling takes `sharing_rule` out of the set, the header changes in
 * that pull request, and this file changes with it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(here, 'clientValidation.ts'), 'utf8');

/** The declaration the header documents. */
const ANCHOR = '\nconst AUTHOR_SHAPE_ONLY_TYPES = ';

/**
 * The docblock that ends directly above `ANCHOR`. A lookup, not a comment mask:
 * nothing is removed from the source, the block is only located. Answers '' when
 * the declaration is gone or is not directly preceded by a docblock, which every
 * case below reads as a failure.
 */
function headerAboveSet(src: string): string {
  const at = src.indexOf(ANCHOR);
  if (at < 0) return '';
  const before = src.slice(0, at);
  const close = before.lastIndexOf('*/');
  if (close < 0 || before.slice(close + 2).trim() !== '') return '';
  const open = before.lastIndexOf('/**', close);
  return open < 0 ? '' : before.slice(open, close + 2);
}

const HEADER = headerAboveSet(SOURCE);

describe('objectui#10150 — the AUTHOR_SHAPE_ONLY_TYPES header records the objectui#7612 ruling', () => {
  it('CONTROL — the reader returns that header, bounded, and it still carries the measurement', () => {
    expect(HEADER, 'no docblock directly above `const AUTHOR_SHAPE_ONLY_TYPES`').not.toBe('');

    // The measurement is why the type was listed, and the card that added the
    // ruling kept it on purpose: the envelope family, the read decoration, and
    // the inversion both would cause.
    for (const subject of ['ADR-0010', '_diagnostics', 'objectstack#5316']) {
      expect(HEADER, `the header no longer names ${subject}`).toContain(subject);
    }

    // Bounded on both sides: the code just above the docblock and the comment
    // just below the set are in the file, and neither is in what was read.
    for (const outside of ['function expandViewIssues', 'Map metadata-type name']) {
      expect(SOURCE).toContain(outside);
      expect(HEADER).not.toContain(outside);
    }
  });

  it('cites the ruling and the closed ingress by name, in the header itself', () => {
    for (const subject of ['the 2026-09-20 ruling', 'extractDraftBody']) {
      expect(
        HEADER,
        `the header above AUTHOR_SHAPE_ONLY_TYPES must name ${subject}: the ` +
          '`_diagnostics` ingress it describes was closed, the edit-door switch ' +
          'was put to the maintainer on objectui#7612, and the ruling kept that ' +
          'door with the server. Without it the header reads as a plan whose ' +
          'condition is met (objectui#10150).',
      ).toContain(subject);
    }
  });
});
