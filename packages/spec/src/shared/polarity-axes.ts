// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AXIS vocabulary — the token pairs that name the two ends of one range,
 * and the predicate that recognises when the edit-distance suggester is about
 * to answer an axis-silent key with one arbitrary end of it.
 *
 * ## The defect this exists for
 *
 * `findClosestMatches` ranks by edit distance and nothing else, so on a shape
 * that declares BOTH ends of a range it answers a key that names neither end
 * with whichever end is spelled more cheaply. Measured on `main`, folded, at
 * the budget `strictUnknownKeyError` actually spends:
 *
 * ```text
 * authored `dateField`  (9 chars, budget max(2, 9/3) = 3)
 *   -> `endDateField`     distance 3   INSIDE the budget   <- answered
 *   -> `startDateField`   distance 5   outside the budget  <- unreachable
 * ```
 *
 * `end` is a three-letter token and `start` is a five-letter one. That spelling
 * accident is the entire reason the author is sent to the end of the event
 * rather than its start; nobody declared the mapping. And the answer is not
 * refused downstream — `endDateField` is a declared key, so an author who does
 * what the protocol told them gets a document the runtime ACCEPTS with the axis
 * bound to the wrong end. The obedient reader is the one it punishes.
 *
 * ## What this module changes, and what it deliberately does not
 *
 * It changes ONE thing: when the candidate the distance fallback would name
 * carries an axis token the authored key does not, and the shape also declares
 * that candidate's opposite-pole sibling, the rename is replaced by a
 * prescription naming BOTH ends. The accepted key set is untouched — the
 * axis-silent key is rejected before this module is consulted and is still
 * rejected after it. ⛔ No alias is declared: `dateField` does not acquire a
 * meaning here, it acquires an honest answer.
 *
 * Naming both ends rather than picking one is not invented here. `field.zod.ts`
 * already answers `visible` that way, by hand, for the same reason in its own
 * words — 「the two answers have opposite polarity … Naming both is the only
 * answer that cannot be acted on wrongly」. What a hand-written `guidance` entry
 * cannot do is cover the keys nobody thought to enumerate, which is precisely
 * the set a fuzzy suggester answers.
 *
 * ## Precedence — this module is the LAST resort, never the first
 *
 * A declared `aliases` entry is a human statement about one spelling and always
 * wins; so does an exact `guidance` entry and a `guidanceSets` match. This
 * predicate is consulted only on the candidate the DISTANCE fallback produced,
 * because a guess is the only thing here that can be a coin flip. `this field`
 * declares `length: 'maxLength'` beside `size: 'maxLength'` against a declared
 * `minLength` sibling: that is a decision, it reads as an axis collision, and it
 * is left exactly as written.
 *
 * ## Why this is a leaf module and not part of `suggestions.zod.ts`
 *
 * Same reason as `alias-probe.ts`: **two readers must agree.**
 * `strictUnknownKeyError` reads {@link oppositePoleAmbiguity} to answer an
 * author, and `alias-integrity.test.ts` reads {@link POLARITY_AXES} to prove no
 * row in it is dead. A second copy of either in the gate would fail silently.
 * Like `alias-probe.ts` it is deliberately **not** re-exported from
 * `shared/index.ts` — an internal seam the audit reaches by relative path, not
 * part of the `@objectstack/spec` contract.
 */

/**
 * Pairs of tokens that name opposite ends of ONE axis.
 *
 * ⚠️ **Every row must be ATTESTED** — some `strictObject` shape in this package
 * declares both poles of it as sibling keys. `alias-integrity.test.ts` asserts
 * that, the same way it refuses a dead `aliases` entry: a row nothing can ever
 * match is a claim nothing judges. So this table is NOT a general antonym
 * dictionary, and rows are not added ahead of the shape that needs them.
 *
 * Attested on 2026-09-20 over 136 registered surfaces (one row per pair, with
 * the surfaces that declare both poles):
 *
 * | axis            | attested by                                                    |
 * |:----------------|:---------------------------------------------------------------|
 * | `start` / `end` | `startDateField` / `endDateField` on calendar, gantt, timeline; |
 * |                 | `baselineStartField` / `baselineEndField` on gantt; `start` /   |
 * |                 | `end` on the gantt shift band                                   |
 * | `min` / `max`   | `minLength` / `maxLength` and `min` / `max` on form field;      |
 * |                 | `minRows` / `maxRows` on subform                                |
 * | `input` / `output` | `inputMapping` / `outputMapping` on API endpoint             |
 * | `read` / `write`   | `read` / `write` on the `api` data source                    |
 *
 * The order inside a pair is the order the two ends are NAMED IN, so a message
 * reads `startDateField` before `endDateField` however the candidates happened
 * to be declared. It carries no claim that the first is the better guess —
 * there is no better guess, which is the whole point.
 */
export const POLARITY_AXES: readonly (readonly [string, string])[] = [
  ['start', 'end'],
  ['min', 'max'],
  ['input', 'output'],
  ['read', 'write'],
];

/**
 * Split a key into its lower-cased word tokens.
 *
 * `startDateField`, `start_date_field` and `Start-Date-Field` all tokenize to
 * `['start', 'date', 'field']`: the same case/separator fold `foldForScoring`
 * and `aliasProbe` apply, one level finer so a token can be compared as a word
 * rather than as a substring. Word-level is load-bearing — a substring test
 * would find `in` inside `minLength` and `to` inside `total`.
 */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Levenshtein distance over the folded spelling, duplicated from
 * `suggestions.zod.ts` only in the sense that both measure the same thing —
 * this module imports nothing from it, because `suggestions.zod.ts` imports
 * THIS one and the package already carries two import cycles through
 * `field.zod` that its own docblocks describe at length.
 */
function distance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** One end of an axis the author did not choose between. */
export interface OppositePoleAmbiguity {
  /** The candidate the distance fallback named. */
  readonly named: string;
  /** Its opposite-pole sibling, declared on the same shape. */
  readonly opposite: string;
  /** The axis, as {@link POLARITY_AXES} declares it. */
  readonly axis: readonly [string, string];
  /** Both keys ordered by the axis — `['startDateField', 'endDateField']`. */
  readonly poles: readonly [string, string];
}

/**
 * True-ish when naming `candidate` back to the author of `input` would be a
 * coin flip on the axis rather than a correction of a typo.
 *
 * All four conditions hold, and the fourth is the one that keeps this narrow:
 *
 * 1. `candidate` carries an axis token as one of its WORDS;
 * 2. `input` carries neither end of that axis — the author asked no question
 *    about which end, so an answer that picks one is inventing the question;
 * 3. the shape also declares the opposite-pole sibling, so both ends really are
 *    reachable spellings and the choice really is between two live keys;
 * 4. `input` is at least as close to `candidate` MINUS its axis token as it is
 *    to `candidate` itself — the authored spelling is better explained as "the
 *    key without the axis" than as "the key with a typo in it".
 *
 * Condition 4 is what separates this from a blanket suppression, and it was
 * measured rather than reasoned. Without it, `axLength` — an ordinary dropped
 * character in `maxLength` — loses its suggestion, because `minLength` is
 * declared right beside it and `axLength` names no pole either. With it:
 * `axLength` is distance 1 from `maxlength` and 2 from the stripped `length`,
 * so it reads as the typo it is and keeps its rename, while `dateField` is
 * distance 0 from the stripped `datefield` and 3 from `enddatefield`, and reads
 * as the axis-silent key it is.
 */
export function oppositePoleAmbiguity(
  input: string,
  candidate: string,
  candidates: readonly string[],
): OppositePoleAmbiguity | undefined {
  const candTokens = keyTokens(candidate);
  // A key that is NOTHING but a pole (`start` / `end` on the gantt shift band)
  // has no axis-silent spelling to be confused with — there is no remainder.
  if (candTokens.length < 2) return undefined;
  const inputTokens = new Set(keyTokens(input));
  const folded = keyTokens(input).join('');

  for (let i = 0; i < candTokens.length; i++) {
    const axis = POLARITY_AXES.find((pair) => pair[0] === candTokens[i] || pair[1] === candTokens[i]);
    if (!axis) continue;
    // (2) The author named an end. Whatever else is wrong with their spelling,
    // it is not that they failed to choose.
    if (inputTokens.has(axis[0]) || inputTokens.has(axis[1])) continue;
    const other = candTokens[i] === axis[0] ? axis[1] : axis[0];
    const wanted = candTokens.slice();
    wanted[i] = other;
    const wantedKey = wanted.join('');
    // (3) Both ends must be live keys on this shape.
    const opposite = candidates.find(
      (c) => c !== candidate && keyTokens(c).join('') === wantedKey,
    );
    if (!opposite) continue;
    // (4) Omission, not typo.
    const stripped = candTokens.filter((_, t) => t !== i).join('');
    if (distance(folded, stripped) > distance(folded, candTokens.join(''))) continue;
    const poles: readonly [string, string] =
      candTokens[i] === axis[0] ? [candidate, opposite] : [opposite, candidate];
    return { named: candidate, opposite, axis, poles };
  }
  return undefined;
}

/**
 * The author-facing bullet an {@link OppositePoleAmbiguity} is answered with.
 *
 * It names both ends and prescribes nothing between them, because there is
 * nothing to prescribe: the key the author wrote does not carry the
 * information. The last clause is the part that matters most to an AI author,
 * which will otherwise read a rejection as "any accepted key will do" — both
 * spellings parse, so the failure this replaces was silent.
 */
export function oppositePolePrescription(key: string, ambiguity: OppositePoleAmbiguity): string {
  const [first, second] = ambiguity.poles;
  return (
    `\`${key}\` does not say which end of the range it binds, and this surface declares both `
    + `\`${first}\` and \`${second}\` — opposite ends of one axis. Write the one you mean: both `
    + `parse, so guessing binds the wrong end silently.`
  );
}
