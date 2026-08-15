// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysActivity } from './index.js';

/**
 * #8203 — the per-object vocabulary pin for `sys_activity.type`, extending the
 * pattern #8147 / #8315 established for `sys_audit_log.action` to the second
 * (and last) declared vocabulary this plugin owns.
 *
 * ## Why a pin, and why this object
 *
 * `validateRecord` skips `readonly` and `system` fields outright on both the
 * insert and the update branch (`objectql/src/validation/record-validator.ts`),
 * so the `invalid_option` check that enforces a `select` field's declared
 * options never runs for one. Every `sys_activity` field is `readonly: true`,
 * which makes its eleven-value `type` enum **documentation, not a contract**:
 * an undeclared value is written silently, and narrowing the enum away from a
 * value a writer still emits is equally silent.
 *
 * That is measured, not assumed — the sibling file
 * `../activity-type-vocabulary-enforcement.test.ts` drives the real engine and
 * shows both halves, against a control that proves the measurement can fail.
 * This file is the DECLARATIVE half: the writer census, written as literals.
 *
 * The two halves are not redundant, and the asymmetry is the reason both
 * exist. Narrowing the enum away from a live writer changes NO behavior — the
 * writer keeps writing, the row keeps landing, every behavioral assertion stays
 * green. Only a literal inventory can go red on that, which is exactly the trap
 * #8147 walked into with `import` and escaped by reading the writer rather than
 * by any instrument.
 *
 * ## The expectations are literals on purpose
 *
 * A test that read the allowed set out of the object and asserted the object
 * matched it could not fail — expectation and reality would derive from the
 * same source (the #8147 rule, kept).
 *
 * ## What this file does NOT claim
 *
 * The seven values in `TYPES_WITHOUT_WRITER_AT_CENSUS` are recorded as a
 * **snapshot of a search**, never as an eternal truth: a pin asserting "nothing
 * writes this" goes green forever whether or not it stays true, and #8147's
 * `import` is the standing proof that such a premise is often false — it
 * survived retirement only because a writer nobody had looked for turned out to
 * exist. So nothing here retires anything. Retiring a value from a compliance
 * vocabulary is a maintainer ruling (the 2026-08-12 ruling on #7675 is what
 * authorised #8147's two removals); this file only guarantees that the census
 * is REDONE whenever the enum moves, by failing until the inventory below is
 * brought back into agreement with the declaration.
 *
 * ## A writerless value is not a dead value — there is a downstream READER
 *
 * Recorded because it changes what "no writer" licenses. objectui's
 * `packages/plugin-detail/src/renderers/recordActivityFeed.ts` maps
 * `sys_activity.type` onto a feed item type, and its key set is set-equal to
 * this enum today — the seven writerless values included. Six carry a
 * deliberate rendering decision (`assigned` / `shared` map to `field_change`,
 * `system` to `system`; `commented` / `mentioned` / `login` / `logout` are
 * dropped as not-record-activity). So a writer census answers "may this value
 * be retired?" only in part: a second consumer sits across a repo boundary,
 * and nothing in this file covers it.
 *
 * That mirror is unguarded in both directions — objectui pins its key set
 * against a hardcoded literal rather than against this declaration, so an
 * addition here does not reach it. Filed as #8852; deliberately NOT asserted
 * here, since this package cannot import objectui.
 */

/**
 * Values with a writer that is known, named and (for the first four) measured
 * end-to-end by the sibling enforcement test.
 *
 * Adding a row here is a claim that a writer exists at the named location. Add
 * the writer first.
 */
const TYPES_WITH_WRITERS: ReadonlyArray<readonly [type: string, writer: string]> = [
  ['created', 'plugin-audit/src/audit-writers.ts — activityTypeFor(afterInsert)'],
  ['updated', 'plugin-audit/src/audit-writers.ts — activityTypeFor(afterUpdate)'],
  ['deleted', 'plugin-audit/src/audit-writers.ts — activityTypeFor(afterDelete)'],
  [
    'completed',
    'author-declared `activityMilestones[].type` (ADR-0052 §5b.2), applied by '
      + 'audit-writers.ts `if (milestone.type) activityType = milestone.type`. Shipped '
      + 'declaration: examples/app-showcase/src/data/objects/task.object.ts — '
      + "{ field: 'status', value: 'done', type: 'completed' }.",
  ],
];

/**
 * Values that carried no writer at the #8203 census (2026-08-15). Recorded, not
 * retired — and the second element says what was actually searched, so the next
 * author can judge the sweep instead of trusting it.
 *
 * The sweep, and its control: the only `sys_activity` write site in the repo is
 * `audit-writers.ts` (`sys.object('sys_activity').create(activityRow)`). The
 * same search shape run against `sys_audit_log` returns FOUR distinct writers,
 * including `plugin-auth/src/admin-import-users.ts` — the one #8147 nearly
 * missed — so the technique demonstrably finds writers when they exist. Beyond
 * that single site the only other way into this column is an author-declared
 * milestone `type`, which is why `completed` is in the list above.
 */
const TYPES_WITHOUT_WRITER_AT_CENSUS: ReadonlyArray<readonly [type: string, searched: string]> = [
  ['commented', 'no writer: sys_comment hooks write comment rows, never a sys_activity row'],
  ['mentioned', 'no writer: the @mention hook notifies; it emits no activity row'],
  ['shared', 'no writer: sharing writes sys_share* rows, never a sys_activity row'],
  ['assigned', 'no writer: no assignment path emits an activity row'],
  [
    'login',
    'no writer ON THIS OBJECT — the asymmetry worth noting: auth-event-audit.ts DOES '
      + 'record login, but into `sys_audit_log` (action: login), never into the activity '
      + 'stream',
  ],
  ['logout', 'no writer on this object; same auth-event-audit.ts asymmetry as `login`'],
  ['system', 'no writer: no code path emits this value'],
];

/** Option values declared by the `type` select field. */
function typeValues(): string[] {
  const field = (SysActivity as { fields?: Record<string, { options?: unknown }> })
    .fields?.type;
  const options = (field?.options ?? []) as Array<string | { value?: string }>;
  return options.map((o) => (typeof o === 'string' ? o : String(o.value)));
}

describe('sys_activity — the `type` vocabulary is pinned to a writer census (#8203)', () => {
  /**
   * The load-bearing assertion. Set equality in both directions, against the
   * UNION of the two inventories: every declared value has a recorded
   * disposition, and every recorded disposition names a declared value.
   *
   * This is what forces the census to be redone. Adding a value to the enum
   * without inventorying it goes red; deleting one without removing its row
   * goes red. Neither is detectable any other way on this object — the field is
   * `readonly`, so no write is ever validated against this enum.
   */
  it('every declared type has a recorded disposition, and vice versa', () => {
    const declared = [...typeValues()].sort();
    const inventoried = [
      ...TYPES_WITH_WRITERS.map(([t]) => t),
      ...TYPES_WITHOUT_WRITER_AT_CENSUS.map(([t]) => t),
    ].sort();
    expect(
      declared,
      'sys_activity.type and the writer census in this file disagree. Nothing else in '
        + 'the repo can detect this: every field on this object is `readonly: true` and '
        + '`validateRecord` skips readonly fields, so no write is ever checked against '
        + 'this enum in either direction (#8203).\n'
        + 'Added a value? Name its writer in TYPES_WITH_WRITERS — a declared type with '
        + 'no writer is a permanently empty timeline filter (审计面宁窄勿谎, ruling '
        + '2026-08-12).\n'
        + 'Removed one? Delete its row here, and check first that it had no writer: '
        + 'narrowing this enum away from a live writer makes the platform write a value '
        + 'its own contract denies, silently. That is exactly what #8147 nearly did to '
        + "`sys_audit_log.action`'s `import`.\n"
        + 'Census on record:\n'
        + TYPES_WITH_WRITERS.map(([t, w]) => `  ${t} ← ${w}`).join('\n') + '\n'
        + TYPES_WITHOUT_WRITER_AT_CENSUS.map(([t, s]) => `  ${t} — ${s}`).join('\n'),
    ).toEqual(inventoried);
  });

  /**
   * The #8147 `import` lesson as a standing assertion: a value with a KNOWN
   * writer must not leave the enum. Redundant with the set equality above only
   * while both inventories are correct — this one keeps naming the writer in
   * the failure message, so the author who deletes the value is told what
   * writes it before they conclude nothing does.
   */
  it.each(TYPES_WITH_WRITERS)(
    '%s stays declared — it has a live writer',
    (type, writer) => {
      expect(
        typeValues(),
        `sys_activity.type '${type}' must stay declared: it is written by ${writer}. `
          + 'Removing it makes the enum deny a value the platform writes — and silently, '
          + 'because readonly fields are never validated (#8203). If it must go, the '
          + 'WRITER goes first.',
      ).toContain(type);
    },
  );

  /**
   * The census is only closed while nothing outside this repo can write the
   * column. `apiMethods: ['get', 'list']` is what makes the sweep above a
   * complete enumeration rather than a sample: with no REST write verb, every
   * writer is in-process and greppable. Granting one would silently reopen the
   * question — any API client could then write any string into this enum — so
   * the premise is pinned rather than assumed.
   */
  it('no REST write verb is exposed, which is what closes the writer census', () => {
    const methods = ((SysActivity as { enable?: { apiMethods?: string[] } })
      .enable?.apiMethods ?? []) as string[];
    expect(
      methods.filter((m) => ['create', 'update', 'delete', 'upsert'].includes(m)),
      'sys_activity has been granted a REST write verb. The writer census in this file '
        + 'assumes every writer is in-process and therefore greppable; an API write verb '
        + 'lets any client put any string into the `type` column, unvalidated (the field '
        + 'is readonly, so `validateRecord` skips it). Re-open #8203 before doing this.',
    ).toEqual([]);
  });
});
