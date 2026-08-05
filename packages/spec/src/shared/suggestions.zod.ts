// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';
import { FieldType } from '../data/field.zod';

import { aliasProbe } from './alias-probe';
import { registerDirectAliasTable } from './alias-table-registry';

/**
 * "Did you mean?" Suggestion Utilities
 *
 * Provides fuzzy matching for common ObjectStack identifiers.
 * Used by the custom error map to suggest corrections for typos.
 *
 * @example
 * ```ts
 * suggestFieldType('text_area');  // ['textarea']
 * suggestFieldType('String');     // ['text']
 * suggestFieldType('int');        // ['number']
 * ```
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
 * Well-known aliases that map common typos / alternative names to valid FieldTypes.
 */
const FIELD_TYPE_ALIASES: Record<string, string> = {
  // Common alternative names
  string: 'text',
  str: 'text',
  varchar: 'text',
  char: 'text',
  int: 'number',
  integer: 'number',
  float: 'number',
  double: 'number',
  decimal: 'number',
  numeric: 'number',
  bool: 'boolean',
  checkbox: 'boolean',
  check: 'boolean',
  date_time: 'datetime',
  timestamp: 'datetime',
  // Common typos
  text_area: 'textarea',
  textarea_: 'textarea',
  textfield: 'text',
  dropdown: 'select',
  picklist: 'select',
  enum: 'select',
  multi_select: 'multiselect',
  multiselect_: 'multiselect',
  reference: 'lookup',
  ref: 'lookup',
  foreign_key: 'lookup',
  fk: 'lookup',
  relation: 'lookup',
  master: 'master_detail',
  richtext_: 'richtext',
  rich_text: 'richtext',
  upload: 'file',
  attachment: 'file',
  photo: 'image',
  picture: 'image',
  img: 'image',
  percent_: 'percent',
  percentage: 'percent',
  money: 'currency',
  price: 'currency',
  auto_number: 'autonumber',
  auto_increment: 'autonumber',
  sequence: 'autonumber',
  markdown_: 'markdown',
  md: 'markdown',
  barcode: 'qrcode',
  tag: 'tags',
  star: 'rating',
  stars: 'rating',
  geo: 'location',
  gps: 'location',
  coordinates: 'location',
  embed: 'vector',
  embedding: 'vector',
  embeddings: 'vector',
};

/**
 * Suggest valid FieldType values for an invalid input.
 *
 * First checks known aliases, then falls back to fuzzy matching.
 *
 * @param input - Invalid field type string
 * @returns Array of suggested valid FieldType values
 *
 * @example
 * ```ts
 * suggestFieldType('text_area');  // ['textarea']
 * suggestFieldType('String');     // ['text']
 * suggestFieldType('int');        // ['number']
 * suggestFieldType('dropdown');   // ['select']
 * ```
 */
export function suggestFieldType(input: string): string[] {
  const normalized = input.toLowerCase().replace(/[-\s]/g, '_');

  // Check alias map first
  const alias = FIELD_TYPE_ALIASES[normalized];
  if (alias) {
    return [alias];
  }

  // Fall back to fuzzy matching
  return findClosestMatches(normalized, FieldType.options);
}

/**
 * Format a "Did you mean?" message for display.
 *
 * @param suggestions - Array of suggested values
 * @returns Formatted string or empty string if no suggestions
 */
export function formatSuggestion(suggestions: string[]): string {
  if (suggestions.length === 0) return '';
  if (suggestions.length === 1) return `Did you mean '${suggestions[0]}'?`;
  return `Did you mean one of: ${suggestions.map((s) => `'${s}'`).join(', ')}?`;
}

/** Options for {@link strictUnknownKeyError}. */
export interface StrictUnknownKeyErrorOptions {
  /** Prose name of the authoring surface the key was written on (e.g. `'this permission set'`). */
  surface: string;
  /** The schema's declared keys — candidates for the edit-distance fallback. */
  knownKeys: readonly string[];
  /**
   * Semantic near-misses: a different *word* for the same intent, usually
   * borrowed from a neighbouring schema or product where that word is correct.
   * Edit distance cannot reach these, so they are named explicitly; plain
   * case/underscore slips are left to {@link findClosestMatches}. Map keys are
   * matched case-insensitively with `_` / `-` / space separators removed.
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Exact-key prescriptions, appended verbatim as bullet lines: tombstones for
   * retired keys (the rejection must carry the upgrade — see the Post-Task
   * Checklist in AGENTS.md), or wrong-layer pointers for keys that belong to a
   * different surface. An entry here suppresses the rename suggestion for that
   * key. Matched case-sensitively (exact authored spelling).
   */
  guidance?: Readonly<Record<string, string>>;
  /** One sentence of history: why this key would previously have failed silently. */
  history: string;
}

/**
 * Build the custom zod `error` map for a `.strict()` authorable schema — the
 * shared factory behind the unknown-key strictness ratchet (#4001, ADR-0078).
 *
 * Zod's default is `.strip`: a key the schema does not declare is **silently
 * discarded** and the instance goes on parsing. On an authorable surface that
 * is the worst failure mode — the author (human or AI) gets a success and
 * ships metadata that quietly ignores their config (#3405 action-param
 * `reference`, #1535 object-level `workflows`). `.strict()` makes the drop
 * loud; this factory makes it *fixable*: the error names the offending key(s)
 * and, when one is a recognisable spelling of a declared key, points at the
 * canonical one — alias table first (semantic near-misses), then a
 * length-relative edit-distance fallback (matching `suggestKey` in
 * `data/object.zod.ts`: a flat distance of 3 is noise on a short key).
 *
 * Wire it as the object's `error` alongside `.strict()`:
 *
 * ```ts
 * z.object({ ... }, { error: strictUnknownKeyError({ ... }) }).strict()
 * ```
 *
 * First consumers: `ui/action.zod.ts` (#3746, the template this generalizes),
 * `security/permission.zod.ts`, `automation/flow.zod.ts`.
 *
 * ## The table is recorded as it is built (#5483)
 *
 * Every call registers its `{ surface, knownKeys, aliases, guidance }` with
 * `alias-table-registry`, which is what puts the 44 remaining direct call sites
 * under `alias-integrity.test.ts`. Registering **here** rather than at the call
 * sites is the entire trick: the gate gains 44 tables and the schemas gain no
 * edit, so the migration to `strictObject` (#5593) stays a clean, separable
 * change rather than something this guard has already half-done.
 *
 * What the gate can judge from a registration is bounded by what a direct call
 * offers. `knownKeys` is a hand-transcribed array, so "is this alias target a
 * real key?" is answered against the transcription, not the shape — the
 * array-vs-shape drift `strictObject` exists to abolish stays unguarded until
 * the call site migrates. The `aliasProbe` collision claim has no such caveat:
 * it reads the alias table alone, so it is judged here exactly as it is on a
 * `strictObject` surface.
 */
export function strictUnknownKeyError(options: StrictUnknownKeyErrorOptions): z.core.$ZodErrorMap {
  registerDirectAliasTable(options);
  const { surface, knownKeys, guidance = {}, history } = options;
  const aliases: Record<string, string> = {};
  for (const [key, canonical] of Object.entries(options.aliases ?? {})) {
    // Two keys in ONE table that share a probe collapse here, later silently
    // winning — which pointed `snap.grid` at the boolean `showGrid` instead of
    // `gridSize` until #5481. Nothing can be recovered at this point (the
    // colliding key is already gone), so the defect is caught where it is
    // authored: `alias-integrity.test.ts` rejects any table with two keys
    // sharing an `aliasProbe`. Since the probe already eats case and
    // separators, such a pair is redundant even when both point at the same
    // target — one entry always covered both spellings.
    aliases[aliasProbe(key)] = canonical;
  }
  return (issue) => {
    if (issue.code !== 'unrecognized_keys') return undefined;
    const keys = (issue as { keys?: readonly string[] }).keys ?? [];
    const renames: string[] = [];
    const prescriptions: string[] = [];
    for (const key of keys) {
      const prescription = guidance[key];
      if (prescription) {
        prescriptions.push(prescription);
        continue;
      }
      const maxDistance = Math.max(2, Math.floor(key.length / 3));
      const canonical =
        aliases[aliasProbe(key)] ?? findClosestMatches(key, knownKeys, maxDistance, 1)[0];
      if (canonical && canonical !== key) renames.push(`\`${key}\` → \`${canonical}\``);
    }
    let message =
      `Unrecognized key(s) on ${surface}: ${keys.map((k) => `\`${k}\``).join(', ')}. ${history}`;
    if (renames.length) message += ` Did you mean ${renames.join(', ')}?`;
    if (prescriptions.length) message += `\n${prescriptions.map((p) => `  • ${p}`).join('\n')}`;
    return message;
  };
}
