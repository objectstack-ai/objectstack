// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// #3325 — pin the better-auth managed-object deny-list against the real schemas
// so it can never silently drift again (ADR-0092: registry-driven, no rot).

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from '@objectstack/platform-objects';
import { defaultPermissionSets, BETTER_AUTH_MANAGED_OBJECTS } from './default-permission-sets.js';
import { MANAGED_DENY_TARGET_SETS } from '../managed-object-write-denies.js';

// Every object schema the platform-objects package exports whose bucket is
// `better-auth` — the ground truth the static baseline must mirror.
const betterAuthSchemaNames = Object.values(PlatformObjects as Record<string, any>)
  .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.managedBy === 'better-auth')
  .map((v) => v.name as string)
  .sort();

const listNames = [...BETTER_AUTH_MANAGED_OBJECTS].sort();
const setByName = (name: string): any => defaultPermissionSets.find((s) => s.name === name);

describe('BETTER_AUTH_MANAGED_OBJECTS ↔ schemas (drift pin, #3325)', () => {
  it('found the better-auth identity schemas to compare against', () => {
    // Guard against a broken import silently passing the bidirectional check.
    expect(betterAuthSchemaNames.length).toBeGreaterThanOrEqual(20);
  });

  it('every listed name is a real object declaring managedBy:"better-auth"', () => {
    const notBetterAuth = listNames.filter((n) => !betterAuthSchemaNames.includes(n));
    expect(notBetterAuth).toEqual([]);
  });

  it('every better-auth schema is in the list (this is the drift that #3325 fixes)', () => {
    const missing = betterAuthSchemaNames.filter((n) => !listNames.includes(n));
    expect(missing).toEqual([]);
  });

  it('the list has no duplicates', () => {
    expect(listNames.length).toBe(new Set(listNames).size);
  });
});

/**
 * [#8053] The single, deliberate exception to the blanket managed-object edit
 * deny: `member_default` may EDIT `sys_api_key`, so a member can revoke their
 * own personal key. Bounded elsewhere and not by the permission-set boolean —
 * the `sys_api_key_self` RLS carve-out decides which rows, ADR-0092 D2's column
 * whitelist (`revoked` alone) decides which fields.
 *
 * Encoded as an exact (set, object) pair rather than by loosening the loop, so
 * a second entry — or the same one on another set — still fails this pin. The
 * create/delete/read axes are NOT excepted and are still asserted below.
 */
const EDIT_EXCEPTIONS = new Set(['member_default::sys_api_key']);

describe('default permission sets carry the managed denies (static baseline)', () => {
  it('each write-granting target set denies create/edit/delete on every managed object', () => {
    for (const setName of MANAGED_DENY_TARGET_SETS) {
      const set = setByName(setName);
      expect(set, `set ${setName} exists`).toBeTruthy();
      for (const obj of BETTER_AUTH_MANAGED_OBJECTS) {
        const entry = set.objects[obj];
        expect(entry, `${setName} has entry for ${obj}`).toBeTruthy();
        expect(entry.allowCreate).toBe(false);
        expect(entry.allowEdit, `${setName}.${obj} allowEdit`).toBe(
          EDIT_EXCEPTIONS.has(`${setName}::${obj}`),
        );
        expect(entry.allowDelete).toBe(false);
        expect(entry.allowRead).toBe(true);
      }
    }
  });

  it('the edit exception is exactly one (set, object) pair, and it is the API-key one', () => {
    // The exception list is itself pinned: a future widening has to edit THIS
    // assertion, which is the moment someone is asked whether the new pair
    // really rides an owner-scoping RLS policy and a column whitelist the way
    // `sys_api_key` does. Without this, `EDIT_EXCEPTIONS` could grow silently.
    expect([...EDIT_EXCEPTIONS]).toEqual(['member_default::sys_api_key']);

    const member = setByName('member_default');
    expect(member.objects.sys_api_key.allowEdit).toBe(true);
    // The owner scoping the grant leans on must exist, or the edit bit is
    // table-wide on a credential table.
    const selfPolicy = (member.rowLevelSecurity ?? []).find(
      (p: any) => p.object === 'sys_api_key' && p.name === 'sys_api_key_self',
    );
    expect(selfPolicy, 'member_default must keep the sys_api_key_self RLS carve-out').toBeTruthy();
    expect(selfPolicy.using).toBe('user_id == current_user.id');
    expect(['all', 'update']).toContain(selfPolicy.operation);
  });

  it('admin_full_access keeps its bare wildcard (zero per-object entries) — admin rescue path', () => {
    const admin = setByName('admin_full_access');
    expect(admin).toBeTruthy();
    expect(Object.keys(admin.objects)).toEqual(['*']);
  });
});
