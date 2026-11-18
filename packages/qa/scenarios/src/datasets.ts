// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's datasets and dataset questions (ADR-0149): what each word of a
 * question matches, read the way the platform reads it, and the loader's
 * checks that a card declares only what the platform would accept and only
 * routes its words make right.
 *
 * Two rules are the platform's, imported, never restated here:
 *
 *   - `DatasetSchema` (`@objectstack/spec/ui`): every declared dataset is
 *     projected to the platform's own dataset shape and parsed by it, so the
 *     ADR-0149 D1 uniqueness rule (no word answers to two members of one
 *     dataset), the synonym limits and the description limit hold on a card
 *     exactly as they hold on a build.
 *   - `normalizeDatasetTerm`: the one normalization the dataset tools match a
 *     term under (ADR-0149 D3 rule 1), so "matches" means here what it means
 *     to `list_datasets`.
 */

import { DatasetSchema, normalizeDatasetTerm } from '@objectstack/spec/ui';

import type { DatasetExpectation, ScenarioCard } from './schema.js';

/** A member of one of the card's datasets, with every word it answers to. */
export interface DatasetMemberWords {
  dataset: string;
  kind: 'measure' | 'dimension';
  name: string;
  label: string;
  /** Its name, label and synonyms as the card writes them. */
  words: string[];
  /** The same, normalized ({@link normalizeDatasetTerm}). */
  targets: Set<string>;
}

/** Every member of `datasets`, measures first, in card order. */
export function datasetMembers(datasets: readonly DatasetExpectation[] | undefined): DatasetMemberWords[] {
  const out: DatasetMemberWords[] = [];
  for (const ds of datasets ?? []) {
    const add = (kind: DatasetMemberWords['kind'], m: { name: string; label: string; synonyms?: string[] }) => {
      const words = [m.name, m.label, ...(m.synonyms ?? [])];
      out.push({ dataset: ds.name, kind, name: m.name, label: m.label, words, targets: new Set(words.map(normalizeDatasetTerm)) });
    };
    for (const m of ds.measures) add('measure', m);
    for (const d of ds.dimensions ?? []) add('dimension', d);
  }
  return out;
}

/** The members `word` is a hit on (ADR-0149 D3 rule 1: equality after normalization). */
export function hitsOf(members: readonly DatasetMemberWords[], word: string): DatasetMemberWords[] {
  const w = normalizeDatasetTerm(word);
  return members.filter((m) => m.targets.has(w));
}

/** `true` when `word` is no hit on `member` but one of its words holds it or is held by it (a substring or a stem). */
export function isNearMiss(member: DatasetMemberWords, word: string): boolean {
  const w = normalizeDatasetTerm(word);
  if (w === '' || member.targets.has(w)) return false;
  return [...member.targets].some((t) => t.includes(w) || w.includes(t));
}

/** `dataset.measure`, as a refusal and a grade name a member. */
export const memberKey = (m: { dataset: string; measure?: string; name?: string }): string => `${m.dataset}.${m.measure ?? m.name}`;

/** The dataset `ds` as the platform's `DatasetSchema` reads one. */
export function asPlatformDataset(ds: DatasetExpectation): Record<string, unknown> {
  return {
    name: ds.name,
    label: ds.label,
    description: ds.description,
    object: ds.object,
    dimensions: (ds.dimensions ?? []).map((d) => ({ ...d })),
    measures: ds.measures.map((m) => ({ ...m })),
  };
}

type IssuePath = ReadonlyArray<string | number>;
type Refuse = (path: IssuePath, message: string) => void;

const folded = (t: string): string => t.normalize('NFKC').toLowerCase();

/** The texts of `ask`, one per language it is written in. */
const askTexts = (ask: Readonly<Record<string, string | undefined>>): Array<[string, string]> =>
  Object.entries(ask).filter((e): e is [string, string] => e[1] !== undefined);

/**
 * The loader's checks on `expect.datasets` and `run.datasetQuestions`.
 * `fieldsOf(object)` answers the fields the object's seed rows carry, with
 * whether every value seeded there is a number or empty; `takenIds` the
 * question and operation ids, which share the replay key's step segment.
 */
export function checkDatasets(
  card: ScenarioCard,
  seedField: (object: string, field: string) => 'absent' | 'number' | 'other',
  takenIds: ReadonlySet<string>,
  refuse: Refuse,
): void {
  const datasets = card.expect.datasets ?? [];
  const objects = new Set(card.expect.objects);
  const seen = new Set<string>();
  datasets.forEach((ds, i) => {
    const at: IssuePath = ['expect', 'datasets', i];
    if (seen.has(ds.name)) refuse([...at, 'name'], `duplicate dataset \`${ds.name}\``);
    seen.add(ds.name);
    if (!objects.has(ds.object)) {
      refuse([...at, 'object'], `\`${ds.object}\` is not in expect.objects`);
      return;
    }
    // The platform's own dataset schema: its shape, its synonym limits and the D1 uniqueness rule.
    const parsed = DatasetSchema.safeParse(asPlatformDataset(ds));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) refuse([...at, ...(issue.path as IssuePath)], `the platform refuses this dataset: ${issue.message}`);
    }
    ds.measures.forEach((m, j) => {
      const mat: IssuePath = [...at, 'measures', j];
      if (m.aggregate === 'count') {
        if (m.field !== undefined) refuse([...mat, 'field'], 'a `count` measure counts rows and names no field');
        return;
      }
      if (m.field === undefined) {
        refuse([...mat, 'field'], `a \`${m.aggregate}\` measure names the number field it aggregates`);
        return;
      }
      const kind = seedField(ds.object, m.field);
      if (kind === 'absent') refuse([...mat, 'field'], `no seed row of \`${ds.object}\` carries \`${m.field}\``);
      else if (kind === 'other') refuse([...mat, 'field'], `\`${ds.object}.${m.field}\` holds a value that is no number, so a \`${m.aggregate}\` over it is no figure`);
    });
    (ds.dimensions ?? []).forEach((d, j) => {
      if (seedField(ds.object, d.field) === 'absent') refuse([...at, 'dimensions', j, 'field'], `no seed row of \`${ds.object}\` carries \`${d.field}\``);
    });
  });

  const questions = card.run.datasetQuestions ?? [];
  if (questions.length && datasets.length === 0) {
    refuse(['run', 'datasetQuestions'], 'dataset questions are graded against the card\'s datasets: declare them in `expect.datasets`');
    return;
  }
  const members = datasetMembers(datasets);
  const measures = members.filter((m) => m.kind === 'measure');
  const measureOf = (dataset: string, measure: string) => measures.find((m) => m.dataset === dataset && m.name === measure);
  const covered = new Set(datasets.map((d) => d.object));
  const ids = new Set<string>();
  questions.forEach((q, i) => {
    const at: IssuePath = ['run', 'datasetQuestions', i];
    if (ids.has(q.id)) refuse([...at, 'id'], `duplicate dataset question id \`${q.id}\``);
    if (takenIds.has(q.id)) refuse([...at, 'id'], `\`${q.id}\` is already a question or operation id: every turn of a run needs a step name of its own`);
    ids.add(q.id);
    // Each word is one the ask writes, and each language of the ask writes one of the words.
    const texts = askTexts(q.ask);
    q.words.forEach((w, j) => {
      if (!texts.some(([, t]) => folded(t).includes(folded(w)))) refuse([...at, 'words', j], `no language of the ask writes \`${w}\``);
    });
    for (const [lang, t] of texts) {
      if (!q.words.some((w) => folded(t).includes(folded(w)))) refuse([...at, 'ask', lang], `the ask writes none of the question's words (${q.words.map((w) => `\`${w}\``).join(', ')})`);
    }
    const e = q.expect;
    const measureHits = (w: string) => hitsOf(measures, w).map(memberKey);
    if (e.kind === 'metric_selected') {
      if (measureOf(e.dataset, e.measure) === undefined) {
        refuse([...at, 'expect'], `no dataset \`${e.dataset}\` with a measure \`${e.measure}\``);
        return;
      }
      q.words.forEach((w, j) => {
        const hits = measureHits(w);
        if (hits.length !== 1 || hits[0] !== memberKey(e)) {
          refuse([...at, 'words', j], `\`${w}\` must match exactly the one measure \`${memberKey(e)}\` (ADR-0149 D3 rule 2), and matches ${hits.length ? hits.map((h) => `\`${h}\``).join(', ') : 'none'}`);
        }
      });
    } else if (e.kind === 'asked_back') {
      const missing = e.candidates.filter((c) => measureOf(c.dataset, c.measure) === undefined);
      if (missing.length) {
        refuse([...at, 'expect', 'candidates'], `no such measure: ${missing.map((c) => `\`${memberKey(c)}\``).join(', ')}`);
        return;
      }
      const want = e.candidates.map(memberKey).sort();
      if (e.reason === 'ambiguous') {
        if (want.length < 2) refuse([...at, 'expect', 'candidates'], 'an ambiguous word answers to two measures or more: name each');
        q.words.forEach((w, j) => {
          const hits = measureHits(w).sort();
          if (hits.join(',') !== want.join(',')) {
            refuse([...at, 'words', j], `\`${w}\` must match exactly the candidates ${want.map((h) => `\`${h}\``).join(', ')} (ADR-0149 D3 rule 3), and matches ${hits.length ? hits.map((h) => `\`${h}\``).join(', ') : 'none'}`);
          }
        });
      } else {
        q.words.forEach((w, j) => {
          const hits = hitsOf(members, w);
          if (hits.length) refuse([...at, 'words', j], `a near-miss word matches no member, and \`${w}\` matches ${hits.map((h) => `\`${memberKey(h)}\``).join(', ')}`);
          for (const c of e.candidates) {
            if (!isNearMiss(measureOf(c.dataset, c.measure)!, w)) refuse([...at, 'words', j], `\`${w}\` is not near \`${memberKey(c)}\`: none of its words holds it or is held by it`);
          }
        });
      }
    } else {
      if (!objects.has(e.object)) refuse([...at, 'expect', 'object'], `\`${e.object}\` is not in expect.objects`);
      if (covered.has(e.object)) refuse([...at, 'expect', 'object'], `\`${e.object}\` is a dataset's base object: a fallback question asks about an object no dataset covers`);
      q.words.forEach((w, j) => {
        const hits = hitsOf(members, w);
        if (hits.length) refuse([...at, 'words', j], `a fallback word matches no member (ADR-0149 D3 rule 4), and \`${w}\` matches ${hits.map((h) => `\`${memberKey(h)}\``).join(', ')}`);
      });
    }
  });
}
