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

  // A body-routed seam (GraphQL) passes no path; it MUST still deny anonymous,
  // not fall through to the allowlist. Guards against silently reopening #2567.
  //
  // [#7898] This was written when the trap was `isAuthGateAllowlisted(undefined)
  // === true` — a fail-OPEN default that made this seam's guard the only thing
  // between a pathless anonymous query and a blanket exemption. The predicate is
  // fail-closed now, so the two agree; these pin the DECISION, so they are
  // unchanged by that flip and go on measuring this seam's own contract.
  it('denies when path is undefined/empty (body-routed seam — GraphQL trap guard)', () => {
    expect(shouldDenyAnonymous({ path: undefined })).toBe(true);
    expect(shouldDenyAnonymous({ path: null })).toBe(true);
    expect(shouldDenyAnonymous({ path: '' })).toBe(true);
  });

  // ⭐ [#7898] B1 IS UNMOVED — the fence half of the ruling's control
  // 「现有四处生产调用点行为逐字节不变」, for this call site. Flipping the
  // allow-list predicate fail-closed must not change a single answer this seam
  // gives, in EITHER direction: a real control-plane path stays exempt, a data
  // path stays denied, and a caller that never reaches the predicate at all is
  // untouched.
  it('gives the same answer on every input shape after the fail-close flip', () => {
    // exempt — unchanged
    expect(shouldDenyAnonymous({ path: '/api/v1/auth/login' })).toBe(false);
    expect(shouldDenyAnonymous({ path: '/api/v1/health' })).toBe(false);
    expect(shouldDenyAnonymous({ path: '/discovery' })).toBe(false);
    // denied — unchanged
    expect(shouldDenyAnonymous({ path: '/api/v1/data/sys_user' })).toBe(true);
    expect(shouldDenyAnonymous({ path: '/api/v1/meta/object/foo' })).toBe(true);
    // short-circuited before the predicate — unchanged
    expect(shouldDenyAnonymous({ userId: 'u1', path: '' })).toBe(false);
    expect(shouldDenyAnonymous({ isSystem: true, path: '' })).toBe(false);
    expect(shouldDenyAnonymous({ method: 'OPTIONS', path: '' })).toBe(false);
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
