// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  socialProviderList,
  socialProviders as socialProviderFactories,
} from '@better-auth/core/social-providers';
import { backfillAccountIssuer, oauthIssuerFor } from './backfill-account-issuer.js';

/**
 * Account-issuer parity gate.
 *
 * better-auth 1.7 keys every account on `(issuer, accountId)`, and the
 * issuer is the PROVIDER's to declare: `resolveOAuthAccountKey` takes
 * `provider.accountIssuer` when there is one and synthesizes
 * `local:oauth:<id>` only when there is not. A boot-time backfill that stamps a
 * different value than sign-in looks the row up under does not merely fail to
 * help — it hides the account and parks it on the `(provider_id, account_id)`
 * unique slot the correct row needs, which is how a working Google login turned
 * into `?error=unable_to_link_account`.
 *
 * So this gate asserts the two agree, provider by provider, against better-auth's
 * OWN factory list. A dependency bump that gives another provider an issuer of
 * its own (or takes one away) turns this red instead of silently mis-stamping
 * that provider's users on the next boot.
 */

/** Enough options to construct every factory; unused keys are ignored. */
const PROBE_OPTIONS = {
  clientId: 'probe-client-id',
  clientSecret: 'probe-client-secret',
  tenantId: 'probe-tenant',
  region: 'us-east-1',
  userPoolId: 'pool-1',
  domain: 'probe.example.com',
  issuer: 'https://probe.example.com',
} as const;

interface ProbedProvider {
  id: string;
  accountIssuer: unknown;
}

function instantiateAll(): ProbedProvider[] {
  const probed: ProbedProvider[] = [];
  const broken: string[] = [];
  for (const id of socialProviderList) {
    const factory = (socialProviderFactories as any)[id];
    try {
      const provider = factory(PROBE_OPTIONS as any);
      probed.push({ id: provider.id, accountIssuer: provider.accountIssuer });
    } catch (e) {
      broken.push(`${id}: ${(e as Error)?.message}`);
    }
  }
  // A factory this probe can no longer construct is a provider the gate stops
  // covering — fail loudly rather than shrink the checked set in silence.
  expect(broken, 'social provider factories the parity probe could not construct').toEqual([]);
  return probed;
}

/** What better-auth will key an account by, per `resolveOAuthAccountKey`. */
function issuerBetterAuthWillUse(provider: ProbedProvider): string | 'per-login' {
  const declared = provider.accountIssuer;
  if (declared === undefined) return oauthIssuerFor(provider.id);
  if (typeof declared === 'string') return declared;
  return 'per-login';
}

/** Minimal ObjectQL stand-in — one account row, `update` patches in place. */
function makeQl(row: Record<string, any>) {
  const tables: Record<string, any[]> = { sys_account: [row] };
  return {
    tables,
    update: async (object: string, data: any) => {
      const target = (tables[object] ?? []).find((r) => r.id === data.id);
      if (target) Object.assign(target, data);
      return target;
    },
    find: async (object: string, query: any) => {
      const where = query?.where ?? {};
      return (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([field, value]) =>
          { if (field.startsWith('$')) throw new Error(`fake driver: unsupported operator ${field}`); return value === null ? r[field] == null : r[field] === value; },
        ),
      );
    },
  };
}

describe('account issuer parity — the backfill stamps what sign-in looks up', () => {
  it('covers every social provider better-auth ships', () => {
    const probed = instantiateAll();
    expect(probed.length).toBe(socialProviderList.length);
  });

  it('agrees with better-auth on the issuer for every provider that has a fixed one', async () => {
    const mismatches: Array<{ provider: string; betterAuth: string; backfill: string | null }> = [];

    for (const provider of instantiateAll()) {
      const expected = issuerBetterAuthWillUse(provider);
      if (expected === 'per-login') continue;

      const ql = makeQl({
        id: 'a1',
        provider_id: provider.id,
        account_id: 'subject-1',
        issuer: null,
      });
      await backfillAccountIssuer(ql, { socialProviders: [provider] });

      const stamped = ql.tables.sys_account[0].issuer ?? null;
      if (stamped !== expected) {
        mismatches.push({ provider: provider.id, betterAuth: expected, backfill: stamped });
      }
    }

    expect(mismatches, 'providers whose backfilled issuer differs from the one sign-in resolves').toEqual([]);
  });

  it('never invents an issuer for a provider that resolves one per login', async () => {
    for (const provider of instantiateAll()) {
      if (issuerBetterAuthWillUse(provider) !== 'per-login') continue;

      const ql = makeQl({
        id: 'a1',
        provider_id: provider.id,
        account_id: 'subject-1',
        issuer: null,
      });
      const res = await backfillAccountIssuer(ql, { socialProviders: [provider] });

      expect(ql.tables.sys_account[0].issuer, `${provider.id} must stay unstamped`).toBeNull();
      expect(res.unresolved).toEqual([{ providerId: provider.id, count: 1 }]);
    }
  });

  it('repairs a synthetic stamp on every provider that declares a real issuer', async () => {
    const declaring = instantiateAll().filter((p) => typeof p.accountIssuer === 'string');
    // Guards the guard: if better-auth ever ships none of these, the repair
    // case above proves nothing and this gate has quietly stopped testing.
    expect(declaring.length).toBeGreaterThan(0);

    for (const provider of declaring) {
      const ql = makeQl({
        id: 'a1',
        provider_id: provider.id,
        account_id: 'subject-1',
        issuer: oauthIssuerFor(provider.id),
      });
      const res = await backfillAccountIssuer(ql, { socialProviders: [provider] });

      expect(res.repaired, `${provider.id} mis-stamp should be repaired`).toBe(1);
      expect(ql.tables.sys_account[0].issuer).toBe(provider.accountIssuer);
    }
  });

  it('google — the provider this defect shipped on — resolves to its real issuer', () => {
    const google = (socialProviderFactories as any).google(PROBE_OPTIONS as any);
    expect(google.accountIssuer).toBe('https://accounts.google.com');
    expect(oauthIssuerFor('google')).toBe('local:oauth:google');
  });
});
