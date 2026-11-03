// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28508: `GET /auth/me/permissions` has a declared, STRICT response contract.
// The console reads this body once per session for its whole permission layer,
// and since #28508 for `hasAnyQueue` too. A key the server starts sending is
// declared here first, and an undeclared one is refused rather than dropped.
//
// The handler's own bodies are parsed through this schema in
// plugin-hono-server's `current-user-endpoints-has-any-queue.test.ts`; this
// file pins the contract itself.

import { describe, it, expect } from 'vitest';
import {
  MePermissionsResponseSchema,
  MePermissionsAuthenticatedResponseSchema,
  MePermissionsAnonymousResponseSchema,
} from './auth.zod';

/** The full body: a stack with SecurityPlugin. */
const FULL = {
  authenticated: true,
  userId: 'usr_1',
  tenantId: 'org_1',
  positions: ['org_member', 'everyone'],
  permissionSets: ['member_default'],
  objects: { crm_account: { allowRead: true, allowEdit: true, apiOperations: ['get', 'list'] } },
  fields: { 'crm_account.revenue': { readable: true, editable: false } },
  systemPermissions: ['setup.access'],
  tabPermissions: { sales: 'visible' },
  hasAnyQueue: true,
} as const;

/** The closed body: the caller is known, the grants could not be computed. */
const CLOSED = {
  authenticated: true,
  userId: 'usr_1',
  tenantId: 'org_1',
  positions: [],
  permissionSets: [],
  objects: {},
  fields: {},
  systemPermissions: [],
  tabPermissions: {},
  hasAnyQueue: false,
} as const;

/** The degraded body: no SecurityPlugin; capabilities unknown, so the two keys are absent. */
const DEGRADED = {
  authenticated: true,
  userId: 'usr_1',
  tenantId: null,
  positions: ['everyone'],
  permissionSets: [],
  objects: {},
  fields: {},
  hasAnyQueue: false,
} as const;

const issuesOf = (value: unknown) => {
  const r = MePermissionsResponseSchema.safeParse(value);
  return r.success ? [] : r.error.issues;
};

describe('[#28508] MePermissionsResponseSchema — the declared /auth/me/permissions body', () => {
  it.each([
    ['anonymous', { authenticated: false }],
    ['full', FULL],
    ['closed', CLOSED],
    ['degraded', DEGRADED],
  ] as const)('the %s body parses', (_label, body) => {
    expect(issuesOf(body)).toEqual([]);
  });

  it('hasAnyQueue is declared, and is a boolean', () => {
    expect(MePermissionsAuthenticatedResponseSchema.shape.hasAnyQueue).toBeDefined();
    expect(MePermissionsResponseSchema.parse(FULL)).toMatchObject({ hasAnyQueue: true });
    expect(issuesOf({ ...FULL, hasAnyQueue: 'yes' }).map((i) => i.path.join('.'))).toEqual(['hasAnyQueue']);
    expect(issuesOf({ ...FULL, hasAnyQueue: 2 }).map((i) => i.path.join('.'))).toEqual(['hasAnyQueue']);
  });

  it('hasAnyQueue is required on an authenticated body — every authenticated branch carries it', () => {
    const { hasAnyQueue: _dropped, ...withoutIt } = FULL;
    expect(issuesOf(withoutIt).map((i) => i.path.join('.'))).toEqual(['hasAnyQueue']);
  });

  it('an unknown sibling is refused on the authenticated body, not dropped', () => {
    const issues = issuesOf({ ...FULL, queueNames: ['billing'] });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('unrecognized_keys');
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['queueNames']);
  });

  it('an unknown sibling is refused on the anonymous body: nothing about a user rides on it', () => {
    const issues = MePermissionsAnonymousResponseSchema.safeParse({ authenticated: false, hasAnyQueue: true });
    expect(issues.success).toBe(false);
    expect(issues.success ? [] : issues.error.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(issuesOf({ authenticated: false, userId: 'usr_1' }).map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('a field entry is closed too', () => {
    const issues = issuesOf({ ...FULL, fields: { 'crm_account.revenue': { readable: true, editable: false, masked: true } } });
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('absent systemPermissions is the degraded body\'s "unknown"; present-and-empty is "none" — both parse, and stay distinct', () => {
    const degraded = MePermissionsResponseSchema.parse(DEGRADED);
    const closed = MePermissionsResponseSchema.parse(CLOSED);
    expect('systemPermissions' in degraded).toBe(false);
    expect(closed).toMatchObject({ systemPermissions: [] });
  });

  it('a tab visibility outside the four is refused', () => {
    expect(issuesOf({ ...FULL, tabPermissions: { sales: 'shown' } }).map((i) => i.path.join('.'))).toEqual(['tabPermissions.sales']);
  });

  it('the discriminator is the boolean `authenticated`: anything else matches no branch', () => {
    expect(issuesOf({ authenticated: 'true' })).not.toEqual([]);
    expect(issuesOf({})).not.toEqual([]);
  });
});
