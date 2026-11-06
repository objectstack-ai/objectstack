// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling 「可以，按三档做（推荐）」] The multi-factor requirement's three
 * levels, per organization: `administrators` holds ADR-0090 D12's three kinds
 * — read through the existing predicates (the `PLATFORM_ADMIN` and
 * `TENANT_ADMIN` posture rungs of `resolveUserAuthzGrants`, and a delegated
 * set's `adminScope`) — and lets a plain member through; `everyone` holds
 * both; two organizations in one deployment are each held to their own level.
 *
 * `resolveUserAuthzGrants` is replaced here by a table of postures, so the
 * test reads the level's decision rather than the grant resolver's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const POSTURES: Record<string, { posture?: string; positions?: string[]; permissions?: string[] }> = {};

vi.mock('@objectstack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/core')>();
  return {
    ...actual,
    resolveUserAuthzGrants: vi.fn(async (_engine: unknown, userId: string, opts: { tenantId?: string } = {}) => {
      const row = POSTURES[`${userId}@${opts.tenantId ?? ''}`] ?? {};
      return { positions: row.positions ?? [], permissions: row.permissions ?? [], posture: row.posture ?? 'MEMBER' };
    }),
  };
});

import { AuthManager } from './auth-manager';

const SECRET = 'test-secret-at-least-32-chars-long';
const LAPSED = () => new Date(Date.now() - 30 * 86_400_000).toISOString();
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** An engine answering an unenrolled user whose grace period has lapsed. */
const unenrolledUsers = () => ({
  findOne: vi.fn(async (_obj: string, q: any) => ({ id: q?.where?.id, two_factor_enabled: false, mfa_required_at: LAPSED() })),
  update: vi.fn(async () => ({})),
  count: vi.fn(async () => 0),
});

function manager(levels: Record<string, string>, opts: { deployment?: string; delegated?: Set<string> } = {}) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const m = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: unenrolledUsers(),
    plugins: { twoFactor: true },
    mfaGracePeriodDays: 7,
    ...(opts.deployment ? { mfaRequirement: opts.deployment } : {}),
  } as any);
  warn.mockRestore();
  m.setOrganizationAccessPolicySource({
    read: async (id) => ({ mfa_required: levels[id] ?? 'off' }),
    anyOrganizationRequiresMfa: async () => Object.values(levels).some((l) => l !== 'off'),
    isDelegatedAdministrator: async (userId) => opts.delegated?.has(userId) ?? false,
  });
  (m as any)._orgMfaCache = { value: true, at: Date.now() };
  return m;
}

const held = async (m: AuthManager, userId: string, organizationId: string) =>
  (await m.resolveUserAuthGates(userId, { organizationId })).some((g) => g.code === 'MFA_REQUIRED');

beforeEach(() => {
  for (const key of Object.keys(POSTURES)) delete POSTURES[key];
});

describe('the administrators level', () => {
  it('holds an organization administrator and lets a plain member through', async () => {
    POSTURES[`org_admin@${ORG_A}`] = { posture: 'TENANT_ADMIN' };
    POSTURES[`plain@${ORG_A}`] = { posture: 'MEMBER' };
    const m = manager({ [ORG_A]: 'administrators' });
    expect(await held(m, 'org_admin', ORG_A)).toBe(true);
    expect(await held(m, 'plain', ORG_A)).toBe(false);
  });

  it('holds a tenant-level administrator and a delegated administrator too', async () => {
    POSTURES[`platform@${ORG_A}`] = { posture: 'PLATFORM_ADMIN' };
    POSTURES[`delegate@${ORG_A}`] = { posture: 'MEMBER', permissions: ['bu_admin'] };
    const m = manager({ [ORG_A]: 'administrators' }, { delegated: new Set(['delegate']) });
    expect(await held(m, 'platform', ORG_A)).toBe(true);
    expect(await held(m, 'delegate', ORG_A)).toBe(true);
  });

  it('is judged in the organization the session is scoped to', async () => {
    // An administrator of Beta is a plain member in Alpha.
    POSTURES[`carol@${ORG_B}`] = { posture: 'TENANT_ADMIN' };
    POSTURES[`carol@${ORG_A}`] = { posture: 'MEMBER' };
    const m = manager({ [ORG_A]: 'administrators', [ORG_B]: 'administrators' });
    expect(await held(m, 'carol', ORG_B)).toBe(true);
    expect(await held(m, 'carol', ORG_A)).toBe(false);
  });

  it('a delegated check that fails holds the user rather than letting the requirement lapse', async () => {
    const m = manager({ [ORG_A]: 'administrators' });
    m.setOrganizationAccessPolicySource({
      read: async () => ({ mfa_required: 'administrators' }),
      anyOrganizationRequiresMfa: async () => true,
      isDelegatedAdministrator: async () => {
        throw new Error('catalog unreadable');
      },
    });
    (m as any)._orgMfaCache = { value: true, at: Date.now() };
    expect(await held(m, 'plain', ORG_A)).toBe(true);
  });
});

describe('two organizations, each held to its own level', () => {
  it('everyone in one, off in the other', async () => {
    const m = manager({ [ORG_A]: 'everyone', [ORG_B]: 'off' });
    expect(await held(m, 'plain', ORG_A)).toBe(true);
    expect(await held(m, 'plain', ORG_B)).toBe(false);
  });

  it('an organization cannot go below the deployment\'s level', async () => {
    POSTURES[`org_admin@${ORG_B}`] = { posture: 'TENANT_ADMIN' };
    // Beta stores `off`; the deployment requires administrators.
    const m = manager({ [ORG_A]: 'everyone', [ORG_B]: 'off' }, { deployment: 'administrators' });
    expect(await held(m, 'org_admin', ORG_B)).toBe(true);
    expect(await held(m, 'plain', ORG_B)).toBe(false);
    expect(await held(m, 'plain', ORG_A)).toBe(true);
  });
});
