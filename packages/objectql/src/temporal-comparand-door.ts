// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8690] The TEMPORAL-comparand door, at the engine's single filter collection
 * point — the third gate on the seam that already carries the #5869 shape gate
 * and the #8296 unmaterializable-field gate, answering a third question about
 * the same predicate: *can the column's own storage rule read this value at
 * all.*
 *
 * ## The defect
 *
 * A `datetime` field filtered with a bare string the API cannot take literally
 * was bound as-is, compared false for every row, and answered `HTTP 200` with
 * an empty result set and no diagnostic. Measured end to end on a real driver
 * with a declared `datetime` field, 51 rows seeded / 38 in-window:
 *
 * ```
 * $gte "last_30_days"       HTTP 200  count=0    <- silent zero (the defect)
 * $gte "not-a-date-at-all"  HTTP 200  count=0    <- silent zero
 * $gte "{30_days_ago}"      HTTP 200  count=38   <- positive control
 * $gte "{TODAY}"            REFUSED   FILTER_TOKEN_UNKNOWN / 400
 * $gte "{not_a_token}"      REFUSED   FILTER_TOKEN_UNKNOWN / 400
 * ```
 *
 * The asymmetry is the whole card: an unknown `{placeholder}` is refused
 * loudly, with the resolvable tokens listed — while a bare string that is not a
 * date is not validated anywhere. And `last_7_days` / `last_30_days` /
 * `last_90_days` are REAL declared preset names in the dashboard schema. The
 * shipped console lowers them to `{N_days_ago}` macros before they reach the
 * API, so the console path is safe; a saved report, an integration, an MCP
 * client or an AI-authored query sends the preset name itself and gets a silent
 * zero. An empty chart is the hardest failure to debug — indistinguishable from
 * "there is genuinely no data", and it cost one downstream project a
 * workaround, a CI guard and three re-measurements over three weeks.
 *
 * ## Why HERE — the ruling, and the two seams that measurement ruled out
 *
 * Maintainer ruling, 2026-08-15 (delegated adjudication) — option B, with C
 * shipped alongside, explicitly not A:
 *
 * > refuse the uninterpretable temporal comparand at the ObjectQL engine's
 * > single filter collection point, per the #7872 precedent and the 2026-08-12
 * > Q1=B ruling ("the door refuses or narrows every comparand BEFORE the driver
 * > runs").
 *
 * Refusing "a comparand a temporal field cannot interpret" requires holding the
 * comparand and the field's declared TYPE at the same moment, and two earlier
 * seams were measured and cannot:
 *
 * - `packages/core`'s `resolveFilterTokens` is field-AGNOSTIC by construction —
 *   its context is `now` / `timezone` / `userId` / `orgId`, it never sees an
 *   object or a field, and it returns the tree by reference for every
 *   non-placeholder string.
 * - `packages/rest` binds no comparands at all (zero hits for
 *   `temporalFilterValue` / `coerceFilterValue` / `storageDatetimeValue` under
 *   its `src`, against 8 files under `packages/drivers` — the reverse-check that
 *   makes the zero non-vacuous).
 *
 * The only other seam holding both facts is the driver layer — four packages
 * each mirroring one function, under the #5499 investment freeze, where the
 * pass-through is a DELIBERATE contract with counter-pins asserting it
 * (`sql-driver-temporal-dialect.test.ts` asserts
 * `temporalFilterValue('t','at','not-a-date') === 'not-a-date'` on purpose) and
 * where `storageDatetimeValue` is shared with the WRITE path and the legacy
 * read-repair, so refusing there would also reject ingest of pre-convention
 * data. That option was rejected by name.
 *
 * This seam has what neither of the others has: `lowerWhereFilterArray` is
 * handed `this._registry.getObject(object)` — the declared field map — at the
 * moment it sees the caller's `where`, on every verb (`find` / `findOne` /
 * `count` / `aggregate` / `update` / `delete`), through both doors (the array
 * sugar and the already-lowered `FilterCondition` object the protocol face
 * hands over). One gate, four backends inherit one answer.
 *
 * ## Envelope
 *
 * `INVALID_FILTER` / 400 — this package's VALUE-shape envelope (#5869 / #7047),
 * reused rather than minted, because the verdict is about the comparand's
 * value. Its neighbour {@link assertFilterIsMaterializable} answers
 * `INVALID_FIELD` for the deliberately different fact that the NAME has no
 * column. Not `FILTER_TOKEN_UNKNOWN` either: nothing here is a token, and
 * borrowing that code would send a caller looking for a placeholder they never
 * wrote.
 *
 * ## Scope — three boundaries, each ruled rather than chosen here
 *
 * - **Non-empty strings only.** The empty-string cell stays its own card by
 *   ruling ("B and C scope to non-empty strings and must not decide it in
 *   passing"); measured, `$gte ""` binds as `''` and returns every non-null row
 *   — 51 of 51, not the 38 the card's table records, which is a transcription
 *   error its own prose corrects.
 * - **`{placeholder}` strings are stepped around**, not judged. This gate runs
 *   BEFORE `resolveWhereTokens` (which is where it must run — the refusal has
 *   to precede the driver), so judging one would refuse `{30_days_ago}`, the
 *   platform's own correct spelling. Unknown tokens keep their existing loud
 *   refusal one layer down.
 * - **Non-string comparands are not judged.** A number is epoch milliseconds
 *   and a `Date` is an instant; both are read correctly today.
 *
 * @see `@objectstack/core`'s `temporal-comparand.ts` — the value-half predicate,
 *   shared with the analytics raw-SQL decline so one rule cannot exist twice.
 * @see https://github.com/objectstack-ai/objectstack/issues/8690
 */

import {
  isUninterpretableTemporalComparand,
  temporalComparandKind,
  type TemporalComparandKind,
} from '@objectstack/core';
import { invalidFilterError } from './filter-comparand-shape.js';

/** What the door found, for the message and for the analytics-side decline. */
export interface UninterpretableTemporalComparand {
  field: string;
  kind: TemporalComparandKind;
  value: string;
  /** The `where.…` key path the offending comparand sits at. */
  path: string;
}

/**
 * A plain object — filter STRUCTURE rather than a comparand. Same
 * classification the #5869 gate and `driver-memory`'s own gate make: a `Date`
 * is a comparand even though `typeof` calls it an object.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/** A `{ $field: 'other_column' }` reference is not a literal — never judged. */
function isFieldReference(value: unknown): boolean {
  return isFilterNode(value) && typeof (value as { $field?: unknown }).$field === 'string';
}

/**
 * Walk one `FilterCondition` and return the FIRST comparand a declared temporal
 * field's storage rule cannot read, or `null`.
 *
 * Exported because the same walk answers the analytics strategy's routing
 * question ("would the engine door refuse this?") — though that consumer reaches
 * the value-half predicate directly, having no field map of its own.
 *
 * Structure discarded the same three conservative ways the sibling gates
 * discard it: `$and` / `$or` / `$not` are descended, any OTHER `$` key at node
 * level is skipped WITHOUT descending (an unrecognised combinator leaves the
 * fields beneath it ungated — a hole, not a false 400, which is the right
 * failure direction for a gate that exists to stop wrong answers), and a dotted
 * key names a field of a DIFFERENT object whose map this door has not resolved.
 */
export function findUninterpretableTemporalComparand(
  schema: unknown,
  where: unknown,
  path = 'where',
  depth = 0,
): UninterpretableTemporalComparand | null {
  // A registry-less host must not invent a verdict about a field map it cannot
  // see — the same early return `assertFilterIsMaterializable` makes.
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  if (depth > 32) return null;
  if (!isFilterNode(where)) return null;

  for (const [key, value] of Object.entries(where)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        for (const [index, arm] of value.entries()) {
          const hit = findUninterpretableTemporalComparand(schema, arm, `${here}[${index}]`, depth + 1);
          if (hit) return hit;
        }
      }
      continue;
    }
    if (key === '$not') {
      const hit = findUninterpretableTemporalComparand(schema, value, here, depth + 1);
      if (hit) return hit;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (key.includes('.')) continue;
    const kind = temporalComparandKind((fields[key] as { type?: unknown } | undefined)?.type);
    if (!kind) continue;
    const hit = judgeFieldComparands(kind, key, value, here);
    if (hit) return hit;
  }
  return null;
}

/** One temporal field's constraint: `{ at: <spec> }`. */
function judgeFieldComparands(
  kind: TemporalComparandKind,
  field: string,
  spec: unknown,
  path: string,
): UninterpretableTemporalComparand | null {
  // Not filter structure → an implicit-equality comparand, judged at this path.
  if (!isFilterNode(spec)) return judgeComparand(kind, field, spec, path);
  // A field spec with no `$` key is a deep-equality / nested-relation condition;
  // the #5869 gate records why descending into one would invent a contract no
  // backend agrees with.
  const keys = Object.keys(spec);
  if (!keys.some((k) => k.startsWith('$'))) return null;
  if (isFieldReference(spec)) return null;
  for (const op of keys) {
    if (!op.startsWith('$')) continue;
    const comparand = spec[op];
    // Every MEMBER of a list operator is a comparand in its own right — the
    // same split the #7872 type door makes at the shared compile face.
    if (Array.isArray(comparand)) {
      for (const [index, member] of comparand.entries()) {
        const hit = judgeComparand(kind, field, member, `${path}.${op}[${index}]`);
        if (hit) return hit;
      }
      continue;
    }
    const hit = judgeComparand(kind, field, comparand, `${path}.${op}`);
    if (hit) return hit;
  }
  return null;
}

function judgeComparand(
  kind: TemporalComparandKind,
  field: string,
  value: unknown,
  path: string,
): UninterpretableTemporalComparand | null {
  if (isFieldReference(value)) return null;
  if (!isUninterpretableTemporalComparand(kind, value)) return null;
  return { field, kind, value: value as string, path };
}

/** A short, bounded rendering — the comparand came off the wire (#5869's bound). */
function preview(value: string): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The remedy sentence, per kind. Deliberately names the platform's OWN
 * relative-date spelling first: the measured caller is one holding a declared
 * preset name (`last_30_days`) that the console would have lowered to
 * `{30_days_ago}`, so the fix a caller needs is almost always "wrap it as the
 * token the resolver knows", not "compute an instant yourself".
 */
const REMEDY: Record<TemporalComparandKind, string> = {
  datetime:
    'Write an ISO-8601 instant ("2026-07-15T00:00:00.000Z"), a bare "YYYY-MM-DD" '
    + '(read as midnight UTC), epoch milliseconds, or a relative-date placeholder the '
    + 'resolver knows, e.g. "{30_days_ago}" / "{current_month_start}".',
  date:
    'Write a "YYYY-MM-DD" calendar day, or a relative-date placeholder the resolver '
    + 'knows, e.g. "{30_days_ago}" / "{current_month_start}".',
  time:
    'Write an "HH:MM" / "HH:MM:SS" wall clock (timezone-naive, ADR-0053 D-C1).',
};

/**
 * Refuse every comparand a declared temporal field's storage rule cannot read.
 *
 * Runs on the CALLER's own `where`, before the middleware chain composes
 * RLS / sharing / tenant predicates onto the AST — deliberately, and for the
 * reason its neighbour records: an injected read filter is the platform's own,
 * not a declaration the caller can fix, and refusing one would turn a policy
 * into a 400 nobody can act on.
 */
export function assertTemporalComparandsInterpretable(
  object: string,
  operation: string,
  schema: unknown,
  where: unknown,
): void {
  const hit = findUninterpretableTemporalComparand(schema, where);
  if (!hit) return;
  throw invalidFilterError(
    `${operation}('${object}'): filter on '${hit.field}' compares a declared ${hit.kind} `
    + `field against ${preview(hit.value)} at ${hit.path}, which is not a ${hit.kind} value `
    + 'this platform can interpret. It would reach the driver as written, compare false for '
    + 'EVERY row, and return 200 with an empty result — indistinguishable from "there is no '
    + `data". The filter was NOT applied. ${REMEDY[hit.kind]}`,
  );
}
