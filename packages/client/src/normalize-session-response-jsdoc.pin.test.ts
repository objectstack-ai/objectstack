// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18510] `normalizeSessionResponse`'s JSDoc must not cite a CLOSED card as if
 * it were still being tracked.
 *
 * That block's job is to say what the lift compensates for, so it names the
 * cards that opened and closed each compensation. A card cited beside a phrase
 * like "tracked separately" reads to the next person as 「still open, go look」
 * — and the moment the card closes, the sentence is false while still reading
 * present-tense. #18510 is exactly that: `data.user.image` was described as a
 * live gap against a declared `string | undefined` with `#17235` marked
 * "tracked separately", and PR #18501 both widened the declaration to
 * `z.string().nullish()` and closed #17235.
 *
 * ⛔ This is NOT a pin on the block's wording. It pins one relation: for each
 * card on `CLOSED_CARDS`, the block may cite it (past tense is the point of
 * citing it at all) but may NOT carry an `OPEN_TRACKING_PHRASES` entry beside
 * that citation. A future card that really is open can be tracked here in
 * those words; a closed one cannot. Closing a card therefore has a mechanical
 * consequence in this file — add its row and this suite says which sentence
 * has to move.
 *
 * Three cases, because two of them exist to keep the third honest:
 *
 * - `① the locator` — the extractor finds THIS block and discriminates. A
 *   locator that silently returned `''` would make ② pass while measuring
 *   nothing, so ① asserts the block's own anchors are present AND that a
 *   symbol which does not exist yields no block.
 * - `② the pin` — the relation above, on the real source. Red before #18510's
 *   fix, green after.
 * - `③ the instrument can still fail` — the same predicate over the sentence
 *   as it stood before the fix, copied verbatim. Without it a green ② could
 *   equally mean the predicate stopped looking.
 *
 * ⭐ Located BY SYMBOL, never by line number — the card that filed this carried
 * `:1514-1517`, which had already drifted by the time it was dispatched.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The JSDoc block immediately above `const <symbol> = (`, located by symbol.
 * Returns `''` when either the declaration or a block above it is absent —
 * case ① is what stops that empty answer from reading as a pass.
 */
const jsdocAboveConst = (src: string, symbol: string): string => {
  const decl = src.indexOf(`\nconst ${symbol} = (`);
  if (decl === -1) return '';
  const close = src.lastIndexOf('*/', decl);
  if (close === -1) return '';
  const open = src.lastIndexOf('/**', close);
  if (open === -1) return '';
  return src.slice(open, close + 2);
};

/**
 * Cards this block cites that are CLOSED. Each row is a reading, with the
 * state that was read — a row is added when a card closes, not when someone
 * guesses it has.
 */
const CLOSED_CARDS: ReadonlyArray<readonly [string, string]> = [
  ['#17234', 'closed/completed 2026-09-13T05:55:30Z'],
  ['#17235', 'closed/completed 2026-09-16T17:44:08Z — PR #18501'],
  ['#17238', 'closed/completed 2026-09-12T19:42:55Z'],
  ['#17881', 'landed 2026-09-12T19:42:54Z'],
];

/** Phrases that make a card citation beside them read as "still open". */
const OPEN_TRACKING_PHRASES: readonly string[] = [
  'tracked separately',
  'tracked elsewhere',
  'still open',
  'still tracked',
  'not yet fixed',
  'open card',
];

/**
 * How near a phrase has to be to count as describing that citation. Generous
 * on purpose: the clause #18510 removed sat two characters away, and a rule
 * that only caught the tightest spelling would be evaded by a comma.
 */
const ADJACENCY = 160;

/** Strip the ` * ` decoration so a claim split across lines reads as one. */
const flatten = (block: string): string =>
  block
    .split('\n')
    .map((line) => line.replace(/^\s*\*\/?/, '').replace(/^\s*\/\*\*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

/** Every closed card cited within `ADJACENCY` of an open-tracking phrase. */
const closedCardsReadingAsOpen = (block: string): string[] => {
  const text = flatten(block);
  const flagged: string[] = [];
  for (const [card] of CLOSED_CARDS) {
    for (let at = text.indexOf(card); at !== -1; at = text.indexOf(card, at + 1)) {
      const window = text.slice(
        Math.max(0, at - ADJACENCY),
        at + card.length + ADJACENCY,
      );
      if (OPEN_TRACKING_PHRASES.some((phrase) => window.includes(phrase))) {
        flagged.push(card);
        break;
      }
    }
  }
  return flagged;
};

const SRC = readFileSync(join(HERE, 'index.ts'), 'utf8');
const BLOCK = jsdocAboveConst(SRC, 'normalizeSessionResponse');

describe('#18510 — `normalizeSessionResponse`s JSDoc cites no closed card as open', () => {
  describe('① the locator found THIS block, and can fail to find one', () => {
    it('the block carries the anchors that identify it', () => {
      // Three anchors the block owns and its neighbours do not. If the
      // extractor ever grabs a different block, or the whole file, these move.
      expect(BLOCK).toContain('#17234');
      expect(BLOCK).toContain('data.token');
      expect(BLOCK).toContain('SessionResponseSchema');
      // And it really is a single JSDoc block, not a slice of the file.
      expect(BLOCK.startsWith('/**')).toBe(true);
      expect(BLOCK.endsWith('*/')).toBe(true);
      expect(BLOCK.slice(3, -2)).not.toContain('*/');
    });

    it('a symbol this file does not declare yields no block', () => {
      expect(jsdocAboveConst(SRC, 'normalizeSessionResponseThatDoesNotExist')).toBe('');
    });
  });

  describe('② the pin', () => {
    it('no closed card is cited beside an open-tracking phrase', () => {
      const flagged = closedCardsReadingAsOpen(BLOCK);
      expect(
        flagged,
        `these cards are closed but the JSDoc still reads as tracking them: ${flagged
          .map((card) => `${card} (${CLOSED_CARDS.find(([c]) => c === card)?.[1]})`)
          .join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('③ the instrument can still fail — negative control', () => {
    it('the sentence as it stood before #18510 is reported', () => {
      // Verbatim from `packages/client/src/index.ts` at a84da6096a, the base
      // this fix was cut from. Not a paraphrase: a predicate that only catches
      // a rewritten example is a predicate that would have missed the defect.
      const beforeTheFix = [
        '/**',
        ' * So `login` and `register` now',
        ' * parse as the full declared `SessionResponse`, with one gap that is NOT',
        ' * this: `data.user.image` served `null` against a declared',
        ' * `string | undefined` (#17235, tracked separately). This does not touch the',
        ' * `data.token` rule above.',
        ' */',
      ].join('\n');

      expect(closedCardsReadingAsOpen(beforeTheFix)).toEqual(['#17235']);
    });

    it('and a citation with no such phrase beside it is NOT reported', () => {
      // The other half: the predicate must not flag the past-tense form, or ②
      // would be unsatisfiable and the block would lose the citation entirely.
      //
      // ⚠️ This half earned its keep on the first run: the past-tense sentence
      // drafted for #18510 opened "the one gap that was still open when this
      // was written", and `still open` is on the vocabulary above — the
      // rewrite would have tripped the pin it was written to satisfy. The
      // shipped sentence says "remained" for that reason.
      const pastTense = [
        '/**',
        ' * The one gap that remained when this was written closed with',
        ' * #17235, which widened that declaration to `z.string().nullish()`.',
        ' */',
      ].join('\n');

      expect(closedCardsReadingAsOpen(pastTense)).toEqual([]);
    });
  });
});
