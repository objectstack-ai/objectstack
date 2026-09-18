// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18651] What `organizations.getActiveMember`'s OWN prose says an anonymous
 * caller gets — pinned against the producer, not against a memory of it.
 *
 * ## The defect this exists to prevent
 *
 * #17881 (`374d9d3afa`) landed `plugin-auth`'s `refuseAnonymousSession`, which
 * converts better-auth's `200` + the literal JSON `null` on
 * `GET /api/v1/auth/get-session` into the declared ADR-0112 refusal envelope —
 * HTTP `401`, `code: UNAUTHENTICATED` — before it leaves the process. Three
 * present-tense statements in and around `getActiveMember` went on describing
 * the retired shape, and they were wrong twice over: the CODE (`UNAUTHORIZED`
 * vs `UNAUTHENTICATED`) and the REQUEST the refusal arrives on (the second,
 * `list-members`, vs the first, `/get-session` itself).
 *
 * That prose SHIPS. `@objectstack/client`'s published `files[]` carries
 * `dist`, and `getActiveMember` is a member of the exported
 * `ObjectStackClient`, so its TSDoc is emitted into the shipped declarations.
 * A reader coding against it writes a `null` branch that can never be taken
 * and omits the `catch` that now fires — which is why a comment here is a
 * published contract statement and gets a pin like any other.
 *
 * ## ⭐ The distinction this pin is built around: NAMING is not TEACHING
 *
 * The repaired prose still contains the words `200`, `null` and
 * `UNAUTHORIZED` — it has to, because it names the retired convention as the
 * thing that was CONVERTED and as the row that was superseded. A crude "does
 * the region mention both 200 and null" filter therefore reads the repaired
 * file as defective. So this pin does not count mentions. It matches the three
 * retired SENTENCES, each of which asserts the retired behaviour in the
 * present tense, and it proves it can see them by running the same matchers
 * over {@link RETIRED_STATEMENTS} — the pre-#18651 text, verbatim.
 *
 * ## ⛔ What this pin does NOT buy
 *
 * It is a sentence-level matcher, so a FOURTH statement that teaches the same
 * retired convention in different words would pass it. Section 3 narrows that
 * gap on the axis the card was about rather than closing it: the region must
 * state today's answer on all three of the axes the statements got wrong —
 * the code, the status, and the request the refusal arrives on. A region that
 * says nothing about the anonymous caller at all fails section 3.
 *
 * The region is located by SYMBOL (`getActiveMember:`), never by line number:
 * the card that filed this defect carried line numbers that were already
 * 15 lines stale by the time it was dispatched.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SDK = fileURLToPath(new URL('./index.ts', import.meta.url));

/**
 * The three statements as they stood BEFORE #18651, verbatim from the source —
 * this file's positive control corpus. ⛔ Not documentation: nothing here
 * describes a runtime that exists. It is here so every matcher below can be
 * shown FIRING, because a matcher that has never fired cannot tell "absent"
 * from "unmatchable" — and this family's own card was nearly buried by exactly
 * that (a grep for `Anonymous -> null` missed the file's Unicode arrow).
 */
const RETIRED_STATEMENTS = [
  '`{ user, session }` envelope for a signed-in caller and the literal',
  '`null` for an anonymous one (measured).',
  'an anonymous caller still gets `401 UNAUTHORIZED`, thrown from the',
  '`list-members` request by the same session middleware that guarded',
  '`get-active-member`;',
  'Anonymous → `null`, and the request below is then refused 401 by the',
  'session middleware before the filter is ever read.',
].join('\n');

/**
 * The docblock + body of the `getActiveMember` DEFINITION, as one string.
 *
 * Anchored on the definition's own spelling (`getActiveMember: async (`) and
 * walked BACKWARDS to the opening `/**` of the docblock attached to it, then
 * forwards to the next sibling member. ⛔ Never anchored on a call site and
 * ⛔ never on a line number.
 */
function getActiveMemberRegion(source: string): string {
  const def = source.indexOf('getActiveMember: async (');
  if (def < 0) throw new Error('getActiveMember definition not found in the SDK source');
  const docStart = source.lastIndexOf('/**', def);
  if (docStart < 0) throw new Error('no docblock precedes the getActiveMember definition');
  // The body ends at the member separator this file uses: a `},` at the
  // definition's own indentation, which is the first one after the throw.
  const end = source.indexOf('\n    },\n', def);
  if (end < 0) throw new Error('could not find the end of the getActiveMember member');
  return source.slice(docStart, end);
}

/** Comment leaders stripped and whitespace collapsed, so a re-wrap cannot hide a sentence. */
function prose(block: string): string {
  return block
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The three retired statements, as matchers over collapsed prose. Each one
 * asserts the retired behaviour in the PRESENT TENSE — which is what makes it
 * a defect rather than a history note.
 */
const RETIRED_MATCHERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['step 1 teaches the retired VALUE', /the literal `null` for an anonymous one/],
  ['the delta list teaches the retired CODE', /an anonymous caller still gets `401 UNAUTHORIZED`/],
  ['the inline comment teaches the retired VALUE and the wrong REQUEST', /Anonymous → `null`, and the request below is then refused 401/],
];

const SOURCE = readFileSync(SDK, 'utf8');
const REGION = prose(getActiveMemberRegion(SOURCE));
const CONTROL = prose(RETIRED_STATEMENTS);

describe('[#18651] organizations.getActiveMember states the anonymous answer the runtime serves', () => {
  describe('1 — the region really is the one under test', () => {
    it('is located by symbol and carries the definition plus its docblock', () => {
      expect(REGION).toContain("Look up the calling user's membership row");
      expect(REGION).toContain('getActiveMember: async (organizationId: string)');
      // The second request is still made — this method is two requests for a
      // signed-in caller, and a region that lost it is not the region.
      expect(REGION).toContain('/organization/list-members');
    });
  });

  describe('2 — the retired statements are gone, and the matchers are shown firing', () => {
    for (const [name, matcher] of RETIRED_MATCHERS) {
      it(`${name}: fires on the pre-#18651 text and does NOT fire on the file`, () => {
        // ⭐ The control FIRST. If this half ever goes quiet the matcher has
        // stopped being able to see the defect, and the half below is then
        // vacuously green — the exact failure this card's instrument note
        // warned about.
        expect(CONTROL, `control corpus no longer matches: ${matcher}`).toMatch(matcher);
        expect(REGION, `retired statement still present: ${matcher}`).not.toMatch(matcher);
      });
    }
  });

  describe('3 — the region states TODAY’s answer on all three axes the statements got wrong', () => {
    it('names the CODE the producer derives', () => {
      expect(CONTROL).not.toContain('UNAUTHENTICATED');
      expect(REGION).toContain('UNAUTHENTICATED');
    });

    it('names the STATUS the producer answers', () => {
      expect(REGION).toMatch(/`401`|httpStatus: 401/);
    });

    it('names the REQUEST the refusal arrives on, and says the second one is not reached', () => {
      // The whole second half of the defect: the refusal is on request ONE.
      expect(REGION).toMatch(/`\/get-session`[^.]*(?:401|ADR-0112|envelope)/);
      expect(REGION).toMatch(/never reaches the wire|is TERMINAL|never asked|never reaches this line/);
    });

    it('anchors the claim to the producer rather than restamping a drive', () => {
      // `refuseAnonymousSession` / #17881 is the thing that made it true; the
      // 2026-09-09 drive predates it and was NOT re-run.
      expect(REGION).toContain('#17881');
      expect(REGION).toContain('refuseAnonymousSession');
    });
  });
});
