// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3355 — `sys_user_preference`'s half of the `managedBy: 'system'` →
 * `'system-data'` equivalence pin. See the sibling files in `plugin-security` and
 * `service-messaging` for the full rationale.
 *
 * This is the object that decided the NAMING. The first adjudication on #3355
 * proposed reusing `config`; `sys_user_preference` is what refuted it — a row here
 * is authored by the user from their own settings page under an RLS self-grant,
 * not by an admin, so `config` ("admin authored") would have been a fresh overload
 * on day one of the bucket that exists to end an overload. It is also why the
 * bucket is `system-data` and not `platform`: the user owns the DATA, but the
 * SCHEMA is the platform's and no tenant may model it.
 */

import { describe, expect, it } from 'vitest';
import { resolveCrudAffordances } from '@objectstack/spec/data';
import { SysUserPreference } from './sys-user-preference.object.js';

const V16_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };
/**
 * Byte-identical to {@link V16_EXPECTED} since #4671 narrowed the bucket default's
 * `import` to opt-in — kept as its own constant so a future move of EITHER side
 * shows up as a diff rather than being absorbed by a shared literal.
 */
const V17_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };

/**
 * The v16 shape, reconstructed via `engine-owned` — which ADR-0103 D5 gave the
 * byte-identical locked default row `system` carried in v16. The retired literal
 * cannot be used: v17 deleted its row from `CRUD_AFFORDANCE_DEFAULTS`, so it would
 * fall through to the `platform` default and reconstruct the wrong baseline. The
 * `toEqual(V16_EXPECTED)` assertion below keeps the stand-in honest.
 */
const asV16 = { managedBy: 'engine-owned', userActions: { create: true, edit: true, delete: true } };

describe('#3355 — sys_user_preference moves to `system-data` with its affordances intact', () => {
  it('declares the new bucket and no longer carries a redundant `userActions` block', () => {
    expect(SysUserPreference.managedBy).toBe('system-data');
    expect(SysUserPreference.userActions).toBeUndefined();
  });

  it('resolves create / edit / delete / exportCsv — but NOT import — from the bucket default alone', () => {
    expect(resolveCrudAffordances(SysUserPreference as never)).toEqual(V17_EXPECTED);
  });

  it('is affordance-equivalent to its v16 self on EVERY verb, import included (#4671)', () => {
    const v16 = resolveCrudAffordances(asV16 as never);
    const v17 = resolveCrudAffordances(SysUserPreference as never);
    expect(v16).toEqual(V16_EXPECTED);
    for (const verb of ['create', 'import', 'edit', 'delete', 'exportCsv'] as const) {
      expect(v17[verb], `sys_user_preference.${verb} must not move`).toBe(v16[verb]);
    }
    expect(v17).toEqual(v16);
  });

  it('keeps CSV import opt-IN — off by bucket default, reachable only by declaring it (#4671)', () => {
    expect(resolveCrudAffordances(SysUserPreference as never).import).toBe(false);
    const optedIn = resolveCrudAffordances({ ...SysUserPreference, userActions: { import: true } } as never);
    expect(optedIn.import).toBe(true);
    expect({ ...optedIn, import: false }).toEqual(V17_EXPECTED);
  });
});
