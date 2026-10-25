/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `lockedKeyOf` — the two wire positions of a `SETTINGS_LOCKED` key
 * (objectstack#4224).
 *
 * Why this is pinned rather than left as an inline `??`: it is a COMPAT read,
 * and the failure mode of a compat read is that someone deletes the half they
 * did not know was load-bearing. Both branches are asserted here, so removing
 * either one is a red test that names the server version it breaks — which is
 * also the signal for when the old branch may legitimately go.
 *
 * The old position (`error.key`) was never declared by `ApiErrorSchema`; it
 * reached the console only because the schema is a plain `z.object` and strips
 * undeclared keys instead of rejecting them. That is exactly why no test on
 * either side of the wire ever caught it.
 */

import { describe, it, expect } from 'vitest';
import { lockedKeyOf } from './api';

describe('lockedKeyOf', () => {
  it('reads the declared slot — a server carrying objectstack#4224', () => {
    expect(
      lockedKeyOf({
        code: 'SETTINGS_LOCKED',
        message: "Setting 'branding.workspace_name' is locked (locked-by-env).",
        details: { namespace: 'branding', key: 'workspace_name', reason: 'locked-by-env' },
      }),
    ).toBe('workspace_name');
  });

  it('falls back to the pre-#4224 sibling — a server without it', () => {
    expect(
      lockedKeyOf({
        code: 'SETTINGS_LOCKED',
        message: "Setting 'branding.workspace_name' is locked (locked-by-env).",
        namespace: 'branding',
        key: 'workspace_name',
        reason: 'locked-by-env',
      }),
    ).toBe('workspace_name');
  });

  it('prefers the declared slot when a body somehow carries both', () => {
    expect(lockedKeyOf({ key: 'old_key', details: { key: 'new_key' } })).toBe('new_key');
  });

  it('yields undefined rather than a string when no position carries a key', () => {
    // The toast branches on this: no key means "Locked by environment" rather
    // than "Locked by environment: undefined".
    expect(lockedKeyOf({ code: 'SETTINGS_LOCKED', message: 'Locked.' })).toBeUndefined();
    expect(lockedKeyOf({ details: {} })).toBeUndefined();
    expect(lockedKeyOf({ details: null })).toBeUndefined();
    expect(lockedKeyOf({ key: '' })).toBeUndefined();
    expect(lockedKeyOf({ key: 42 })).toBeUndefined();
    expect(lockedKeyOf(undefined)).toBeUndefined();
    expect(lockedKeyOf('not an object')).toBeUndefined();
  });
});
