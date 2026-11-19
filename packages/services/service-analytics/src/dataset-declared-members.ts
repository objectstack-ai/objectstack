// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DatasetSelection } from '@objectstack/spec/contracts';
import type { Dataset } from '@objectstack/spec/ui';
import { SnakeCaseIdentifierSchema } from '@objectstack/spec/shared';
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
  /**
   * True for a `timeDimensions` entry carrying a `dateRange` in a selection
   * that asks for a `compareTo`: the date key of a comparison window. A
   * dashboard compare widget lowers its date window into `timeDimensions`
   * under the filtered field's name, so this is how a dashboard date-range
   * field that is not also a declared dimension's name arrives here.
   */
  compareWindow?: boolean;
}

/** The selection shape {@link undeclaredSelectionMembers} reads. */
export type JudgedSelection = Pick<DatasetSelection, 'measures' | 'dimensions'> & {
  timeDimensions?: ReadonlyArray<{ dimension?: unknown; dateRange?: unknown } | null | undefined>;
  compareTo?: unknown;
};

/**
 * The members `selection` names that `dataset` does not declare, in request
 * order, each `(member, param)` pair once. Empty when every member is
 * declared. A non-string entry is left to the selection parse, which refuses
 * it on its own terms.
 */
export function undeclaredSelectionMembers(
  dataset: Pick<Dataset, 'measures' | 'dimensions'>,
  selection: JudgedSelection,
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
  const timeDimensions = Array.isArray(selection.timeDimensions) ? selection.timeDimensions : [];
  judge(timeDimensions.map((td) => td?.dimension), dimensions, 'timeDimensions');
  if (selection.compareTo != null) {
    for (const u of undeclared) {
      if (u.param === 'timeDimensions' && timeDimensions.some((td) => td?.dimension === u.member && td?.dateRange != null)) {
        u.compareWindow = true;
      }
    }
  }
  return undeclared;
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((k) => `"${k}"`);
  return quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * Whether `key` can be a declared dimension's name at all: the dataset
 * schema's own dimension-name grammar (`SnakeCaseIdentifierSchema`) decides.
 * A related record's field (`account.founded_at`) never can — the grammar
 * has no dot.
 */
function canBeDimensionName(key: string): boolean {
  return SnakeCaseIdentifierSchema.safeParse(key).success;
}

/**
 * The remedy sentence for an undeclared comparison-window date key, or `''`
 * when no undeclared member is one. A bare "not declared" does not tell a
 * dashboard author what to change: the key is the dashboard date-range field,
 * which the dashboard names against the object, not against the dataset.
 *
 * For a key that can be a dimension name it names one remedy only, declaring
 * a date dimension named after the key. Pointing the widget's
 * `compareTo.dimension` at a declared dimension is not one: the renderer
 * still lowers the dashboard's window on the undeclared field, so the
 * comparison is either dropped or refused again.
 *
 * A key that cannot be a dimension name (a dotted `relationship.field`, or any
 * key the dimension-name grammar refuses) gets no declare-it remedy, because
 * no declaration can carry that name. Its sentence says what the comparison
 * needs instead: the dashboard's date field must be a field of the dataset's
 * own object that a declared date dimension names. When the keys are mixed,
 * each kind gets its own sentence, scoped to the keys it is true for.
 */
export function compareWindowRemedy(undeclared: readonly UndeclaredSelectionMember[]): string {
  const keys = undeclared.filter((u) => u.compareWindow).map((u) => u.member);
  if (keys.length === 0) return '';
  const one = keys.length === 1;
  const nameable = keys.filter(canBeDimensionName);
  const unnameable = keys.filter((k) => !canBeDimensionName(k));
  const intro = ` ${one ? `The dimension ${quotedList(keys)} is the date key` : `The dimensions ${quotedList(keys)} are the date keys`} of `
    + `this query's comparison window (\`compareTo\`): a dashboard compare widget lowers `
    + (one
      ? 'its date window into `timeDimensions` under the filtered field\'s name, '
      : 'every date window its filter states into `timeDimensions`, each under its filtered field\'s name, ')
    + 'which is usually the dashboard date-range field.';
  const sentences: string[] = [];
  if (unnameable.length > 0) {
    const single = unnameable.length === 1;
    sentences.push(
      (single
        ? `${quotedList(unnameable)} cannot be a dimension name`
        : `${quotedList(unnameable)} cannot be dimension names`)
        + ' (a dimension name is a snake_case identifier, with no dot, so a related record\'s field is never one), '
        + `so no date dimension can be declared under ${single ? 'it' : 'them'}: this comparison cannot run on a dataset query `
        + `unless ${!single ? 'each of those date fields' : one ? 'the dashboard\'s date field' : 'that date field'} `
        + 'is a field of the dataset\'s own object that a declared date dimension names.',
    );
  }
  if (nameable.length > 0) {
    const remedy = nameable.length === 1
      ? `declare a date dimension named ${quotedList(nameable)} on the dataset (over that field).`
      : `declare a date dimension for each on the dataset, named ${quotedList(nameable)}, each over the field of the same name.`;
    // Mixed: scope the declare-it remedy to the keys it is true for.
    if (unnameable.length === 0) sentences.push(`D${remedy.slice(1)}`);
    else if (nameable.length === 1) sentences.push(`For the key that can be a dimension name, ${remedy}`);
    else sentences.push(`For the keys that can be dimension names, ${remedy}`);
  }
  return `${intro} ${sentences.join(' ')}`;
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
 * a declared name, or declare the member on the dataset. When the member is a
 * comparison window's date key ({@link compareWindowRemedy}), the refusal also
 * says what the compare widget needs: a date dimension named after the key,
 * or, for a key no dimension can be named (a related record's field), a date
 * field of the dataset's own object.
 *
 * The select-or-declare sentence covers only the members it can fix. A
 * comparison window's date key that cannot be a dimension name is never
 * covered by it: the widget sends the window under that very name, which no
 * declaration can carry. When every undeclared member is such a key, the
 * sentence is left out and the compare-window sentence is the whole remedy;
 * when some are, it names the members it is for.
 */
export function undeclaredMembersRefusal(
  dataset: Pick<Dataset, 'name' | 'measures' | 'dimensions'>,
  undeclared: readonly UndeclaredSelectionMember[],
  admitted: { measures: ReadonlySet<string>; dimensions: ReadonlySet<string> } | undefined,
): Error {
  const first = undeclared[0];
  // A comparison window's date key no dimension can be named is not fixed by
  // selecting or declaring it: compareWindowRemedy says what it needs instead.
  const fixable = undeclared.filter((u) => !(u.compareWindow && !canBeDimensionName(u.member)));
  const selectOrDeclare = fixable.length === 0
    ? ''
    : ` ${fixable.length === undeclared.length ? 'Use' : `For the ${describeUndeclaredMembers(fixable)}, use`} one of these, `
      + 'or declare the member on the dataset (its `measures` or `dimensions`) and query it by that name.';
  return invalidMemberError(
    `The dataset "${dataset.name}" does not declare the ${describeUndeclaredMembers(undeclared)}. A dataset query `
      + 'answers only the members its dataset declares, by their declared names. '
      + `Measures you may use: ${listMemberNames(usableDeclaredMembers(dataset.measures, admitted?.measures))}. `
      + `Dimensions you may use: ${listMemberNames(usableDeclaredMembers(dataset.dimensions, admitted?.dimensions))}.`
      + selectOrDeclare
      + compareWindowRemedy(undeclared),
    { member: first.member, param: first.param, cube: dataset.name },
  );
}
