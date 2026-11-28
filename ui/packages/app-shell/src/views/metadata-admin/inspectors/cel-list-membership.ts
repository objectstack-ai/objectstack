// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cel-list-membership — list membership in CEL, ONE spelling for every builder
 * that writes a condition on a list subject (objectstack#36167): the flow
 * edge's rows (`flow-edge-condition-rows.ts`, objectstack#35992) and the
 * `ConditionBuilder`.
 *
 * A list subject is a field whose stored value is a list: a `multiselect` /
 * `checkboxes` / `tags`, or a multi-capable type declared `multiple: true`.
 * Under `@objectstack/formula`'s `celEngine`, `S == V` compares the whole list
 * with one value, so it is false for every record (and `S != V` true for every
 * record); `S.contains(V)` faults ("no matching overload"); and `V in S` is
 * membership. So a list subject is offered membership and the empty checks,
 * and membership is written null-safe, in the spelling the validator's
 * `list-equality` refusal prescribes for the same site — both take it from
 * `@objectstack/formula`'s `listMembershipSource`, read here rather than
 * restated:
 *
 * - a `<root>.<field>` subject (`record.f`, `previous.f`) is `has()`-guarded,
 *   since an action row is sparse and `previous` is `null` on a create:
 *   contains → `has(S) && S != null && V in S`, does not contain →
 *   `!has(S) || S == null || !(V in S)`;
 * - a bare subject (a flow start condition's field) is `!= null`-guarded:
 *   contains → `S != null && V in S`, does not contain →
 *   `S == null || !(V in S)`.
 *
 * Which operators a list subject takes is the shared filter builder's answer
 * (`jsonColumnFilterOperators`), read here rather than restated, so the
 * builders and the list toolbar's `FilterBuilder` cannot disagree.
 */

import { listMembershipSource } from '@objectstack/formula';
import { jsonColumnFilterOperators, type FilterBuilderOperator } from '@object-ui/components';

/** The two facts that decide whether a field holds a list. */
export interface ListSubjectFacts {
  type?: string;
  multiple?: boolean;
}

/**
 * The operators the shared builder offers on a LIST subject — membership and
 * the empty checks — or `undefined` for every other field. A structured-JSON
 * field (`json`, `address`, …) takes the empty checks only and is not a list:
 * its value is an object, so it answers `undefined` here.
 */
export function listSubjectOperators(field: ListSubjectFacts): readonly FilterBuilderOperator[] | undefined {
  const ops = jsonColumnFilterOperators({ type: field.type, multiple: field.multiple === true });
  return ops?.includes('contains') ? ops : undefined;
}

/**
 * Membership of `member` (already a CEL literal or reference) in the list
 * `subject`, or its complement, as `listMembershipSource` spells it for the
 * subject's site: a subject with a root (`record.f`, `previous.f`) is a
 * `<root>.<field>` read, a subject without one a bare name. Several clauses,
 * so a caller parenthesises the result when it joins it with other terms.
 */
export function listMembershipCel(subject: string, member: string, contains: boolean): string {
  return listMembershipSource({ reference: subject, bare: !subject.includes('.') }, member, contains);
}

const SUBJECT = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
const MEMBERSHIP_SHAPES: ReadonlyArray<readonly [RegExp, boolean]> = [
  [new RegExp(`^has\\((${SUBJECT})\\) && \\1 != null && (.+) in \\1$`), true],
  [new RegExp(`^!has\\((${SUBJECT})\\) \\|\\| \\1 == null \\|\\| !\\((.+) in \\1\\)$`), false],
  [new RegExp(`^(${SUBJECT}) != null && (.+) in \\1$`), true],
  [new RegExp(`^(${SUBJECT}) == null \\|\\| !\\((.+) in \\1\\)$`), false],
];

/**
 * Read `text` back as the membership {@link listMembershipCel} writes, or
 * `null`. Accepts exactly what the writer emits for the parts it reads — the
 * member's own text is the caller's to read as a value — so a spelling the
 * writer does not use for that subject's site (an unguarded `record.f` read)
 * does not read back.
 */
export function readListMembership(text: string): { subject: string; member: string; contains: boolean } | null {
  for (const [re, contains] of MEMBERSHIP_SHAPES) {
    const m = re.exec(text);
    if (m && listMembershipCel(m[1], m[2], contains) === text) return { subject: m[1], member: m[2], contains };
  }
  return null;
}
