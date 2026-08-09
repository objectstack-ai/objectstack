// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';
import { FieldType } from '../data/field.zod';

import { aliasProbe } from './alias-probe';

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

/**
 * One prescription shared by a **named set of keys** — the second `guidance`
 * form, added at #6619 so the three hand-written `$ZodErrorMap`s could be folded
 * into this template at all.
 *
 * ## Why the exact-key form was not enough
 *
 * `guidance` is `Record<key, prescription>`: it answers *this exact spelling*.
 * The three maps this form was written for do not work that way — each keys its
 * answer on **membership of a family**:
 *
 * - `LEGACY_WIDGET_ANALYTICS_KEYS` — eleven pre-ADR-0021 inline-analytics keys,
 *   one migration answer ("bind a `dataset`, select `dimensions` + `values`");
 * - `QUARANTINED_WIDGET_KEYS` — `component` / inline `data`, one quarantine
 *   verdict;
 * - the ADR-0089 conditional-visibility family, which is not enumerable at all:
 *   it is *any* key that reads like a visibility predicate, matched by pattern.
 *
 * Transcribing those into N identical exact entries loses two things. It emits
 * the prescription **once per matching key** (eleven bullets of the same
 * paragraph for a widget carrying the whole legacy shape), and it cannot express
 * the pattern case at all.
 *
 * ## The two membership forms, and what each buys the audit
 *
 * - `keys: readonly string[]` — an enumerated family. `alias-integrity.test.ts`
 *   judges every member against the shape exactly as it judges an exact
 *   `guidance` key: a member the shape *declares* is a dead entry, because a
 *   declared key never reaches the `unrecognized_keys` path.
 * - `keys: RegExp` — an open family, for the case where the point is to catch
 *   spellings nobody enumerated (`/vis|conceal|hidden|show.?when/i` answers
 *   `visibleWhenn`, `visibleIf`, `hiddenWhen`, `conceal`). The dead-entry claim
 *   cannot be asked of a pattern the same way — this one *deliberately* also
 *   matches the canonical `visibleWhen`, which the shape declares and which
 *   therefore never arrives here. So a pattern must carry {@link examples}, and
 *   the audit asks the answerable question instead: do the spellings this
 *   pattern was written for really match it, and are they really keys the shape
 *   rejects? A pattern typo fails that; a pattern shadowed into uselessness by
 *   the shape fails it too.
 *
 * ## Precedence — stated here because a second shape on a shared template is
 * where accidental precedence bugs live
 *
 * 1. An **exact `guidance` entry always wins** over any set. The more specific
 *    entry decides, so adding a set can never silently steal a key that already
 *    had a hand-written answer.
 * 2. Among sets, **declaration order wins** — the first set that claims a key
 *    answers it, matching the top-to-bottom `if` chain the hand-written maps
 *    read as.
 * 3. A set match **suppresses the rename suggestion** for that key, exactly as
 *    an exact entry does: a prescription and a "did you mean" are two answers to
 *    one question.
 * 4. A set contributes **at most one bullet per message**, positioned at the
 *    first key that matched it — the property that keeps eleven legacy keys to
 *    one paragraph.
 *
 * Rules 1 and 2 are pinned in `strict-object.test.ts`; `alias-integrity.test.ts`
 * additionally holds every in-repo surface to *unambiguous* tables, so no
 * shipped message depends on a tie-break being read correctly.
 */
export interface KeySetGuidance {
  /**
   * The set's name — the constant an author greps for
   * (`LEGACY_WIDGET_ANALYTICS_KEYS`). Deliberately **not** rendered into the
   * message: an author-facing rejection should name the KEYS, not the array
   * that holds them, and each prescription below already spells its family out
   * in prose (that is what makes it legible). The name is for the declaration
   * and for the audit's failure text.
   */
  readonly name: string;
  /**
   * Membership: an enumerated family, or a pattern for the open case. Matched
   * against the authored spelling **case-sensitively** (an enumerated list is
   * tested with `includes`; a pattern with its own flags), the same exactness
   * `guidance` uses — case folding is the rename channel's job.
   */
  readonly keys: readonly string[] | RegExp;
  /**
   * Required when {@link keys} is a pattern, ignored otherwise: spellings this
   * pattern exists for. The audit asserts each one matches, and that none of
   * them is a key the shape declares.
   */
  readonly examples?: readonly string[];
  /** The prescription, emitted verbatim as one bullet line. */
  readonly prescription: string;
}

/**
 * True when `key` is claimed by `set` — the one place membership is decided, so
 * the template and the audit can never disagree about what a set contains.
 *
 * Patterns are tested with `String#search` rather than `RegExp#test`: `test` is
 * stateful on a `/g` or `/y` regex (it advances `lastIndex`, so the same key
 * alternates between matching and not), while `search` saves and restores
 * `lastIndex` by specification. A declaration must not have to remember which
 * flags are safe.
 */
export function keySetMatches(set: KeySetGuidance, key: string): boolean {
  return set.keys instanceof RegExp ? key.search(set.keys) !== -1 : set.keys.includes(key);
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
  /**
   * The set-keyed half of the same channel: one prescription shared by a named
   * family of keys, emitted once per message however many members were written.
   * Consulted only after {@link guidance} has had its exact say — see
   * {@link KeySetGuidance} for the full precedence rule and why the form exists.
   */
  guidanceSets?: readonly KeySetGuidance[];
  /**
   * One sentence of history: why this key would previously have failed
   * silently. Rendered **last**, after both fix channels (`Did you mean` and
   * the `guidance` bullets) — see the ordering note on
   * {@link strictUnknownKeyError}.
   */
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
 * ## Message order: the fix comes before the history (#5955)
 *
 * One message per rejected object — every unknown key of that object is named
 * in it, and the surface's `history` sentence appears exactly once, whatever
 * the key count. The parts are emitted in the order an author has to read
 * them:
 *
 * ```text
 * Unrecognized key(s) on {surface}: `k1`, `k2`.   ← which keys are wrong
 * [ Did you mean `k1` → `canonical`? ]            ← fix, channel 1 (renames)
 * [ \n  • {guidance} ]                            ← fix, channel 2 (prescriptions)
 * {history}                                       ← why it used to be silent
 * ```
 *
 * `history` sat in the middle until #5955, which pushed the fix past character
 * ~220 on the single-line displays several consumers use. It is still emitted
 * verbatim and unconditionally — only its position moved.
 *
 * ## No in-repo caller passes `knownKeys` by hand any more (#5593)
 *
 * `knownKeys` is a hand-transcribed array — a second copy of the shape it
 * describes — so a table built this way could only ever be audited against the
 * transcription, and a drifted array dragged the audit with it. #5483 shipped a
 * transitional registry that at least put those 44 call sites under
 * `alias-integrity.test.ts`; #5593 migrated every one of them to
 * `strictObject`, which derives the candidate list from the shape, and
 * deleted the registry with the last of them.
 *
 * This factory stays PUBLISHED and unchanged for external callers, but inside
 * `packages/spec` the only caller is `strictObject` itself. That is enforced,
 * not merely true: `alias-integrity.test.ts` fails on any new direct call site
 * here, because a new one would mint a fresh second copy of a key list and
 * arrive outside the shape-backed audit.
 */
export function strictUnknownKeyError(options: StrictUnknownKeyErrorOptions): z.core.$ZodErrorMap {
  const { surface, knownKeys, guidance = {}, guidanceSets = [], history } = options;
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
    // A set answers once per MESSAGE, at the position of the first key that
    // reached it — eleven legacy analytics keys are one migration paragraph,
    // not eleven copies of it (#6619).
    const firedSets = new Set<KeySetGuidance>();
    for (const key of keys) {
      // Precedence, in the order the two channels are consulted: the exact
      // entry is the more specific claim, so it decides before any set is
      // asked. Pinned in `strict-object.test.ts`.
      const prescription = guidance[key];
      if (prescription) {
        prescriptions.push(prescription);
        continue;
      }
      const set = guidanceSets.find((s) => keySetMatches(s, key));
      if (set) {
        // Matched, therefore answered — the rename channel is skipped for this
        // key exactly as an exact entry skips it, even when the set has already
        // spoken and adds no second bullet.
        if (!firedSets.has(set)) {
          firedSets.add(set);
          prescriptions.push(set.prescription);
        }
        continue;
      }
      const maxDistance = Math.max(2, Math.floor(key.length / 3));
      const canonical =
        aliases[aliasProbe(key)] ?? findClosestMatches(key, knownKeys, maxDistance, 1)[0];
      if (canonical && canonical !== key) renames.push(`\`${key}\` → \`${canonical}\``);
    }
    // Order: WHICH KEY IS WRONG → HOW TO FIX IT → why it used to be silent.
    // `history` used to sit in the middle, between the key statement and the
    // suggestion, which put the fix past character ~220 of a message several
    // consumers render on ONE line (`os validate`'s `• where: message`, CI
    // logs, and `validateFlowTriggerReadiness`, which flattens the newlines).
    // Since #5762 promoted one of those rules to error level the author — often
    // an AI — reads the front of that line and acts on it, so the prescription
    // has to be there. Nothing is dropped or made conditional: the sentence is
    // still emitted verbatim, once per message, just last (#5955).
    let message = `Unrecognized key(s) on ${surface}: ${keys.map((k) => `\`${k}\``).join(', ')}.`;
    if (renames.length) message += ` Did you mean ${renames.join(', ')}?`;
    if (prescriptions.length) message += `\n${prescriptions.map((p) => `  • ${p}`).join('\n')}`;
    return `${message} ${history}`;
  };
}
