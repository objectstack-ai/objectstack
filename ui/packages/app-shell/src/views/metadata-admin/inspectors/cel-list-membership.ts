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
 * and membership is written null-safe:
 *
 * - contains → `S != null && V in S`;
 * - does not contain → `S == null || !(V in S)`.
 *
 * Which operators a list subject takes is the shared filter builder's answer
 * (`jsonColumnFilterOperators`), read here rather than restated, so the
 * builders and the list toolbar's `FilterBuilder` cannot disagree.
 */

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
 * `subject`: `contains` ⇒ `S != null && V in S`, else its complement
 * `S == null || !(V in S)`. Both are two clauses, so a caller parenthesises
 * the result when it joins it with other terms.
 */
export function listMembershipCel(subject: string, member: string, contains: boolean): string {
  return contains ? `${subject} != null && ${member} in ${subject}` : `${subject} == null || !(${member} in ${subject})`;
}

const SUBJECT = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
const CONTAINS_RE = new RegExp(`^(${SUBJECT}) != null && (.+) in \\1$`);
const NOT_CONTAINS_RE = new RegExp(`^(${SUBJECT}) == null \\|\\| !\\((.+) in \\1\\)$`);

/**
 * Read `text` back as the membership {@link listMembershipCel} writes, or
 * `null`. Accepts exactly what the writer emits for the parts it reads — the
 * member's own text is the caller's to read as a value.
 */
export function readListMembership(text: string): { subject: string; member: string; contains: boolean } | null {
  for (const [re, contains] of [[CONTAINS_RE, true], [NOT_CONTAINS_RE, false]] as const) {
    const m = re.exec(text);
    if (m && listMembershipCel(m[1], m[2], contains) === text) return { subject: m[1], member: m[2], contains };
  }
  return null;
}
