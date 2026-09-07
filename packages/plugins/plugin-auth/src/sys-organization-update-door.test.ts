// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15873 — the COLUMN gate on `sys_organization`, held while the METHOD gate
 * widens (maintainer ruling 2026-09-07, decision batch #64, option (a),
 * verbatim 「同意」: admit `update` in `sys_organization.apiMethods` and let the
 * ADR-0092 D2 whitelist do the column gating).
 *
 * platform-objects now declares `enable.apiMethods: ['get', 'list', 'update']`
 * plus `userActions: { edit: true }` on this table (pinned from source in
 * `sys-organization-update-door.test.ts` there). The whole safety of that
 * widening rests on this package: the identity write guard's per-object update
 * whitelist — `MANAGED_EXTENSION_EDITABLE_FIELDS.sys_organization`, registered
 * at `kernel:ready` by `auth-plugin.ts` — must keep admitting exactly the four
 * platform-owned extension columns and keep stripping everything else,
 * better-auth's own `name` / `slug` / `logo` / `metadata` included.
 *
 * Two things are held here, both derived from the SHIPPED whitelist rather
 * than re-spelled, because plugin-auth is the one package that imports both
 * the object (via `@objectstack/platform-objects`) and the guard:
 *
 *  1. the guard's verdict per payload shape — a better-auth column alone is
 *     REFUSED (403 `PERMISSION_DENIED`, the ADR-0112 envelope the REST door
 *     relays), a whitelisted column passes un-stripped, and a mixed payload
 *     lands the whitelisted column and drops the rest (the D2 strip). The
 *     stripping direction is the one that matters most: it is what makes the
 *     opening column-scoped in practice rather than in a comment;
 *  2. ADR-0092 D4's form-rendering constraint — with `userActions.edit` open,
 *     every column outside the whitelist must be `readonly` so the standard
 *     edit form cannot offer a write the server will refuse or strip, and no
 *     whitelisted column may be `readonly` (a column the form will not offer
 *     and the guard would admit is the declared-but-unreachable shape this
 *     card was filed for, one layer up). The partition is derived from the
 *     whitelist constant, so widening the whitelist without flipping the
 *     flag — or the reverse — fails here.
 *
 * The real door (`PATCH /api/v1/data/sys_organization/:id` under a signed-in
 * user, method gate and guard composed) is `organization-update-door.dogfood
 * .test.ts` in `packages/qa/dogfood`.
 */

import { describe, it, expect } from 'vitest';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
} from './identity-write-guard.js';
import { managedExtensionEditableFields } from './managed-extension-fields.js';

/** The four columns the ruling names, in the whitelist's own order. */
const RULED_COLUMNS = ['require_mfa', 'parent_organization_id', 'sort_order', 'timezone'];

/** better-auth's own organization columns on this object — protocol fields. */
const BETTER_AUTH_COLUMNS = ['name', 'slug', 'logo', 'metadata'];

/** Engine-owned lifecycle columns: readonly by their own declaration, never in play. */
const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at'];

/** Fake engine capturing hook registrations (same shape the real engine builds). */
function makeEngine(object: string, managedBy: string) {
  const handlers: Record<string, Array<(ctx: any) => Promise<void>>> = {};
  return {
    handlers,
    getSchema: () => ({ name: object, managedBy }),
    registerHook: (event: string, handler: (ctx: any) => Promise<void>) => {
      (handlers[event] ??= []).push(handler);
    },
  };
}

const USER_SESSION = { userId: 'usr_1', positions: [] };

/** Run the guard's `beforeUpdate` over `data` as a user-context write; returns the thrown error, or null. */
async function guardedUpdate(data: Record<string, unknown>): Promise<any> {
  const engine = makeEngine('sys_organization', 'better-auth');
  // The whitelist the plugin registers at `kernel:ready` is this map's row —
  // registered here from the SAME constant, so the pin reads what ships.
  registerManagedUpdateWhitelist('sys_organization', managedExtensionEditableFields('sys_organization'));
  registerIdentityWriteGuard(engine as any, { packageId: 'test.sys-organization-update-door' });
  try {
    await engine.handlers.beforeUpdate[0]({
      object: 'sys_organization',
      session: USER_SESSION,
      input: { id: 'org_1', data },
    });
    return null;
  } catch (e) {
    return e;
  }
}

describe('#15873 — the whitelist is the four ruled columns, every one a real column on the object', () => {
  it('MANAGED_EXTENSION_EDITABLE_FIELDS.sys_organization is exactly the ruled set', () => {
    expect([...managedExtensionEditableFields('sys_organization')].sort()).toEqual([...RULED_COLUMNS].sort());
  });

  it('every whitelisted name is a declared field, and every better-auth column named here is too', () => {
    const fields = Object.keys(SysOrganization.fields as Record<string, unknown>);
    for (const name of [...RULED_COLUMNS, ...BETTER_AUTH_COLUMNS, ...SYSTEM_COLUMNS]) {
      expect(fields, `${name} is declared on sys_organization`).toContain(name);
    }
    // And the three lists above partition the object: a column this file does
    // not classify is a column the D4 assertion below would judge blind.
    expect([...fields].sort()).toEqual([...RULED_COLUMNS, ...BETTER_AUTH_COLUMNS, ...SYSTEM_COLUMNS].sort());
  });
});

describe('#15873 — the guard holds the column gate on a user-context update', () => {
  it.each(BETTER_AUTH_COLUMNS)('%s alone is REFUSED — 403 PERMISSION_DENIED, never silently ignored', async (column) => {
    const data: Record<string, unknown> = { id: 'org_1', [column]: 'hijacked' };
    const err = await guardedUpdate(data);
    expect(err, `${column} must be refused`).toBeTruthy();
    // ADR-0112 envelope: code AND status. A bare `toThrow()` stays green
    // against an implementation that throws a naked `Error`.
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.status).toBe(403);
  });

  it.each(RULED_COLUMNS)('%s alone passes the guard un-stripped', async (column) => {
    const value = column === 'require_mfa' ? true : column === 'sort_order' ? 7 : column === 'timezone' ? 'Asia/Shanghai' : 'org_parent';
    const data: Record<string, unknown> = { id: 'org_1', [column]: value };
    expect(await guardedUpdate(data)).toBeNull();
    expect(data, `the guard must not strip ${column}`).toEqual({ id: 'org_1', [column]: value });
  });

  it('a mixed payload lands the whitelisted column and strips every better-auth column beside it', async () => {
    // The whitelist STRIPS non-listed keys rather than rejecting the whole
    // payload, so this is the shape that decides whether the opening is
    // column-scoped in practice: `sort_order` must survive, and `name` /
    // `slug` / `logo` / `metadata` must not ride along with it.
    const data: Record<string, unknown> = {
      id: 'org_1',
      sort_order: 9,
      name: 'Hijacked',
      slug: 'hijacked',
      logo: 'https://example.invalid/logo.png',
      metadata: '{"hijacked":true}',
    };
    expect(await guardedUpdate(data)).toBeNull();
    expect(data).toEqual({ id: 'org_1', sort_order: 9 });
  });

  it('the lifecycle stamps the write path injects pass through, but do not count as an editable field', async () => {
    // The REST data routes stamp `updated_at` / `updated_by` on every update;
    // a `name`-only PATCH arrives at the guard as {name, updated_at,
    // updated_by} and must still be refused — otherwise it would degrade into
    // a timestamp touch that reports success.
    const err = await guardedUpdate({ id: 'org_1', name: 'Hijacked', updated_at: '2026-09-07T00:00:00Z', updated_by: 'usr_1' });
    expect(err?.code).toBe('PERMISSION_DENIED');
    expect(err?.status).toBe(403);
  });
});

describe('#15873 — ADR-0092 D4: the edit form offers exactly what the guard admits', () => {
  const fields = SysOrganization.fields as Record<string, { readonly?: boolean }>;

  it.each(RULED_COLUMNS)('%s is writable in the form (not readonly) — the guard admits it', (column) => {
    expect(fields[column]?.readonly, `${column} must not be readonly`).not.toBe(true);
  });

  it.each(BETTER_AUTH_COLUMNS)('%s is readonly in the form — the guard would strip or refuse it', (column) => {
    expect(fields[column]?.readonly, `${column} must be readonly`).toBe(true);
  });

  it('the partition is total: every non-system column is either whitelisted or readonly, never both, never neither', () => {
    const whitelist = managedExtensionEditableFields('sys_organization');
    for (const [name, def] of Object.entries(fields)) {
      if (SYSTEM_COLUMNS.includes(name)) continue;
      const editable = whitelist.has(name);
      const readonly = def?.readonly === true;
      expect(editable !== readonly, `${name}: whitelisted=${editable} readonly=${readonly}`).toBe(true);
    }
  });
});
