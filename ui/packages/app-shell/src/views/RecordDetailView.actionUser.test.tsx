/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordDetailView — the `user` seeded into the record surface's own
 * `<ActionProvider>` (ADR-0066 D4 / framework#3923).
 *
 * The record page mounts an ActionProvider that SHADOWS the shell-level one, so
 * the capability gate the engine reads (`user.systemPermissions`) is whatever
 * this object carries. It used to carry identity only — `{id, name, avatar}` —
 * and since `ActionEngine.getActionsForLocation` fails OPEN on `undefined`, every
 * `record_header` / `record_more` action's `requiredPermissions` was silently
 * unenforced on the one surface those locations exist on.
 *
 * Three properties are pinned here, and they pull in different directions:
 *   • loaded permissions MUST reach the engine (otherwise: no gate at all);
 *   • unloaded permissions MUST NOT be forwarded as `[]` (otherwise: every gated
 *     action hides in a standalone embed that never mounts a PermissionProvider);
 *   • [objectui#4656] a LOADED-but-`undefined` answer MUST NOT be forwarded as
 *     `[]` either — `undefined` here means the backend never reported
 *     `systemPermissions` at all (a deployment predating ADR-0066), which
 *     `MePermissionsProvider` now preserves rather than collapsing to `[]`.
 *     Re-collapsing it at this call site would silently re-introduce the
 *     exact bug this ADR-0066 D4 seeding exists to prevent, just gated closed
 *     instead of open: every `requiredPermissions` action on the record
 *     surface would hide on such a deployment instead of showing (the server
 *     still 403s regardless — the UI-only failure is hiding a button a
 *     permitted user could have clicked).
 */

import { describe, it, expect } from 'vitest';
import { resolveActionUser } from './RecordDetailView';

const user = { id: 'u1', name: 'Ada', image: 'https://cdn/a.png' };

describe('resolveActionUser — ADR-0066 D4 capability gate seeding (#3923)', () => {
  it('forwards loaded systemPermissions so the action gate can enforce', () => {
    expect(resolveActionUser(user, true, ['manage_platform_settings'])).toEqual({
      id: 'u1',
      name: 'Ada',
      avatar: 'https://cdn/a.png',
      systemPermissions: ['manage_platform_settings'],
    });
  });

  it('forwards an EMPTY loaded set — "holds nothing" must gate, not fail open', () => {
    const resolved = resolveActionUser(user, true, []);
    expect(resolved.systemPermissions).toEqual([]);
    // The distinction the engine keys off: present-but-empty ≠ absent.
    expect(Array.isArray(resolved.systemPermissions)).toBe(true);
  });

  it('omits systemPermissions while permissions are still loading (fail-open)', () => {
    const resolved = resolveActionUser(user, false, []);
    expect(resolved).toEqual({ id: 'u1', name: 'Ada', avatar: 'https://cdn/a.png' });
    expect('systemPermissions' in resolved).toBe(false);
  });

  it('forwards a loaded-but-undefined set AS unknown, not as "holds nothing" (objectui#4656)', () => {
    // Superseded assertion (pre-#4656): this used to collapse to `[]`, on the
    // premise that `usePermissions().systemPermissions` was NEVER undefined
    // while loaded — `MePermissionsProvider` always defaulted it via `?? []`.
    // That premise is gone: the provider now preserves `undefined` for "this
    // backend never reported systemPermissions", and `resolveActionUser` must
    // forward it unchanged so `ActionEngine`'s own `Array.isArray(held)` check
    // reads it as unknown and fails OPEN — collapsing it here would silently
    // flip that to fail-CLOSED for every record_header/record_more action.
    const resolved = resolveActionUser(user, true, undefined);
    expect(resolved.systemPermissions).toBeUndefined();
    expect(Array.isArray(resolved.systemPermissions)).toBe(false);
  });

  it('keeps the anonymous fallback identity and still carries the gate', () => {
    const resolved = resolveActionUser(null, true, ['setup.access']);
    expect(resolved.id).toBe('current-user');
    expect(resolved.systemPermissions).toEqual(['setup.access']);
  });

  it('never mutates the shared FALLBACK_USER constant', () => {
    resolveActionUser(undefined, true, ['a']);
    const second = resolveActionUser(undefined, false, undefined);
    expect('systemPermissions' in second).toBe(false);
  });
});
