// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rename guess an unknown key is offered — ONE rule, read by every
 * unknown-key suggester in this package.
 *
 * The doors that answer an unknown key with "did you mean" all call
 * {@link suggestRename}: the shared `strictUnknownKeyError` (every
 * `strictObject` surface, including the value shapes of
 * `data/field-value.zod.ts` that `data/default-value-shape.ts` reads back),
 * `ObjectSchema.create()` (`data/object.zod.ts`), `defineSeed`
 * (`data/seed.zod.ts`) and the authoring-key lint `defineStack` and the CLI
 * report through (`data/authoring-key-lint.ts`). The last three used to spell
 * their own budget — two copies of `max(2, len/3)` without the short-key screen
 * below, and a flat distance of 3 — so after the screen was settled on the
 * first door they kept answering a short key with an unrelated one. This module
 * is now the only spelling of the budget and the screen; `suggestions.test.ts`
 * fails on a source file that spells either again.
 *
 * Out of its reach on purpose: suggesters that rank a closed VALUE vocabulary
 * rather than guess a key's rename — the enum-value hint in `error-map.zod.ts`
 * and `suggestFieldType` — keep `findClosestMatches`' own default.
 *
 * A leaf module on purpose: it imports nothing, so `suggestions.zod.ts` (which
 * `strict-object.ts` imports, which nearly every closed schema imports) can read
 * it without joining a cycle, and `data/*.zod.ts` can read it without importing
 * the refusal factory. `levenshteinDistance` and `findClosestMatches` are
 * re-exported from `suggestions.zod.ts` unchanged, so the published names and
 * their import path stay where they were. `suggestRename` and
 * {@link renameBudget} are deliberately **not** re-exported from
 * `shared/index.ts` — like `alias-probe.ts`, an internal seam, not part of the
 * `@objectstack/spec` contract.
 */

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses space-optimized two-row approach (O(min(m,n)) space).
 */
export function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use only two rows for space efficiency
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);

  for (let j = 0; j <= lb; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb];
}

/**
 * Fold away the differences an author is *never* signalling with: letter case
 * and the dash/space spellings of an underscore separator.
 *
 * Applied to BOTH sides of the comparison in {@link findClosestMatches}. Folding
 * only the input was a real defect (#4990): candidates are camelCase across most
 * of the spec (AGENTS.md Prime Directive #3, "TS config keys → camelCase"), so
 * every capital in a declared key charged the author one extra substitution
 * against a budget that is only `max(2, len/3)`. The observable symptom was
 * inverted quality — `hiddenon` (all-lowercase, plain wrong) resolved to
 * `hiddenOn` at distance 1, while `hideOn` (correctly cased, one real typo)
 * scored 3 against a budget of 2 and got no suggestion at all.
 */
const foldForScoring = (value: string): string => value.toLowerCase().replace(/[-\s]/g, '_');

/**
 * Find the closest matches from a list of candidates.
 *
 * Scoring is case- and separator-insensitive on both sides; the returned
 * strings are the candidates' ORIGINAL spelling, because that spelling is what
 * the author has to type back.
 *
 * @param input - The user-provided (possibly invalid) value
 * @param candidates - Array of valid values to compare against
 * @param maxDistance - Maximum edit distance to consider (default: 3)
 * @param maxResults - Maximum number of suggestions to return (default: 3)
 * @returns Array of suggested values, sorted by similarity
 */
export function findClosestMatches(
  input: string,
  candidates: readonly string[],
  maxDistance = 3,
  maxResults = 3,
): string[] {
  const normalized = foldForScoring(input);

  const scored = candidates
    .map((candidate) => ({
      value: candidate,
      distance: levenshteinDistance(normalized, foldForScoring(candidate)),
      // Tie-break only. Folding is right for RANKING (case is not what the
      // author meant to signal), but when two declared keys are equidistant
      // under the fold the author's own capitalisation is the last piece of
      // evidence left about which one they were reaching for — `yxAis` ties
      // `yAxis` and `xAxis` at 2 folded, and the capital A picks the intended
      // one. Kept strictly secondary so it can never resurrect the #4990 bug
      // of case outranking a real edit.
      cased: levenshteinDistance(input, candidate),
    }))
    // Drop only the candidate the author ALREADY typed verbatim — suggesting a
    // string back to the author who wrote it is noise. A folded distance of 0
    // on a differently-spelled candidate (`hiddenon` vs `hiddenOn`) is not that
    // case: it is the strongest suggestion available, and pre-#4990 the
    // `distance > 0` test threw it away together with the true self-match.
    .filter((s) => s.distance <= maxDistance && s.value !== input)
    .sort((a, b) => a.distance - b.distance || a.cased - b.cased);

  return scored.slice(0, maxResults).map((s) => s.value);
}

/**
 * Edit distance in which swapping two adjacent letters costs ONE edit (the
 * optimal-string-alignment variant of Levenshtein). Used only by the short-key
 * screen in {@link suggestRename}; scoring for every other length is
 * {@link levenshteinDistance}, unchanged.
 */
function adjacentSwapDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push([i]);
    for (let j = 1; j <= b.length; j++) rows[i]![j] = i === 0 ? j : 0;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The edit budget a rename guess for `key` may spend: a third of the key, never
 * less than 2. A flat distance of 3 is noise on a short key, which is why the
 * budget is length-relative at all; {@link suggestRename} spends it.
 */
export function renameBudget(key: string): number {
  return Math.max(2, Math.floor(key.length / 3));
}

/**
 * The rename guess for one unknown key, or `undefined`.
 *
 * Above five characters this is {@link findClosestMatches}' first answer within
 * {@link renameBudget}. At five characters or fewer the budget is the floor of
 * 2, not a third of the key, and the floor exists for one slip: a swap of two
 * adjacent letters, which plain Levenshtein charges as two edits (`nmae` →
 * `name`). The same 2 also admits two UNRELATED edits, which on a four-letter
 * key is half of it — `aria` → `areas` (one substitution, one insertion), a
 * removed accessibility key answered with the app's navigation areas. So a
 * short key's guess must be one edit away counting a swap as one; the candidates
 * are still ranked by {@link findClosestMatches}, and the first that passes wins.
 *
 * An empty key names nothing, so nothing is a spelling of it: every candidate
 * of one letter sits inside the screen, and the first of them would be offered
 * as the fix.
 */
export function suggestRename(key: string, knownKeys: readonly string[]): string | undefined {
  if (key === '') return undefined;
  const maxDistance = renameBudget(key);
  if (Math.floor(key.length / 3) >= 2) return findClosestMatches(key, knownKeys, maxDistance, 1)[0];
  const folded = foldForScoring(key);
  return findClosestMatches(key, knownKeys, maxDistance, knownKeys.length)
    .find((candidate) => adjacentSwapDistance(folded, foldForScoring(candidate)) <= 1);
}
