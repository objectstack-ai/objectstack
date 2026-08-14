// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  backfillAccountIssuer,
  CREDENTIAL_ISSUER,
  oauthIssuerFor,
} from './backfill-account-issuer.js';

/**
 * Minimal ObjectQL stand-in: `find` answers from the seeded tables honouring
 * the `{ field: value }` where-shape the helper uses, `update` patches the row
 * in place so idempotence can be observed across runs.
 */
function makeQl(tables: Record<string, any[]>) {
  const update = vi.fn(async (object: string, data: any) => {
    const row = (tables[object] ?? []).find((r) => r.id === data.id);
    if (row) Object.assign(row, data);
    return row;
  });
  return {
    tables,
    update,
    find: vi.fn(async (object: string, query: any) => {
      const rows = tables[object] ?? [];
      const where = query?.where ?? {};
      return rows.filter((row) =>
        Object.entries(where).every(([field, value]) =>
          { if (field.startsWith('$')) throw new Error(`fake driver: unsupported operator ${field}`); return value === null ? row[field] == null : row[field] === value; },
        ),
      );
    }),
  };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('backfillAccountIssuer (better-auth 1.7 account identity)', () => {
  it('stamps password accounts with better-auth\'s local:credential issuer', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'credential', account_id: 'u1', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql);

    expect(res).toMatchObject({ scanned: 1, stamped: 1, unresolved: [] });
    expect(ql.tables.sys_account[0].issuer).toBe(CREDENTIAL_ISSUER);
    expect(CREDENTIAL_ISSUER).toBe('local:credential');
  });

  it('stamps a provider that declares no issuer with the synthetic local:oauth one', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'github', account_id: '4242', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql, { socialProviderIds: ['github', 'google'] });

    expect(res.stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe('local:oauth:github');
    expect(oauthIssuerFor('github')).toBe('local:oauth:github');
  });

  it('stamps a provider that declares its own issuer with THAT issuer', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'google', account_id: 'sub-1', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql, {
      socialProviders: [{ id: 'google', accountIssuer: 'https://accounts.google.com' }],
    });

    expect(res.stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe('https://accounts.google.com');
  });

  it('leaves a per-login issuer underivable rather than synthesizing one', async () => {
    // Microsoft Entra reads the tenant's `iss` off each login's profile, so
    // there is no boot-time answer — and a guess would be the whole bug.
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'microsoft', account_id: 'oid-1', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql, {
      socialProviders: [{ id: 'microsoft', accountIssuer: ({ profile }: any) => profile.iss }],
      socialProviderIds: ['microsoft'],
    });

    expect(res).toMatchObject({ scanned: 1, stamped: 0, repaired: 0 });
    expect(res.unresolved).toEqual([{ providerId: 'microsoft', count: 1 }]);
    expect(ql.tables.sys_account[0].issuer).toBeNull();
  });

  it('uses the registered SSO provider\'s real issuer for federated accounts', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'okta-prod', account_id: '00u1', issuer: null }],
      sys_sso_provider: [{ id: 'p1', provider_id: 'okta-prod', issuer: 'https://acme.okta.com' }],
    });

    const res = await backfillAccountIssuer(ql);

    expect(res.stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe('https://acme.okta.com');
  });

  it('uses an explicitly configured generic-oauth issuer', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'keycloak', account_id: 'k1', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql, {
      oidcProviderIssuers: { keycloak: 'https://id.acme.test/realms/main' },
    });

    expect(res.stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe('https://id.acme.test/realms/main');
  });

  it('leaves an underivable issuer NULL and reports it instead of guessing', async () => {
    const log = logger();
    const ql = makeQl({
      // Provider is neither credential, nor configured, nor a registered SSO
      // provider — its issuer is the IdP's own `iss` and cannot be synthesized.
      sys_account: [
        { id: 'a1', provider_id: 'legacy-idp', account_id: 'x1', issuer: null },
        { id: 'a2', provider_id: 'legacy-idp', account_id: 'x2', issuer: null },
      ],
    });

    const res = await backfillAccountIssuer(ql, { logger: log });

    expect(res).toMatchObject({ scanned: 2, stamped: 0 });
    expect(res.unresolved).toEqual([{ providerId: 'legacy-idp', count: 2 }]);
    expect(ql.tables.sys_account[0].issuer).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('treats an empty-string issuer as unstamped', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'credential', account_id: 'u1', issuer: '' }],
    });

    expect((await backfillAccountIssuer(ql)).stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe(CREDENTIAL_ISSUER);
  });

  it('is idempotent — a second pass touches nothing', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'credential', account_id: 'u1', issuer: null }],
    });

    await backfillAccountIssuer(ql);
    ql.update.mockClear();
    const second = await backfillAccountIssuer(ql);

    expect(second).toMatchObject({ scanned: 0, stamped: 0 });
    expect(ql.update).not.toHaveBeenCalled();
  });

  it('reports a row whose update fails rather than counting it as stamped', async () => {
    const log = logger();
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'credential', account_id: 'u1', issuer: null }],
    });
    ql.update.mockRejectedValueOnce(new Error('unique constraint'));

    const res = await backfillAccountIssuer(ql, { logger: log });

    expect(res).toMatchObject({ scanned: 1, stamped: 0 });
    expect(res.unresolved).toEqual([{ providerId: 'credential', count: 1 }]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('no-ops on an engine that cannot query', async () => {
    await expect(backfillAccountIssuer(undefined)).resolves.toMatchObject({ scanned: 0, stamped: 0 });
    await expect(backfillAccountIssuer({} as any)).resolves.toMatchObject({ scanned: 0, stamped: 0 });
  });
});

/**
 * The shipped defect: an earlier pass stamped `local:oauth:google` on links
 * better-auth resolves under `https://accounts.google.com`. The row went
 * invisible at sign-in, the callback fell through to "link this provider", and
 * the insert hit the `(provider_id, account_id)` unique index the invisible row
 * was holding — `?error=unable_to_link_account`.
 */
describe('backfillAccountIssuer — repairing a mis-stamped synthetic issuer', () => {
  it('re-stamps a synthetic issuer with the one its provider declares', async () => {
    const log = logger();
    const ql = makeQl({
      sys_account: [
        { id: 'a1', provider_id: 'google', account_id: 'sub-1', issuer: 'local:oauth:google' },
      ],
    });

    const res = await backfillAccountIssuer(ql, {
      logger: log,
      socialProviders: [{ id: 'google', accountIssuer: 'https://accounts.google.com' }],
    });

    expect(res).toMatchObject({ scanned: 1, stamped: 0, repaired: 1, unresolved: [] });
    expect(ql.tables.sys_account[0].issuer).toBe('https://accounts.google.com');
    expect(log.info).toHaveBeenCalled();
  });

  it('is idempotent — the repaired row is not touched again', async () => {
    const ql = makeQl({
      sys_account: [
        { id: 'a1', provider_id: 'google', account_id: 'sub-1', issuer: 'local:oauth:google' },
      ],
    });
    const opts = { socialProviders: [{ id: 'google', accountIssuer: 'https://accounts.google.com' }] };

    await backfillAccountIssuer(ql, opts);
    ql.update.mockClear();
    const second = await backfillAccountIssuer(ql, opts);

    expect(second).toMatchObject({ scanned: 0, repaired: 0 });
    expect(ql.update).not.toHaveBeenCalled();
  });

  it('leaves the synthetic issuer alone when it IS what the provider mints', async () => {
    const ql = makeQl({
      sys_account: [
        { id: 'a1', provider_id: 'github', account_id: '4242', issuer: 'local:oauth:github' },
      ],
    });

    const res = await backfillAccountIssuer(ql, { socialProviders: [{ id: 'github' }] });

    expect(res).toMatchObject({ scanned: 0, stamped: 0, repaired: 0 });
    expect(ql.tables.sys_account[0].issuer).toBe('local:oauth:github');
  });

  it('rewrites ONLY the synthetic value — a row already holding a real issuer stands', async () => {
    const ql = makeQl({
      sys_account: [
        { id: 'a1', provider_id: 'google', account_id: 'sub-1', issuer: 'https://accounts.google.com' },
        { id: 'a2', provider_id: 'google', account_id: 'sub-2', issuer: 'https://some-other.example' },
      ],
    });

    const res = await backfillAccountIssuer(ql, {
      socialProviders: [{ id: 'google', accountIssuer: 'https://accounts.google.com' }],
    });

    expect(res).toMatchObject({ scanned: 0, repaired: 0 });
    expect(ql.tables.sys_account[1].issuer).toBe('https://some-other.example');
  });

  it('reports a repair the database refuses instead of counting it', async () => {
    // A duplicate row can already occupy (issuer, account_id) on a deployment
    // that acquired one before the unique index existed.
    const log = logger();
    const ql = makeQl({
      sys_account: [
        { id: 'a1', provider_id: 'google', account_id: 'sub-1', issuer: 'local:oauth:google' },
      ],
    });
    ql.update.mockRejectedValueOnce(new Error('unique constraint'));

    const res = await backfillAccountIssuer(ql, {
      logger: log,
      socialProviders: [{ id: 'google', accountIssuer: 'https://accounts.google.com' }],
    });

    expect(res).toMatchObject({ scanned: 1, repaired: 0 });
    expect(res.unresolved).toEqual([{ providerId: 'google', count: 1 }]);
    expect(log.warn).toHaveBeenCalled();
  });
});
