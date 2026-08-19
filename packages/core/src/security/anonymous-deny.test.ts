// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2567 Phase 2 — the shared anonymous-deny decision. These lock the exact
// contract every HTTP seam now delegates to, including the load-bearing
// `undefined`-path trap (a naive allowlist call would reopen GraphQL).
//
// [#3963] The `requireAuth` opt-out is gone: an anonymous, non-system caller
// outside the control-plane allowlist is denied unconditionally. There is no
// longer a posture that turns the decision off.

import { describe, it, expect } from 'vitest';
import { shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS } from './anonymous-deny.js';

describe('shouldDenyAnonymous — the shared HTTP anonymous-deny decision (#2567, #3963)', () => {
  it('denies an anonymous caller (unconditionally — no opt-out)', () => {
    expect(shouldDenyAnonymous({})).toBe(true);
  });

  it('passes an authenticated caller', () => {
    expect(shouldDenyAnonymous({ userId: 'u1' })).toBe(false);
  });

  it('passes an internal system context', () => {
    expect(shouldDenyAnonymous({ isSystem: true })).toBe(false);
  });

  it('passes an OPTIONS preflight even when anonymous', () => {
    expect(shouldDenyAnonymous({ method: 'OPTIONS' })).toBe(false);
    expect(shouldDenyAnonymous({ method: 'options' })).toBe(false);
  });

  it('exempts a real control-plane path (auth / health)', () => {
    expect(shouldDenyAnonymous({ path: '/api/v1/auth/login' })).toBe(false);
    expect(shouldDenyAnonymous({ path: '/api/v1/health' })).toBe(false);
  });

  it('denies a real data path', () => {
    expect(shouldDenyAnonymous({ path: '/api/v1/data/sys_user' })).toBe(true);
  });

  // The trap: isAuthGateAllowlisted(undefined) === true. A body-routed seam
  // (GraphQL) passes no path; it MUST still deny anonymous, not fall through to
  // the allowlist. Guards against silently reopening #2567.
  it('denies when path is undefined/empty (body-routed seam — GraphQL trap guard)', () => {
    expect(shouldDenyAnonymous({ path: undefined })).toBe(true);
    expect(shouldDenyAnonymous({ path: null })).toBe(true);
    expect(shouldDenyAnonymous({ path: '' })).toBe(true);
  });

  it('exposes a stable 401 body + status for seams to return', () => {
    expect(ANONYMOUS_DENY_STATUS).toBe(401);
    // [#9487] `code` carries the machine code — the documented key every other
    // REST error family answers. ADDITIVE by maintainer ruling: `error` keeps
    // holding the same code value it always has, so no existing reader breaks.
    expect(ANONYMOUS_DENY_BODY).toEqual({
      error: 'UNAUTHENTICATED',
      code: 'UNAUTHENTICATED',
      message: expect.any(String),
    });
  });
});
