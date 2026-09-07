// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15417 — the ownership table the auth catch-all's yield is conditioned on.
//
// The table is only as good as its agreement with better-call's own router
// construction, so the cases below are the ones that construction makes
// meaningful: the three skips it performs, the `:param` syntax it registers,
// and the method set it keys on. The paths are real better-auth paths taken
// from `auth-route-ledger.ts`'s `BETTER_AUTH_MOUNTED_SURFACE`, so a rename
// upstream shows up here as well as there.

import { describe, it, expect } from 'vitest';
import { buildBetterAuthRouteOwnership } from './better-auth-route-ownership';

/** A slice of a real `auth.api`, in the shape better-auth exposes. */
const API = {
  getSession: { path: '/get-session', options: { method: ['GET', 'POST'] } },
  listUsers: { path: '/admin/list-users', options: { method: 'GET' } },
  setRole: { path: '/admin/set-role', options: { method: 'POST' } },
  deleteUser: { path: '/delete-user', options: { method: 'POST' } },
  resource: { path: '/admin/oauth2/resources/:identifier', options: { method: 'GET' } },
  resourceClient: {
    path: '/admin/oauth2/resources/:identifier/clients/:client_id',
    options: { method: 'POST' },
  },
  callback: { path: '/callback/:id', options: { method: ['GET', 'POST'] } },
};

describe('#15417 better-auth route ownership', () => {
  const table = buildBetterAuthRouteOwnership(API as any);

  it('reads a non-empty table (a zero table would make every caller yield)', () => {
    expect(table.size).toBeGreaterThan(0);
  });

  it('owns a literal path on a method it declares', () => {
    expect(table.owns('GET', '/admin/list-users')).toBe(true);
    expect(table.owns('POST', '/admin/set-role')).toBe(true);
  });

  it('owns every method in a multi-method declaration, and only those', () => {
    expect(table.owns('GET', '/get-session')).toBe(true);
    expect(table.owns('POST', '/get-session')).toBe(true);
    // The method is part of ownership: better-call routes per (method, path).
    expect(table.owns('DELETE', '/get-session')).toBe(false);
  });

  it('is case-insensitive about the verb, since the wire is not', () => {
    expect(table.owns('get', '/admin/list-users')).toBe(true);
  });

  it('does NOT own a path nothing declares — the #4088 yield still applies', () => {
    // The two routes plugin-hono-server mounts. If these ever read `true` the
    // console's whole permission layer becomes order-dependent again.
    expect(table.owns('GET', '/me/permissions')).toBe(false);
    expect(table.owns('GET', '/me/localization')).toBe(false);
    expect(table.owns('POST', '/admin/definitely-not-a-route-1989')).toBe(false);
  });

  it('fills a `:param` with exactly one non-empty segment', () => {
    expect(table.owns('GET', '/admin/oauth2/resources/abc123')).toBe(true);
    expect(table.owns('POST', '/admin/oauth2/resources/abc123/clients/cli_9')).toBe(true);
    expect(table.owns('GET', '/callback/github')).toBe(true);
  });

  it('does not let a `:param` swallow a longer or shorter path', () => {
    // A param is ONE segment. Were it a prefix match, every unknown tail under
    // a parameterised route would read as owned and stop being yielded.
    expect(table.owns('GET', '/admin/oauth2/resources/abc123/extra')).toBe(false);
    expect(table.owns('GET', '/admin/oauth2/resources')).toBe(false);
    expect(table.owns('GET', '/callback')).toBe(false);
  });

  it('skips SERVER_ONLY endpoints, exactly as better-call\'s createRouter does', () => {
    const t = buildBetterAuthRouteOwnership({
      hidden: { path: '/internal-only', options: { method: 'POST', metadata: { SERVER_ONLY: true } } },
    } as any);
    // Not routed by better-call ⇒ not owned here ⇒ still yieldable.
    expect(t.size).toBe(0);
    expect(t.owns('POST', '/internal-only')).toBe(false);
  });

  it('skips entries with no options or no path, as createRouter does', () => {
    const t = buildBetterAuthRouteOwnership({
      noOptions: { path: '/x' },
      noPath: { options: { method: 'POST' } },
    } as any);
    expect(t.size).toBe(0);
  });

  it('an unresolvable api yields an empty table that owns nothing', () => {
    // The safe direction: an enumeration failure must degrade to the
    // pre-#15417 behaviour (yield), never to "owns everything".
    for (const bad of [undefined, null, {}]) {
      const t = buildBetterAuthRouteOwnership(bad as any);
      expect(t.size).toBe(0);
      expect(t.owns('POST', '/admin/set-role')).toBe(false);
    }
  });
});
