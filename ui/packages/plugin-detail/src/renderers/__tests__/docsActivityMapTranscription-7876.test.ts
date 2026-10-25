/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The docs transcription pin for `ACTIVITY_TYPE_TO_FEED_TYPE` (objectui#7876).
 *
 * `content/docs/plugins/plugin-detail.mdx` restates the map in prose so readers
 * can see the mapping without opening the source. Nothing read that sentence:
 * `check:doc-types` reads documented component type literals, `check:doc-snippets`
 * reads fenced code blocks, and `check:doc-fences` / `docs:check-links` /
 * `check:docs-route-closure` read fence languages, links and routes. None of them
 * reads a sentence, which is how objectui#6932 (PR objectui#7871) found two
 * `record:activity` statements on this page that were true when written and false
 * on `main`. This pin closes the mechanically checkable half: the transcription is
 * DERIVED from the map here, never hand-copied, so moving a type in the map
 * without moving it on the page turns this red.
 *
 * ## ⚠️ The bound, stated rather than sold past
 *
 * This covers the MAP TRANSCRIPTION and nothing else. It does NOT cover the free
 * prose around it — sentences like "a row whose type is in neither list is not
 * dropped", which is the class objectui#6932 actually corrected. Those statements
 * remain ungated, and objectui#7876 says so in its own words: option A "is worth
 * doing because the map is mechanically checkable; it should not be sold as
 * closing the whole gap." ⛔ Do not read a green run here as "the page agrees with
 * the code"; read it as "the page's mapping paragraph agrees with the map".
 *
 * ## ⛔ Not the pin `recordActivityFeed.test.ts` forbids — a different object
 *
 * That file's `PLATFORM_BUILTIN_ACTIVITY_TYPES` docblock says: "Do not derive this
 * list from `ACTIVITY_TYPE_TO_FEED_TYPE`. A pin that reads its expectation out of
 * the thing it is pinning cannot fail." That ban is about the PLATFORM-DECLARED
 * vocabulary, which lives upstream (`@objectstack/plugin-audit`) and is transcribed
 * by hand into that file — deriving it from the map would compare the map with
 * itself. The object here is a DIFFERENT one: prose on a `.mdx` page, authored
 * independently of the map, which is exactly what a derived expectation is for.
 * Deriving from the map is what objectui#7876's ruling A asks for.
 *
 * Its neighbour `feedTypeProducerCensus-5877.test.ts` names this same `.mdx` in
 * order to declare it OUT of the producer census ("a documentation example
 * produces nothing at runtime"). This is the pin that does read it; the two do not
 * overlap. The `repoRoot` resolution below is that file's, reused rather than
 * re-invented.
 *
 * ⛔ The map is read from `../recordActivityFeed`, never from app-shell's
 * `activityItemType.ts` — that is a second, separate mapping for the
 * `ActivityItem` surface, and the census test excludes it for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_TYPE_TO_FEED_TYPE } from '../recordActivityFeed';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-detail/src/renderers/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../../..');
const PAGE = path.join(repoRoot, 'content', 'docs', 'plugins', 'plugin-detail.mdx');

/**
 * The paragraph is located by its OPENING SENTENCE, never by line number.
 *
 * A line number goes stale silently the first time anything above it moves, and a
 * stale slice reads whatever prose now sits there — a pin that passes vacuously.
 * An anchor that stops matching is a page restructure, and this file fails loudly
 * saying so instead of quietly checking nothing.
 */
const ANCHOR = '`sys_activity` rows map to feed items like this:';

/** `sys_*` in backticks is an ObjectStack OBJECT name, not an activity type. */
const OBJECT_NAME = /^sys_/;

/** One `` `a` / `b` → `feed_type` `` clause of the transcription. */
const ARROW_CLAUSE = /((?:`[a-z_]+`(?:\s*\/\s*)?)+)\s*→\s*`([a-z_]+)`/g;

const BACKTICKED = /`([a-z_]+)`/g;

interface Transcription {
  /** The paragraph's lines, as found on the page. */
  lines: string[];
  /** activity type -> the feed type the PROSE gives it. */
  pairs: Map<string, string>;
  /** Activity types the prose names WITHOUT putting them under a feed type. */
  namedWithoutFeedType: Set<string>;
  /** How many lines carried the anchor (must be exactly 1). */
  anchorHits: number;
}

function readTranscription(): Transcription {
  if (!existsSync(PAGE)) {
    throw new Error(
      `objectui#7876: the documented page is gone from disk: ${PAGE}. ` +
        `If the page moved, move this pin's path with it; do not delete the pin.`,
    );
  }
  const fileLines = readFileSync(PAGE, 'utf8').split('\n');
  const anchorAt = fileLines.flatMap((line, i) => (line.includes(ANCHOR) ? [i] : []));
  if (anchorAt.length !== 1) {
    throw new Error(
      `objectui#7876: expected exactly ONE line on ${path.relative(repoRoot, PAGE)} carrying the ` +
        `transcription anchor ${JSON.stringify(ANCHOR)}, found ${anchorAt.length}. ` +
        `The mapping paragraph was restructured or renamed: re-anchor this pin on its new ` +
        `opening sentence. Failing here is deliberate — a missing anchor must never be read ` +
        `as "the transcription is fine".`,
    );
  }

  // The paragraph is the contiguous block from the anchor to the next blank line.
  // Stopping there is what keeps LATER prose out: `:239` names
  // `ACTIVITY_TYPE_TO_FEED_TYPE` and a paragraph further down re-lists the four
  // non-activity types, and neither of those is the transcription.
  const lines: string[] = [];
  for (let i = anchorAt[0]; i < fileLines.length && fileLines[i].trim() !== ''; i += 1) {
    lines.push(fileLines[i]);
  }

  const pairs = new Map<string, string>();
  const remainder = lines
    .join(' ')
    .replace(ARROW_CLAUSE, (_match, lhs: string, feedType: string) => {
      for (const [, activityType] of lhs.matchAll(BACKTICKED)) pairs.set(activityType, feedType);
      return ' ';
    });

  const namedWithoutFeedType = new Set<string>();
  for (const [, identifier] of remainder.matchAll(BACKTICKED)) {
    if (!OBJECT_NAME.test(identifier)) namedWithoutFeedType.add(identifier);
  }

  return { lines, pairs, namedWithoutFeedType, anchorHits: anchorAt.length };
}

const mappedKeys = Object.keys(ACTIVITY_TYPE_TO_FEED_TYPE).filter(
  (key) => ACTIVITY_TYPE_TO_FEED_TYPE[key] !== undefined,
);
const skippedKeys = Object.keys(ACTIVITY_TYPE_TO_FEED_TYPE).filter(
  (key) => ACTIVITY_TYPE_TO_FEED_TYPE[key] === undefined,
);

describe('docs transcription of ACTIVITY_TYPE_TO_FEED_TYPE (objectui#7876)', () => {
  /**
   * NON-VACUITY, the source side. Both halves of the assertion below need a
   * subject: if the map ever had no mapped keys, or no `undefined` keys, the two
   * direction tests would pass over empty sets and prove nothing.
   */
  it('has something to check on both sides of the map', () => {
    expect({ mapped: mappedKeys.length > 0, skipped: skippedKeys.length > 0 }).toEqual({
      mapped: true,
      skipped: true,
    });
  });

  /**
   * NON-VACUITY, the page side, plus the anchor's own liveness: the paragraph was
   * found exactly once and it actually names types in both shapes.
   */
  it('finds the mapping paragraph and reads types out of it', () => {
    const { lines, pairs, namedWithoutFeedType, anchorHits } = readTranscription();
    expect({
      anchorHits,
      paragraphLines: lines.length > 1,
      typesUnderAFeedType: pairs.size > 0,
      typesNamedWithoutOne: namedWithoutFeedType.size > 0,
    }).toEqual({
      anchorHits: 1,
      paragraphLines: true,
      typesUnderAFeedType: true,
      typesNamedWithoutOne: true,
    });
  });

  /**
   * The slice stops at the paragraph. `ACTIVITY_TYPE_TO_FEED_TYPE` is named in
   * prose further down the page (the "give it one by adding the type to …"
   * sentence); if that text is inside the slice, the reader ran past the blank
   * line and is checking the wrong prose.
   */
  it('reads the transcription paragraph only, not the prose below it', () => {
    const { lines } = readTranscription();
    expect(lines.join(' ')).not.toContain('ACTIVITY_TYPE_TO_FEED_TYPE');
  });

  /**
   * DIRECTION 1 — every key the map gives a feed type appears in the paragraph
   * under THAT feed type. Expectation derived from the map; a missing key reads as
   * `undefined` here and names itself in the diff.
   */
  it('lists every mapped activity type under the feed type the map gives it', () => {
    const { pairs } = readTranscription();
    const fromTheMap = Object.fromEntries(mappedKeys.map((key) => [key, ACTIVITY_TYPE_TO_FEED_TYPE[key]]));
    const fromThePage = Object.fromEntries(mappedKeys.map((key) => [key, pairs.get(key)]));
    expect(fromThePage).toEqual(fromTheMap);
  });

  /**
   * DIRECTION 1, the other half — every `undefined` key is NAMED in the paragraph
   * (as skipped / not record activity) and is NOT listed under any feed type.
   * Naming them is the point: a reader who cannot find `login` on the page cannot
   * tell "deliberately excluded" from "nobody has mapped it yet".
   */
  it('names every non-mapped activity type without putting it under a feed type', () => {
    const { pairs, namedWithoutFeedType } = readTranscription();
    const fromThePage = Object.fromEntries(
      skippedKeys.map((key) => [
        key,
        { named: namedWithoutFeedType.has(key), underFeedType: pairs.get(key) },
      ]),
    );
    const expected = Object.fromEntries(
      skippedKeys.map((key) => [key, { named: true, underFeedType: undefined }]),
    );
    expect(fromThePage).toEqual(expected);
  });

  /**
   * DIRECTION 2 — every activity type the paragraph names is a key of the map. A
   * type deleted from the map but left on the page fails here.
   *
   * ⚠️ Bound: this reads types the prose spells in `backticks`, which is how the
   * page spells every one of them today. A type added to the prose in bare words
   * would escape this direction (direction 1 still covers deletions and moves).
   */
  it('names no activity type the map does not declare', () => {
    const { pairs, namedWithoutFeedType } = readTranscription();
    const named = [...new Set([...pairs.keys(), ...namedWithoutFeedType])].sort();
    const undeclared = named.filter((type) => !(type in ACTIVITY_TYPE_TO_FEED_TYPE));
    expect({ undeclared, checked: named.length > 0 }).toEqual({ undeclared: [], checked: true });
  });
});
