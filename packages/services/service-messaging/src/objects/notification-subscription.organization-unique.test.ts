// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
// Explicit `.js` extension: this package resolves under NodeNext, where an
// extensionless relative import does not typecheck (its sibling suites all
// spell it this way).
import { NotificationSubscription } from './notification-subscription.object.js';

/**
 * #8577 — `sys_notification_subscription`'s declared uniqueness is
 * organization-scoped.
 *
 * ## What the bare spelling cost
 *
 * A DECLARED index's `unique: true` is the positional spelling of `'global'`
 * (the listed columns verbatim), so the composite `(topic, principal)` was an
 * installation-wide key on a tenant-scoped object. Measured live on a real
 * engine BEFORE the fix, driving this shipped declaration through `SqlDriver`
 * under `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_notification_subscription_topic_principal
 *   on sys_notification_subscription (topic, principal)
 *
 * org_jia POST (billing.invoice, role:sales_manager) → 201
 * org_yi  POST the SAME     → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused    → 201            ← the control that makes it an ORACLE
 * org_yi  GET  the key      → total 0        ← refused by a row it cannot see
 * ```
 *
 * ## Why per-organization is the CORRECT boundary, not merely the safe one
 *
 * This is the direct sibling of `sys_notification_preference`, one of #8554's
 * five: same package, same directory, same ADR-0030 Layer 3, same archetype,
 * and its own header records that the rows are authored from the Setup
 * "Notification Subscriptions" grid — admin-authored content by the ruling's
 * own phrase.
 *
 * `principal` is `role:x` / `team:x` / `user:id` / a bare user id, and role and
 * position names have been per-organization since #8461 / #8556 — so
 * `role:sales_manager` denoted a DIFFERENT principal in each organization while
 * colliding on one installation-wide key. The measured symptom is #8323's: a
 * user who belongs to two organizations could not subscribe to the same topic
 * in both.
 *
 * ⚠️ `managedBy: 'system-data'` is NOT a reason to exempt this object. The
 * already-ruled `sys_user_preference` is `system-data` too; the ruling's phrase
 * is ADMIN-AUTHORED CONTENT — the provenance of the ROWS, not the management
 * mode of the object.
 *
 * ⚠️ The replacement index name is HASH-SUFFIXED
 * (`uniq_sys_notification_subscription_799a483c`): its un-truncated form is 66
 * characters, past `INDEX_NAME_MAX = 60`. The card flagged only its sibling
 * object as landing on that path; this one lands there too. Pinned driver-side.
 *
 * The materialized shape, the anti-vacuity twin (a SAME-organization duplicate
 * must still be refused), and the migration of an installation that already
 * carries the old index are pinned driver-side in
 * `driver-sql/src/sql-driver-8577-tenant-scoped-declared-unique.test.ts`. This
 * test pins the declaration that suite's fixture copies.
 */
describe('sys_notification_subscription — declared uniqueness is organization-scoped (#8577)', () => {
  const uniqueIndexes = (NotificationSubscription.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (topic, principal)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual(['topic', 'principal']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'` — the installation-wide key that made
    // the 409 an oracle over other tenants' rows. Asserted by EQUALITY, never
    // by truthiness: a truthy check accepts the very spelling that was the bug,
    // which is how the equivalent pins on #8556 and #8554 stayed green under
    // their own ablations.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['topic', 'principal'],
      unique: 'organization',
    });
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // The driver suite hand-copies this declaration to keep the package
    // boundary. This assertion catches ONE direction of drift:
    //
    //   caught     — the shipped declaration changes and the driver fixture
    //                does not. This test goes red.
    //   NOT caught — the DRIVER fixture is edited and this declaration is not.
    //                Nothing compares the two copies directly; they are only
    //                ever checked against this third spelling.
    //
    // Asserted on the BUILT value, which is what a driver is handed:
    // `ObjectSchema.create` normalizes an authored `{ fields: [...] }` into
    // `{ fields: [...], unique: false }`.
    expect(NotificationSubscription.indexes).toEqual([
      { fields: ['topic', 'principal'], unique: 'organization' },
      { fields: ['topic'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the BUILT value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is silently inert — a failure the index assertions above cannot see.
    const plan = resolveInjectedSystemColumns(NotificationSubscription);
    expect(NotificationSubscription.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });
});
