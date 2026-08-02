// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3355 — the messaging config grids' half of the `managedBy: 'system'` →
 * `'system-data'` equivalence pin. See the sibling file in `plugin-security` for
 * the full rationale; the contract asserted here is identical.
 *
 * These three are the clearest members of the bucket the rename creates: the
 * SCHEMA ships with the platform (an admin cannot add a column to
 * `sys_notification_template`), while the DATA is authored by an admin — or, for
 * `sys_notification_preference`, by the end user muting their own topics — through
 * the Setup grids. That is exactly the "platform schema / your data" split
 * `system-data` names and the old `system` obscured.
 */

import { describe, expect, it } from 'vitest';
import { resolveCrudAffordances } from '@objectstack/spec/data';
import { NotificationTemplate } from './notification-template.object';
import { NotificationSubscription } from './notification-subscription.object';
import { NotificationPreference } from './notification-preference.object';

const V16_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };
const V17_EXPECTED = { create: true, import: true, edit: true, delete: true, exportCsv: true };

const asV16 = (obj: { userActions?: unknown }) => ({
  managedBy: 'system',
  userActions: obj.userActions ?? { create: true, edit: true, delete: true },
});

const OBJECTS = [
  ['sys_notification_template', NotificationTemplate],
  ['sys_notification_subscription', NotificationSubscription],
  ['sys_notification_preference', NotificationPreference],
] as const;

describe('#3355 — messaging config grids move to `system-data` with their affordances intact', () => {
  for (const [name, obj] of OBJECTS) {
    describe(name, () => {
      it('declares the new bucket and no longer carries a redundant `userActions` block', () => {
        expect(obj.managedBy).toBe('system-data');
        expect(obj.userActions).toBeUndefined();
      });

      it('resolves the full-CRUD matrix from the bucket default alone', () => {
        expect(resolveCrudAffordances(obj as never)).toEqual(V17_EXPECTED);
      });

      it('is write-equivalent to its v16 self on create / edit / delete / exportCsv', () => {
        const v16 = resolveCrudAffordances(asV16(obj) as never);
        const v17 = resolveCrudAffordances(obj as never);
        expect(v16).toEqual(V16_EXPECTED);
        for (const verb of ['create', 'edit', 'delete', 'exportCsv'] as const) {
          expect(v17[verb], `${name}.${verb} must not move`).toBe(v16[verb]);
        }
      });

      it('gains CSV import — the one adjudicated delta, pinned so it cannot move silently', () => {
        expect(resolveCrudAffordances(asV16(obj) as never).import).toBe(false);
        expect(resolveCrudAffordances(obj as never).import).toBe(true);
      });
    });
  }
});
