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
const V17_EXPECTED = { create: true, import: true, edit: true, delete: true, exportCsv: true };

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

  it('resolves the full-CRUD matrix from the bucket default alone', () => {
    expect(resolveCrudAffordances(SysUserPreference as never)).toEqual(V17_EXPECTED);
  });

  it('is write-equivalent to its v16 self on create / edit / delete / exportCsv', () => {
    const v16 = resolveCrudAffordances(asV16 as never);
    const v17 = resolveCrudAffordances(SysUserPreference as never);
    expect(v16).toEqual(V16_EXPECTED);
    for (const verb of ['create', 'edit', 'delete', 'exportCsv'] as const) {
      expect(v17[verb], `sys_user_preference.${verb} must not move`).toBe(v16[verb]);
    }
  });

  it('gains CSV import — the one adjudicated delta, pinned so it cannot move silently', () => {
    expect(resolveCrudAffordances(asV16 as never).import).toBe(false);
    expect(resolveCrudAffordances(SysUserPreference as never).import).toBe(true);
  });
});
