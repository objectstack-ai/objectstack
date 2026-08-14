// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
// Explicit `.js` extension: this package resolves under NodeNext, where an
// extensionless relative import does not typecheck (its sibling suites all
// spell it this way).
import { NotificationPreference } from './notification-preference.object.js';

/**
 * #8554 — `sys_notification_preference`'s declared uniqueness is organization-scoped.
 *
 * ## What the bare spelling cost
 *
 * A DECLARED index's `unique: true` is the positional spelling of `'global'`
 * (the listed columns verbatim), so the composite `(user_id, topic, channel)` was an installation-wide key on a
 * tenant-scoped object. Measured live on a real engine BEFORE the fix, driving
 * this shipped declaration through `SqlDriver` under
 * `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_notification_preference_user_id_topic_channel
 *   on sys_notification_preference (user_id, topic, channel)
 *
 * org_jia POST (user_u1, billing.invoice, email)  → 201
 * org_yi  POST the SAME    → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused   → 201            ← the control that makes it an ORACLE
 * org_yi  GET  the key     → total 0        ← refused by a row it cannot see
 * ```
 *
 * ## Why per-organization is the CORRECT boundary, not merely the safe one
 *
 * This is the near-exact analogue of `sys_user_preference`, one of the two
 * objects the 2026-08-13 ruling named: the same archetype (a per-user K/V row)
 * and the same defect shape. The measured symptom is the one #8323 recorded —
 * a user who belongs to two organizations could not hold INDEPENDENT per-topic
 * toggles, because the first organization's row claimed the triple for the
 * whole installation.
 *
 * ⚠️ `managedBy: 'system-data'` is NOT a reason to exempt this object. The
 * already-ruled `sys_user_preference` is `system-data` too; the ruling's phrase
 * is ADMIN-AUTHORED CONTENT — the provenance of the ROWS, not the management
 * mode of the object. This object's own header records that a user authors
 * their own mute/allow rows from the Setup grid.
 *
 * ⚠️ The other COMPOSITE case, and the only one of the five whose replacement
 * index name passes `INDEX_NAME_MAX = 60` and is hash-suffixed
 * (`uniq_sys_notification_preference_a22d7d27`). Pinned driver-side.
 *
 * The materialized shape, the anti-vacuity twin (a SAME-organization duplicate
 * must still be refused), and the migration of an installation that already
 * carries the old index are pinned driver-side in
 * `driver-sql/src/sql-driver-tenant-scoped-declared-unique.test.ts`. This test
 * pins the declaration that suite's fixture copies.
 */
describe('sys_notification_preference — declared uniqueness is organization-scoped (#8554)', () => {
  const uniqueIndexes = (NotificationPreference.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (user_id, topic, channel)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual(['user_id', 'topic', 'channel']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'` — the installation-wide key that made
    // the 409 an oracle over other tenants' rows. Asserted by EQUALITY, never
    // by truthiness: a truthy check accepts the very spelling that was the bug,
    // which is how #8556's equivalent pin stayed green under its own ablation.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['user_id', 'topic', 'channel'],
      unique: 'organization',
    });
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // The driver suite hand-copies this declaration to keep the package
    // boundary (the shape #8461 and #8556 used). This assertion catches ONE
    // direction of drift:
    //
    //   caught     — the shipped declaration changes and the driver fixture
    //                does not. This test goes red.
    //   NOT caught — the DRIVER fixture is edited and this declaration is not.
    //                Nothing compares the two copies directly; they are only
    //                ever checked against this third spelling.
    //
    // Asserted on the BUILT value, which is what a driver is handed:
    // `ObjectSchema.create` normalizes an authored `{ fields: [...] }` into
    // `{ fields: [...], unique: false }`. A fixture copied from the source
    // text alone would be subtly wrong about what the driver sees.
    expect(NotificationPreference.indexes).toEqual([
      { fields: ['user_id', 'topic', 'channel'], unique: 'organization' },
      { fields: ['topic'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the BUILT value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is silently inert — a failure the index assertions above cannot see.
    const plan = resolveInjectedSystemColumns(NotificationPreference);
    expect(NotificationPreference.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });
});
