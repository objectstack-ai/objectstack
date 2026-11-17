// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset measure or dimension that declares neither `synonyms` nor a
 * `description` is advised: a question asked in a user's own words will not
 * find it.
 *
 * ## What the two keys are read for
 *
 * ADR-0149 D1 gives a dataset member its business vocabulary: `synonyms`, the
 * words a person types for it in a question, and `description`, a one- or
 * two-sentence business definition. `list_datasets` matches the terms of a
 * question against each member's `name`, `label` and `synonyms`, and hands the
 * `description` to the assistant to choose a member by and to explain a number
 * with. Both keys are optional in the schema, so a dataset that declares
 * neither parses, compiles and draws every widget bound to it. What it loses
 * is the question: a member with neither answers only to its own name and
 * label, a person who asks in other words (or in another language) matches
 * nothing, and the assistant falls back to an object query — a number no
 * dataset governs, for a metric the app does govern.
 *
 * ## What counts as declared
 *
 * - `synonyms`: an array holding at least one non-blank string.
 * - `description`: a non-blank string, or an inline locale map
 *   (`{ en, 'zh-CN' }`) with at least one non-blank value.
 *
 * One of the two is enough to silence the rule: a member with only synonyms is
 * matched, and a member with only a description can still be chosen by its
 * definition. The rule reports the member that has NEITHER, one finding per
 * member, and names the dataset and the member.
 *
 * It does not judge the words themselves. That one word names one member (a
 * synonym equal to another member's name, label or synonym) is the dataset
 * schema's refusal, and whether a synonym is a word anybody types is the
 * author's knowledge, not a static reading.
 *
 * ## Severity and doors
 *
 * `warning`, never `error`: the dataset is valid and serves every dashboard
 * and report bound to it; a dataset that only feeds charts, and that nobody
 * asks questions of, loses nothing. It runs on `os validate`, `os build`,
 * `os lint` and the runtime publish door for a `dataset` write, where it is an
 * advisory on the save response, never a refusal. Reads only the dataset's own
 * members, so it is safe on a pre- or post-parse stack and on the per-write
 * snapshot.
 *
 * Its reach ends at those doors. Metadata a plugin contributes at kernel
 * start, such as the platform's System Overview datasets that plugin-auth
 * registers through its runtime manifest (`datasets: SystemOverviewDatasets`),
 * is neither an authored stack nor a publish-door write, so the advisory never
 * reads it. A dataset the platform ships answers to its name and to its label
 * as served in the caller's locale: the one translation-bundle label resolved
 * along the resolver's locale chain (the requested locale by the platform
 * locale ladder, variant expansion included, then the deployment's declared
 * fallback locale, skipped when the caller's locale is the authored one), or
 * the authored label where the bundle carries none. It answers to no synonym
 * unless its source writes one.
 */

import { collectionEntries } from './collection-entries.js';

type AnyRec = Record<string, unknown>;

export const DATASET_MEMBER_NO_VOCABULARY = 'dataset-member-no-vocabulary';

export interface DatasetMemberVocabularyFinding {
  /** Always `warning`: the dataset is valid and renders; see the module note. */
  severity: 'warning';
  rule: typeof DATASET_MEMBER_NO_VOCABULARY;
  where: string;
  /** Positional config path of the member, e.g. `datasets[0].measures[2]`. */
  path: string;
  message: string;
  hint: string;
}

/** The two member groups of a dataset, with the noun a finding names a member by. */
const MEMBER_GROUPS = [
  { key: 'dimensions', kind: 'dimension' },
  { key: 'measures', kind: 'measure' },
] as const;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** At least one non-blank word in the member's `synonyms`. */
function declaresSynonyms(member: AnyRec): boolean {
  return Array.isArray(member.synonyms) && member.synonyms.some(isText);
}

/** A non-blank `description`: a string, or an inline locale map with one non-blank value. */
function declaresDescription(member: AnyRec): boolean {
  const description = member.description;
  if (isText(description)) return true;
  return isRec(description) && Object.values(description).some(isText);
}

/**
 * Flag every measure and dimension of every dataset that declares neither
 * `synonyms` nor a `description` (module note). Pure `(stack) => Finding[]`;
 * safe on pre- or post-parse stacks.
 */
export function validateDatasetMemberVocabulary(stack: AnyRec): DatasetMemberVocabularyFinding[] {
  const findings: DatasetMemberVocabularyFinding[] = [];
  for (const { rec: dataset, path } of collectionEntries(stack.datasets, 'datasets')) {
    const datasetName = typeof dataset.name === 'string' && dataset.name !== '' ? dataset.name : '(unnamed)';
    for (const { key, kind } of MEMBER_GROUPS) {
      const members = dataset[key];
      if (!Array.isArray(members)) continue;
      members.forEach((member, at) => {
        if (!isRec(member)) return;
        if (declaresSynonyms(member) || declaresDescription(member)) return;
        const memberName = typeof member.name === 'string' && member.name !== '' ? member.name : '(unnamed)';
        findings.push({
          severity: 'warning',
          rule: DATASET_MEMBER_NO_VOCABULARY,
          where: `dataset "${datasetName}" ${kind} "${memberName}"`,
          path: `${path}.${key}[${at}]`,
          // `where` names the dataset and the member; every door prints it before this sentence.
          message:
            'declares neither `synonyms` nor a `description`, so it answers only to its own name and label: ' +
            `a question asked in a user's own words will not find this governed ${kind}, and the answer ` +
            'comes from an ungoverned object query instead.',
          hint:
            'Add `synonyms`, the words a person types for it, in the language your users ask in (every ' +
            'language in the one list), and a one-sentence `description` saying what it is in business ' +
            'terms. One word names one member: a synonym may not equal another member\'s name, label or synonym.',
        });
      });
    }
  }
  return findings;
}
