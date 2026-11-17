// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  LIST_DATASETS_MAX_CANDIDATES_PER_TERM,
  type DatasetTermCandidate,
  type DatasetTermMatch,
  type DatasetTermMatchedOn,
} from '@objectstack/spec/ai';
import { normalizeDatasetTerm } from '@objectstack/spec/ui';

/**
 * The ADR-0149 D3 term matcher — the platform half of the selection rule, the
 * reader of a dataset member's `synonyms` (behind `list_datasets.matches`).
 *
 * Rule 1, and only rule 1: a caller's term and a member's match target are
 * compared after {@link normalizeDatasetTerm} — the one normalization the
 * dataset schema's own vocabulary validation uses (NFKC, case-fold, trim,
 * collapse whitespace, `_` and `-` folded to a space) — and EQUALITY is a hit.
 * A substring, a stem or a near neighbour is not a hit. The match targets are
 * the member's `name`, its `label` in every locale of an inline map, and each
 * of its `synonyms`.
 *
 * Rules 2–5 (one hit wins, several hits ask, no hit falls back to the object
 * query labelled 「非指标口径」, a dimension hit alone is no answer) are the
 * caller's: the tool descriptions state them, and `matches` is the input they
 * decide on. This function decides nothing beyond "which words are equal".
 *
 * {@link findDatasetTermCandidates} is the D3 amendment note's half (behind
 * `list_datasets.candidates`): for a term with no hit anywhere, the members
 * offered for a clarifying question. It never changes what a hit is.
 */

/** A member's match targets, as the dataset declares them. */
export interface MatchableMember {
  readonly name: string;
  /** A string, or an inline locale map (every locale is a target). */
  readonly label?: unknown;
  readonly synonyms?: readonly unknown[];
}

/**
 * Which of `member`'s words `normalizedTerm` equals, or `undefined`. One
 * member answers once: `name` before `label` before `synonym`, so a word that
 * is both the member's name and one of its synonyms is reported as `name`.
 */
function matchedOn(normalizedTerm: string, member: MatchableMember): DatasetTermMatchedOn | undefined {
  if (normalizeDatasetTerm(member.name) === normalizedTerm) return 'name';
  for (const label of labelTargets(member.label)) {
    if (normalizeDatasetTerm(label) === normalizedTerm) return 'label';
  }
  for (const synonym of member.synonyms ?? []) {
    if (typeof synonym === 'string' && normalizeDatasetTerm(synonym) === normalizedTerm) return 'synonym';
  }
  return undefined;
}

/** Every string a label carries: itself, or each locale's value of a map. */
function labelTargets(label: unknown): string[] {
  if (typeof label === 'string') return [label];
  if (label && typeof label === 'object' && !Array.isArray(label)) {
    return Object.values(label as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
  }
  return [];
}

/**
 * Every (term, member) hit over the members given — the members the caller
 * was ADMITTED to see, never a withheld one (matching a withheld member would
 * disclose it). Terms in the caller's order, then dimensions before measures
 * in declaration order. A term that normalizes to nothing matches nothing.
 */
export function matchDatasetTerms(
  terms: readonly string[],
  members: { readonly dimensions: readonly MatchableMember[]; readonly measures: readonly MatchableMember[] },
): DatasetTermMatch[] {
  const matches: DatasetTermMatch[] = [];
  for (const term of terms) {
    const normalized = normalizeDatasetTerm(term);
    if (normalized === '') continue;
    for (const [kind, list] of [['dimensions', members.dimensions], ['measures', members.measures]] as const) {
      for (const member of list) {
        const on = matchedOn(normalized, member);
        if (on) matches.push({ term, member: `${kind}.${member.name}`, matchedOn: on });
      }
    }
  }
  return matches;
}

/**
 * A listed dataset as {@link findDatasetTermCandidates} reads it: its name and
 * the members the caller was ADMITTED to see, in the order its catalogue entry
 * lists them.
 */
export interface CandidateDataset {
  readonly name: string;
  readonly dimensions: readonly MatchableMember[];
  readonly measures: readonly MatchableMember[];
}

/**
 * The shortest word, in code points after normalization, that takes part in a
 * near comparison, on either side. One code point (`a`, `营`) is contained in
 * too many words to say anything about any of them.
 */
export const DATASET_TERM_NEAR_MIN_CODE_POINTS = 2;

const codePoints = (s: string): number => [...s].length;

/** Every match target a member carries: its name, each label locale, each string synonym. */
function targetsOf(member: MatchableMember): string[] {
  return [
    member.name,
    ...labelTargets(member.label),
    ...(member.synonyms ?? []).filter((s): s is string => typeof s === 'string'),
  ];
}

/**
 * Whether `member` is NEAR `normalizedTerm`: after the one normalization, one
 * of its match targets contains the term, or the term contains the target,
 * both at least {@link DATASET_TERM_NEAR_MIN_CODE_POINTS} code points long.
 * `金额` is near `合同金额` and `合同金额` is near `金额`. No edit distance, stem or
 * embedding: a containment test is a string comparison a unit test can pin
 * (ADR-0149 D3), and every consumer gets the same answer.
 */
function isNear(normalizedTerm: string, member: MatchableMember): boolean {
  for (const target of targetsOf(member)) {
    const t = normalizeDatasetTerm(target);
    if (codePoints(t) < DATASET_TERM_NEAR_MIN_CODE_POINTS) continue;
    if (t.includes(normalizedTerm) || normalizedTerm.includes(t)) return true;
  }
  return false;
}

/**
 * [ADR-0149 D3, amendment note] The members `list_datasets` offers as possible
 * readings of each term that matched nothing: `ListDatasetsOutputSchema`'s
 * `candidates`, to its shape, order and cap.
 *
 * - Only over the members given, which are the members the caller was
 *   admitted to see in the datasets the caller may query: a withheld member,
 *   an `internal`-field member or an unadmitted dataset is never passed in,
 *   so it is never offered and every pointer names a member the same answer
 *   lists.
 * - Only for a term with NO hit in any dataset given, judged by the same
 *   equality {@link matchDatasetTerms} reports as `matches`: a candidate is
 *   never a hit, and a term with a hit anywhere has no candidate.
 * - Near is {@link isNear}: containment either way after normalization, both
 *   sides at least two code points.
 * - Order is the listing order, never a ranking: terms as sent (a term sent
 *   twice is offered once), then datasets as given, then each dataset's
 *   measures before its dimensions (a dimension alone is no answer, D3 rule
 *   5), each in the order given. At most
 *   `LIST_DATASETS_MAX_CANDIDATES_PER_TERM` per term, the first in that order;
 *   nothing marks the cut.
 *
 * An empty array when there is nothing to offer: the caller omits the key.
 */
export function findDatasetTermCandidates(
  terms: readonly string[],
  datasets: readonly CandidateDataset[],
): DatasetTermCandidate[] {
  const candidates: DatasetTermCandidate[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    if (seen.has(term)) continue;
    seen.add(term);
    const normalized = normalizeDatasetTerm(term);
    if (codePoints(normalized) < DATASET_TERM_NEAR_MIN_CODE_POINTS) continue;
    const hit = datasets.some((d) =>
      [...d.dimensions, ...d.measures].some((m) => matchedOn(normalized, m) !== undefined));
    if (hit) continue;
    let offered = 0;
    scan: for (const dataset of datasets) {
      for (const [kind, list] of [['measures', dataset.measures], ['dimensions', dataset.dimensions]] as const) {
        for (const member of list) {
          if (!isNear(normalized, member)) continue;
          candidates.push({ term, dataset: dataset.name, member: `${kind}.${member.name}` });
          if (++offered >= LIST_DATASETS_MAX_CANDIDATES_PER_TERM) break scan;
        }
      }
    }
  }
  return candidates;
}
