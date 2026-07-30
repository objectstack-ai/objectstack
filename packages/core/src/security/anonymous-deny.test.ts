// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2567 Phase 2 — the shared anonymous-deny decision. These lock the exact
// contract every HTTP seam now delegates to, including the load-bearing
// `undefined`-path trap (a naive allowlist call would reopen GraphQL).

import { describe, it, expect } from 'vitest';
import { shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS } from './anonymous-deny.js';

describe('shouldDenyAnonymous — the shared HTTP anonymous-deny decision (#2567)', () => {
  it('no-op when requireAuth is off (demo / single-tenant)', () => {
    expect(shouldDenyAnonymous({ requireAuth: false })).toBe(false);
    expect(shouldDenyAnonymous({ requireAuth: undefined })).toBe(false);
  });

  it('denies an anonymous caller under requireAuth', () => {
    expect(shouldDenyAnonymous({ requireAuth: true })).toBe(true);
  });

  it('passes an authenticated caller', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, userId: 'u1' })).toBe(false);
  });

  it('passes an internal system context', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, isSystem: true })).toBe(false);
  });

  it('passes an OPTIONS preflight even when anonymous', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, method: 'OPTIONS' })).toBe(false);
    expect(shouldDenyAnonymous({ requireAuth: true, method: 'options' })).toBe(false);
  });

  it('exempts a real control-plane path (auth / health)', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, path: '/api/v1/auth/login' })).toBe(false);
    expect(shouldDenyAnonymous({ requireAuth: true, path: '/api/v1/health' })).toBe(false);
  });

  it('denies a real data path', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, path: '/api/v1/data/sys_user' })).toBe(true);
  });

  // The trap: isAuthGateAllowlisted(undefined) === true. A body-routed seam
  // (GraphQL) passes no path; it MUST still deny anonymous, not fall through to
  // the allowlist. Guards against silently reopening #2567.
  it('denies when path is undefined/empty (body-routed seam — GraphQL trap guard)', () => {
    expect(shouldDenyAnonymous({ requireAuth: true, path: undefined })).toBe(true);
    expect(shouldDenyAnonymous({ requireAuth: true, path: null })).toBe(true);
    expect(shouldDenyAnonymous({ requireAuth: true, path: '' })).toBe(true);
  });

  it('exposes a stable 401 body + status for seams to return', () => {
    expect(ANONYMOUS_DENY_STATUS).toBe(401);
    expect(ANONYMOUS_DENY_BODY).toEqual({ error: 'UNAUTHENTICATED', message: expect.any(String) });
  });
});
