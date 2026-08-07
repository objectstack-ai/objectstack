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
import { NotificationTemplate } from './notification-template.object.js';
import { NotificationSubscription } from './notification-subscription.object.js';
import { NotificationPreference } from './notification-preference.object.js';

const V16_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };
/**
 * Byte-identical to {@link V16_EXPECTED} since #4671 narrowed the bucket default's
 * `import` to opt-in — kept as its own constant so a future move of EITHER side
 * shows up as a diff rather than being absorbed by a shared literal.
 */
const V17_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };

/**
 * The v16 declaration shape, reconstructed so the equivalence is COMPUTED rather
 * than asserted twice.
 *
 * It is spelled `engine-owned`, not `system`, on purpose: v17 deleted the `system`
 * row from `CRUD_AFFORDANCE_DEFAULTS`, so passing the retired literal would fall
 * through to the `platform` default and quietly reconstruct the wrong baseline
 * (that mistake is what this comment exists to prevent — it read green-ish and was
 * wrong). ADR-0103 D5 gave `engine-owned` the byte-identical locked row `system`
 * carried in v16 — `{create,import,edit,delete: false, exportCsv: true}` — so it is
 * an exact stand-in for the old bucket default. `expect(v16).toEqual(V16_EXPECTED)`
 * below is the check that this stand-in stayed honest.
 */
const asV16 = (obj: { userActions?: unknown }) => ({
  managedBy: 'engine-owned',
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

      it('resolves create / edit / delete / exportCsv — but NOT import — from the bucket default alone', () => {
        expect(resolveCrudAffordances(obj as never)).toEqual(V17_EXPECTED);
      });

      it('is affordance-equivalent to its v16 self on EVERY verb, import included (#4671)', () => {
        const v16 = resolveCrudAffordances(asV16(obj) as never);
        const v17 = resolveCrudAffordances(obj as never);
        expect(v16).toEqual(V16_EXPECTED);
        for (const verb of ['create', 'import', 'edit', 'delete', 'exportCsv'] as const) {
          expect(v17[verb], `${name}.${verb} must not move`).toBe(v16[verb]);
        }
        expect(v17).toEqual(v16);
      });

      it('keeps CSV import opt-IN — off by bucket default, reachable only by declaring it (#4671)', () => {
        expect(resolveCrudAffordances(obj as never).import).toBe(false);
        const optedIn = resolveCrudAffordances({ ...obj, userActions: { import: true } } as never);
        expect(optedIn.import).toBe(true);
        expect({ ...optedIn, import: false }).toEqual(V17_EXPECTED);
      });
    });
  }
});
