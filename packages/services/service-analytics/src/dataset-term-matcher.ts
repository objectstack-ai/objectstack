// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DatasetTermMatch, DatasetTermMatchedOn } from '@objectstack/spec/ai';
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
