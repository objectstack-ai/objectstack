// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DatasetSelection } from '@objectstack/spec/contracts';
import type { Dataset } from '@objectstack/spec/ui';
import { invalidMemberError, type AnalyticsRequestKey } from './dataset-refusal.js';

/**
 * [ADR-0021, ADR-0149 D1] A dataset selection names only the members its
 * dataset declares — the one rule every face of a dataset query reads.
 *
 * The dataset is a declarative, closed surface (ADR-0021): its `measures[]`
 * and `dimensions[]` are the definition a dashboard tile, a report, the REST
 * door and the AI tool `query_dataset` all quote by name. A selection member
 * it does not declare is outside it. Before this rule the dataset path minted
 * one on the fly (`count`, a raw field read as its `sum`, a `<field>_sum`
 * suffix spelling) and grouped by a raw field named as a dimension, so a tile
 * could show a number labelled as a dataset metric the dataset never defines,
 * and two faces could disagree about the same name.
 *
 * Declared means one of the dataset's own `measures[].name` /
 * `dimensions[].name`, spelled exactly so: a `<dataset>.`-qualified spelling
 * is not a declared name and is refused too. Judged in the three positions
 * that name a member — `measures`, `dimensions` and each
 * `timeDimensions[].dimension`. `order` keys and `totals.groupings` are judged
 * downstream against the selected members, so they need no second check.
 *
 * Judged against EVERY declared member, never against the caller's admitted
 * subset: a declared member the caller may not read still reaches the field
 * gate (403), unchanged. Only the refusal's list of usable members is
 * narrowed to the caller's admission (ADR-0100: a withheld member, or one
 * over an `internal` field, is never named).
 *
 * Both faces call {@link undeclaredSelectionMembers}; each words its own
 * refusal, because what the caller should do next differs (an AI caller falls
 * back to the object query tools, an author declares the member).
 */
export interface UndeclaredSelectionMember {
  /** The entry as the selection spelled it. */
  member: string;
  /** The selection key it was found under. */
  param: Extract<AnalyticsRequestKey, 'measures' | 'dimensions' | 'timeDimensions'>;
}

/**
 * The members `selection` names that `dataset` does not declare, in request
 * order, each `(member, param)` pair once. Empty when every member is
 * declared. A non-string entry is left to the selection parse, which refuses
 * it on its own terms.
 */
export function undeclaredSelectionMembers(
  dataset: Pick<Dataset, 'measures' | 'dimensions'>,
  selection: Pick<DatasetSelection, 'measures' | 'dimensions'> & { timeDimensions?: ReadonlyArray<{ dimension?: unknown } | null | undefined> },
): UndeclaredSelectionMember[] {
  const measures = new Set((dataset.measures ?? []).map((m) => m.name));
  const dimensions = new Set((dataset.dimensions ?? []).map((d) => d.name));
  const undeclared: UndeclaredSelectionMember[] = [];
  const judge = (names: readonly unknown[], declared: ReadonlySet<string>, param: UndeclaredSelectionMember['param']) => {
    for (const name of names) {
      if (typeof name === 'string' && !declared.has(name) && !undeclared.some((u) => u.member === name && u.param === param)) {
        undeclared.push({ member: name, param });
      }
    }
  };
  judge(Array.isArray(selection.measures) ? selection.measures : [], measures, 'measures');
  judge(Array.isArray(selection.dimensions) ? selection.dimensions : [], dimensions, 'dimensions');
  judge(
    (Array.isArray(selection.timeDimensions) ? selection.timeDimensions : []).map((td) => td?.dimension),
    dimensions,
    'timeDimensions',
  );
  return undeclared;
}

/** `measure "x", dimension "y"` — the members a refusal names, in request order. */
export function describeUndeclaredMembers(undeclared: readonly UndeclaredSelectionMember[]): string {
  return undeclared.map((u) => `${u.param === 'measures' ? 'measure' : 'dimension'} "${u.member}"`).join(', ');
}

/**
 * The declared member names the caller may use, in declaration order: those
 * the caller's admission admitted, or none when there is no admission.
 */
export function usableDeclaredMembers(
  declared: ReadonlyArray<{ name: string }> | undefined,
  admitted: ReadonlySet<string> | undefined,
): string[] {
  return (declared ?? []).map((m) => m.name).filter((name) => admitted?.has(name) === true);
}

/** A list for a refusal sentence: the names, or `(none)`. */
export function listMemberNames(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : '(none)';
}

/**
 * The dataset query door's refusal for a selection that names a member its
 * dataset does not declare: `INVALID_FIELD` / 400 (`invalidMemberError`,
 * `member` / `param` / `cube` of the first undeclared entry), naming every
 * undeclared member, the members THIS caller may use, and the remedy — select
 * a declared name, or declare the member on the dataset.
 */
export function undeclaredMembersRefusal(
  dataset: Pick<Dataset, 'name' | 'measures' | 'dimensions'>,
  undeclared: readonly UndeclaredSelectionMember[],
  admitted: { measures: ReadonlySet<string>; dimensions: ReadonlySet<string> } | undefined,
): Error {
  const first = undeclared[0];
  return invalidMemberError(
    `The dataset "${dataset.name}" does not declare the ${describeUndeclaredMembers(undeclared)}. A dataset query `
      + 'answers only the members its dataset declares, by their declared names. '
      + `Measures you may use: ${listMemberNames(usableDeclaredMembers(dataset.measures, admitted?.measures))}. `
      + `Dimensions you may use: ${listMemberNames(usableDeclaredMembers(dataset.dimensions, admitted?.dimensions))}. `
      + 'Use one of these, or declare the member on the dataset (its `measures` or `dimensions`) and query it by that name.',
    { member: first.member, param: first.param, cube: dataset.name },
  );
}
