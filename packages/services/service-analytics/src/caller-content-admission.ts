// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CALLER-CONTENT admission this service asks at the door, ahead of every
 * strategy and every security provider — the sibling of the field-level gate in
 * `field-read-admission.ts`, asking a different question.
 *
 * ## Why a second admission, and why 400 not 403
 *
 * A caller supplies content at query time on two doors: the inline `dataset`
 * POSTed to `/analytics/dataset/query` (every dimension/measure `field` and the
 * dataset's own filter are the caller's text) and the member spellings POSTed to
 * `/analytics/query` (a member the authored cube does not declare is compiled
 * from the caller's own spelling). A dimension/measure `field`, a filter member,
 * or an undeclared member spelling is a `z.string()` on the wire with no
 * identifier shape enforced, and `NativeSQLStrategy` compiles a value that is not
 * an identifier straight into its statement (`qualifyAndRegisterJoin` returns a
 * non-identifier as written). Such a value names no attributable field, so the
 * object-level gate (base object only) and the field-level gate (which resolves
 * each member to a field) have nothing to judge — and a value derived from
 * columns, or a subquery over another object, reaches the statement with no
 * verdict reached for what it reads.
 *
 * ADR-0021's author surface is "zero raw expressions": a value derived from
 * columns is declared, not written as SQL. Decision card #20943 (ruling D)
 * retired a raw expression from an AUTHORED cube member's `sql` at the spec
 * contract; caller-supplied content at query time is the stricter case, and this
 * module is its door. A caller-supplied member whose text is not a plain column
 * reference the admission can judge is an INVALID request — `INVALID_FIELD` /
 * 400, the invalid-member envelope the neighbouring member-level gates already
 * answer (`dataset-refusal.ts`), naming the member the caller can find in the
 * body they sent — for EVERY caller, admin included, and whether or not a
 * security provider is wired. It is an invalid query, not a permission verdict:
 * no grant makes raw caller text judgeable, and a deployment with no security
 * service must refuse it exactly as one with a security service does.
 *
 * ## The boundary with the field-level gate
 *
 * This gate judges CALLER content: the inline dataset's own fields and filter,
 * and a member spelling the authored cube does NOT declare. A DECLARED member of
 * an authored (registry) cube whose `sql` is an expression is NOT caller content
 * — it is an operator-configured cube built before the parse refused expressions
 * (or never put through it), and it stays the field-level gate's to refuse
 * (`PERMISSION_DENIED` / 403, `field-read-admission.ts`, #20965). This module
 * never looks at a declared member's `sql`; it refuses only what the caller spelled.
 *
 * ## Disclosure
 *
 * The refusal names the member AS THE CALLER SPELLED IT (a dataset dimension's
 * `name`, or the member string the query carried) and the request key — never
 * the `field` expression text behind a named dataset member, which is content
 * the gate could not judge and so must not echo back.
 */

import type { Cube } from '@objectstack/spec/data';
import type { Dataset } from '@objectstack/spec/ui';
import type { AnalyticsQuery, DatasetSelection } from '@objectstack/spec/contracts';
import { invalidMemberError, type AnalyticsRequestKey } from './dataset-refusal.js';
import { normalizeAnalyticsFilterTree, collectFilterLeaves, NO_DATETIME_COLUMNS } from './strategies/filter-normalizer.js';

/**
 * A plain column reference the admission can judge: a bare identifier
 * (`amount`), a relationship path of bare identifiers ending in a column
 * (`account.region`), or `'*'` (which reads no field value — the count
 * wildcard). The same grammar as `@objectstack/spec`'s `CUBE_MEMBER_SQL` (the
 * authored-cube contract since #20943) and the field-level gate's
 * bare-identifier / identifier-path pair, so the three agree on what is a column
 * and what is an expression. Anything else — whitespace, an operator, a paren, a
 * quote, a subquery — is an expression this gate refuses.
 */
export const COLUMN_REFERENCE = /^(?:\*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;

/** Whether `value` is a plain column reference ({@link COLUMN_REFERENCE}). */
export function isColumnReference(value: unknown): value is string {
  return typeof value === 'string' && COLUMN_REFERENCE.test(value.trim());
}

/**
 * The refusal — `INVALID_FIELD` / 400, the invalid-member envelope — naming the
 * member as the caller spelled it and the request key. ⛔ Never carries the
 * `field` expression behind a named dataset member.
 */
function refuse(member: string, param: AnalyticsRequestKey | undefined, cube: string | undefined): never {
  throw invalidMemberError(
    `[Analytics] member "${member}" is not a column reference — not a field, a relationship path ending ` +
      'in one, or a declared dimension or measure name. A query-time member must name a column; a value ' +
      'derived from columns is declared on a dataset, not written as an expression (ADR-0021), so the ' +
      'query was not run.',
    { member, ...(param ? { param } : {}), ...(cube ? { cube } : {}) },
  );
}

/** The leaf member names a `FilterCondition` reads, best-effort (a malformed filter is refused downstream). */
function filterLeafMembers(where: unknown): string[] {
  if (!where || typeof where !== 'object') return [];
  try {
    return collectFilterLeaves(normalizeAnalyticsFilterTree({ where }, NO_DATETIME_COLUMNS)).map((leaf) => leaf.member);
  } catch {
    return [];
  }
}

/**
 * Refuse a CALLER-SUPPLIED inline dataset (and its presentation filter) that
 * names a value which is not a column reference — before it is compiled to a
 * cube, so no expression ever reaches a strategy. Every dimension's `field`,
 * every non-derived measure's `field`, the dataset's own `filter` and the
 * selection's `runtimeFilter` are the caller's text. A derived measure
 * references other measures BY NAME (the spec enforces that), so it carries no
 * field to judge here.
 */
export function assertDatasetContentJudgeable(dataset: Dataset, selection?: DatasetSelection): void {
  for (const d of dataset.dimensions ?? []) {
    if (typeof d.field === 'string' && !isColumnReference(d.field)) refuse(d.name, 'dimensions', dataset.name);
  }
  for (const m of dataset.measures ?? []) {
    if (m.derived) continue;
    if (typeof m.field === 'string' && m.field !== '' && !isColumnReference(m.field)) {
      refuse(m.name, 'measures', dataset.name);
    }
  }
  for (const member of filterLeafMembers((dataset as { filter?: unknown }).filter)) {
    if (!isColumnReference(member)) refuse(member, 'where', dataset.name);
  }
  for (const member of filterLeafMembers((selection as { runtimeFilter?: unknown } | undefined)?.runtimeFilter)) {
    if (!isColumnReference(member)) refuse(member, 'where', dataset.name);
  }
}

/**
 * Refuse a CALLER-SUPPLIED query member that the cube does NOT declare and that
 * is not a column reference — the `/analytics/query` door's equivalent of the
 * inline dataset's `field`. A declared member resolves to the cube's own `sql`
 * (judged by the field-level gate); a member the cube does not declare is
 * compiled from the caller's own spelling, so an expression there is caller text
 * and is refused here. Measures are left out: an undeclared measure is refused as
 * an unknown measure by the strategy chain, and a declared one is authored.
 *
 * Harmless on the compiled-dataset path: its members are declared in the
 * compiled cube and its `field`s were already judged by
 * {@link assertDatasetContentJudgeable} at the dataset door.
 */
export function assertQueryMembersJudgeable(query: AnalyticsQuery, cube: Cube): void {
  const dims = (cube as { dimensions?: Record<string, unknown> }).dimensions;
  const measures = (cube as { measures?: Record<string, unknown> }).measures;
  const declared = (member: string): boolean =>
    (!!dims && Object.prototype.hasOwnProperty.call(dims, member)) ||
    (!!measures && Object.prototype.hasOwnProperty.call(measures, member));
  const check = (member: unknown, param: AnalyticsRequestKey | undefined): void => {
    if (typeof member !== 'string' || member === '') return;
    if (declared(member) || isColumnReference(member)) return;
    refuse(member, param, (cube as { name?: string }).name);
  };
  for (const member of query.dimensions ?? []) check(member, 'dimensions');
  for (const td of query.timeDimensions ?? []) check(td?.dimension, 'timeDimensions');
  for (const member of filterLeafMembers((query as { where?: unknown }).where)) check(member, 'where');
  const order = (query as { order?: unknown }).order;
  if (order && typeof order === 'object' && !Array.isArray(order)) {
    for (const key of Object.keys(order)) check(key, undefined);
  }
}
