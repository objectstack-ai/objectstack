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
          value === null ? row[field] == null : row[field] === value,
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

  it('stamps configured social providers with the synthetic local:oauth issuer', async () => {
    const ql = makeQl({
      sys_account: [{ id: 'a1', provider_id: 'github', account_id: '4242', issuer: null }],
    });

    const res = await backfillAccountIssuer(ql, { socialProviderIds: ['github', 'google'] });

    expect(res.stamped).toBe(1);
    expect(ql.tables.sys_account[0].issuer).toBe('local:oauth:github');
    expect(oauthIssuerFor('github')).toBe('local:oauth:github');
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
