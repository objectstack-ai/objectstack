// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11343 / #12751] The verified-email allow-list, pinned representation by
 * representation. This predicate is shared between the walled owner-elevation
 * gate (which REFUSES on `false`) and the owner-verification boot diagnostic
 * (which stays quiet on `true`) — the pin here is what both consumers stand
 * on, so any widening or narrowing must happen HERE, deliberately, not in a
 * consumer's local copy.
 */

import { describe, it, expect } from 'vitest';
import { isEmailVerifiedUserRow } from './email-verified.js';

describe('#11343/#12751 — isEmailVerifiedUserRow allow-list', () => {
  it('accepts exactly the four listed representations', () => {
    expect(isEmailVerifiedUserRow({ email_verified: true })).toBe(true);
    expect(isEmailVerifiedUserRow({ email_verified: 1 })).toBe(true);
    expect(isEmailVerifiedUserRow({ email_verified: '1' })).toBe(true);
    expect(isEmailVerifiedUserRow({ email_verified: 'true' })).toBe(true);
  });

  it('everything else reads as UNVERIFIED — fail closed', () => {
    expect(isEmailVerifiedUserRow({ email_verified: false })).toBe(false);
    expect(isEmailVerifiedUserRow({ email_verified: 0 })).toBe(false);
    expect(isEmailVerifiedUserRow({ email_verified: '0' })).toBe(false);
    expect(isEmailVerifiedUserRow({ email_verified: 'false' })).toBe(false);
    // Not on the list on purpose: an unrecognized representation must not
    // read as verified (e.g. a driver shouting the string).
    expect(isEmailVerifiedUserRow({ email_verified: 'TRUE' })).toBe(false);
    expect(isEmailVerifiedUserRow({ email_verified: null })).toBe(false);
    expect(isEmailVerifiedUserRow({ email_verified: undefined })).toBe(false);
    // Absent field (imported/legacy row that predates the column).
    expect(isEmailVerifiedUserRow({})).toBe(false);
    // Non-object inputs.
    expect(isEmailVerifiedUserRow(null)).toBe(false);
    expect(isEmailVerifiedUserRow(undefined)).toBe(false);
    expect(isEmailVerifiedUserRow('usr_1')).toBe(false);
  });
});
