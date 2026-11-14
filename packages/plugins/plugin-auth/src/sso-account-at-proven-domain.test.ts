// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * With SSO domain verification on, a provider creates an account only for an
 * email address at a domain it has proven — `sso-account-at-proven-domain.ts`
 * states the rule. This file pins the module on its own inputs; the sign-ins
 * that reach it through the real vendor are pinned in
 * `sso-oidc-refusal-cause.test.ts` (OIDC) and `sso-saml-refusal-landing.test.ts`
 * (SAML).
 */

import { describe, expect, it, vi } from 'vitest';
import { EMAIL_DOMAIN_NOT_ALLOWED } from './audience-posture.js';
import {
  SSO_ACCOUNT_DOMAIN_REFUSAL_DESCRIPTION,
  refuseSsoAccountOutsideProvenDomain,
  ssoAddressAtProvenDomain,
  ssoAddressDomain,
  ssoDomainEntryHosts,
  ssoDomainEntryNotBare,
  ssoProviderProvenDomains,
  type SsoAccountDomainRuleDeps,
} from './sso-account-at-proven-domain.js';
import { judgeScimSsoAdoption, type ScimSsoAdoptionEngine } from './scim-sso-adoption.js';
import { providerDomains } from './sso-provider-lifecycle.js';

const PROVIDER = 'acme-okta';

const creation = (email: unknown, method = 'sso-oidc', providerId: string = PROVIDER) => ({
  user: { email },
  source: { action: 'create-user', method, sso: { providerId } },
});

const row = (fields: Record<string, unknown> = {}) => ({
  provider_id: PROVIDER,
  domain: 'acme.com',
  domain_verified: 1,
  ...fields,
});

const readerOf = (rows: unknown[]) => ({ find: vi.fn(async () => rows) });

const deps = (over: Partial<SsoAccountDomainRuleDeps> = {}): SsoAccountDomainRuleDeps => ({
  verificationEnabled: () => true,
  reader: readerOf([row()]),
  ...over,
});

const REFUSED = { error: EMAIL_DOMAIN_NOT_ALLOWED, errorDescription: SSO_ACCOUNT_DOMAIN_REFUSAL_DESCRIPTION };

describe('an address is compared in the one spelling the provider list is parsed in', () => {
  it('case, and punycode against Unicode for an internationalised name, are one domain', () => {
    expect(ssoAddressDomain('Bob@ACME.Com')).toBe('acme.com');
    expect(ssoAddressDomain('bob@bücher.de')).toBe('xn--bcher-kva.de');
    expect(ssoAddressDomain('bob@BÜCHER.de')).toBe('xn--bcher-kva.de');
    expect(ssoAddressDomain('bob@XN--BCHER-KVA.de')).toBe('xn--bcher-kva.de');
    expect(ssoProviderProvenDomains(row({ domain: 'Bücher.DE.' }), PROVIDER)).toEqual(['xn--bcher-kva.de']);
  });

  it('a domain part that only folds into a spelling has no domain: full-width letters, a variation selector, a trailing dot', () => {
    for (const email of [
      'bob@\uFF41\uFF43\uFF4D\uFF45.com',
      'bob@acme\uFE0F.com',
      'bob@acme.com.',
      'bob@127.1',
    ]) {
      expect(ssoAddressDomain(email), JSON.stringify(email)).toBeNull();
    }
  });

  it('the domain is everything after the last @', () => {
    expect(ssoAddressDomain('"a@other.example"@acme.com')).toBe('acme.com');
  });

  it('a domain part that is not already a bare host has no domain', () => {
    for (const email of [
      'bob@acme.com:443',
      'bob@acme.com/x',
      'bob@acme.com?x',
      'bob@acme.com#x',
      'bob@acme.com\\x',
      'bob@acme .com',
      'bob@acme%2ecom',
      'bob@acme.com,other.example',
      'bob@',
      'bob.acme.com',
      '',
      undefined,
      42,
    ]) {
      expect(ssoAddressDomain(email), String(email)).toBeNull();
    }
  });
});

describe("a provider's verified domains are its listed domains, only when domain_verified reads on", () => {
  it('every listed entry, when the flag is on', () => {
    expect(ssoProviderProvenDomains(row({ domain: 'acme.com, acme.co.uk' }), PROVIDER)).toEqual(['acme.com', 'acme.co.uk']);
    expect(ssoProviderProvenDomains(row({ domain_verified: true }), PROVIDER)).toEqual(['acme.com']);
  });

  it('none, when the flag is off, 0, null, the string 1 or missing', () => {
    for (const domain_verified of [false, 0, null, '1', 'true', undefined]) {
      expect(ssoProviderProvenDomains(row({ domain_verified }), PROVIDER), String(domain_verified)).toEqual([]);
    }
  });

  it('an entry counts only for the host the provider proved: one not written as a bare host proves nothing', () => {
    for (const domain of [
      'victim.example\\@evil.example',
      'victim.example\\evil.example',
      'victim.example@evil.example',
      'victim.example?evil.example',
      'victim.example#evil.example',
      'victim%2eexample',
      'victim.example:443',
      'victim.example/x',
      'https://victim.example',
      '\uFF56ictim.example',
    ]) {
      expect(ssoProviderProvenDomains(row({ domain }), PROVIDER), domain).toEqual([]);
      expect(ssoAddressAtProvenDomain('ceo@victim.example', ssoProviderProvenDomains(row({ domain }), PROVIDER)), domain).toBe(false);
    }
  });

  it('a good entry beside one that proves nothing still counts', () => {
    const proven = ssoProviderProvenDomains(row({ domain: 'victim.example\\@evil.example, acme.com' }), PROVIDER);
    expect(proven).toEqual(['acme.com']);
    expect(ssoAddressAtProvenDomain('bob@acme.com', proven)).toBe(true);
    expect(ssoAddressAtProvenDomain('ceo@victim.example', proven)).toBe(false);
  });

  it("none, for another provider's row or no row", () => {
    expect(ssoProviderProvenDomains(row({ provider_id: 'other-idp' }), PROVIDER)).toEqual([]);
    expect(ssoProviderProvenDomains(undefined, PROVIDER)).toEqual([]);
    expect(ssoProviderProvenDomains(row(), '')).toEqual([]);
  });

  it('an address matches a verified domain by equality only', () => {
    const proven = ['acme.com', 'eng.example'];
    expect(ssoAddressAtProvenDomain('bob@acme.com', proven)).toBe(true);
    expect(ssoAddressAtProvenDomain('bob@eng.example', proven)).toBe(true);
    for (const email of ['bob@x.acme.com', 'bob@example', 'bob@acme.com.evil.example', 'bob@evilacme.com', 'bob@acme.co']) {
      expect(ssoAddressAtProvenDomain(email, proven), email).toBe(false);
    }
  });
});

describe('with SSO domain verification on, a provider creates an account only at a domain it has proven', () => {
  it('admits an address at a listed domain of a verified provider, OIDC and SAML', async () => {
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps())).toBeUndefined();
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com', 'sso-saml'), deps())).toBeUndefined();
  });

  it('refuses an address at any other domain, naming the rule and no domain', async () => {
    const refused = await refuseSsoAccountOutsideProvenDomain(creation('bob@other.example'), deps());
    expect(refused).toEqual(REFUSED);
    expect(refused?.errorDescription).not.toMatch(/acme|other\.example/);
  });

  it('reads the provider the source names, as one row', async () => {
    const reader = readerOf([row()]);
    await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader }));
    expect(reader.find).toHaveBeenCalledWith('sys_sso_provider', { where: { provider_id: PROVIDER }, limit: 1 });
  });

  for (const domain_verified of [false, 0, null, '1']) {
    it(`refuses when domain_verified reads ${JSON.stringify(domain_verified)}`, async () => {
      const reader = readerOf([row({ domain_verified })]);
      expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader }))).toEqual(REFUSED);
    });
  }

  it('refuses when there is no provider row', async () => {
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader: readerOf([]) }))).toEqual(REFUSED);
  });

  it('refuses when the row read is for another provider', async () => {
    const reader = readerOf([row({ provider_id: 'other-idp' })]);
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader }))).toEqual(REFUSED);
  });

  it('refuses when the source names no provider', async () => {
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com', 'sso-oidc', ''), deps())).toEqual(REFUSED);
  });

  it('refuses, and says so once at warn, when the reader throws', async () => {
    const warn = vi.fn();
    const reader = { find: vi.fn(async () => { throw new Error('store down'); }) };
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader, logger: { warn } }))).toEqual(REFUSED);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses when there is no engine to read with', async () => {
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@acme.com'), deps({ reader: undefined }))).toEqual(REFUSED);
  });

  it('refuses an asserted email that is not an address, or whose domain part carries a port or a path', async () => {
    for (const email of ['bob.acme.com', 'bob@acme.com:443', 'bob@acme.com/x', undefined]) {
      expect(await refuseSsoAccountOutsideProvenDomain(creation(email), deps()), String(email)).toEqual(REFUSED);
    }
  });

  it('CONTROL: with verification off, nothing is judged and nothing is read', async () => {
    const reader = readerOf([]);
    const off = deps({ verificationEnabled: () => false, reader });
    expect(await refuseSsoAccountOutsideProvenDomain(creation('bob@other.example'), off)).toBeUndefined();
    expect(reader.find).not.toHaveBeenCalled();
  });

  it('CONTROL: only a creation through an SSO provider is judged', async () => {
    const reader = readerOf([]);
    const d = deps({ reader });
    const outside = 'bob@other.example';
    expect(await refuseSsoAccountOutsideProvenDomain({ ...creation(outside), source: { action: 'link-account', method: 'sso-oidc', sso: { providerId: PROVIDER } } }, d)).toBeUndefined();
    expect(await refuseSsoAccountOutsideProvenDomain({ ...creation(outside), source: { action: 'create-user', method: 'oauth', oauth: { providerId: 'objectstack-cloud' } } }, d)).toBeUndefined();
    expect(await refuseSsoAccountOutsideProvenDomain({ ...creation(outside), source: { action: 'create-user', method: 'scim' } }, d)).toBeUndefined();
    expect(await refuseSsoAccountOutsideProvenDomain(undefined, d)).toBeUndefined();
    expect(reader.find).not.toHaveBeenCalled();
  });
});

// ── [#32975] [#32960] One parse for every rule that reads the domain list ──────

/**
 * Entry spellings: bare hosts in several spellings, and shapes that are not a
 * bare host (a URL, a port, a path, a user part, an escape, full-width
 * letters, a dot run).
 */
const ENTRY_SPELLINGS = [
  'acme.com',
  'ACME.com',
  ' acme.com ',
  'acme.com.',
  'bücher.de',
  'xn--bcher-kva.de',
  'https://acme.com',
  'https://acme.com/',
  'acme.com:443',
  'acme.com/x',
  'u@acme.com',
  'acme%2ecom',
  '\uff41\uff43\uff4d\uff45.com',
  'acme.com..',
];
const ADDRESSES = ['bob@acme.com', 'bob@ACME.com', 'bob@xn--bcher-kva.de', 'bob@bücher.de', 'bob@\uff41\uff43\uff4d\uff45.com'];

/** The SCIM adoption rule over one provider row: every condition but the domain holds. */
async function scimAdopts(entry: string, email: string): Promise<boolean> {
  const tables: Record<string, unknown[]> = {
    sys_user: [{ id: 'usr_1', email: email.toLowerCase(), source: 'idp_provisioned' }],
    sys_account: [{ provider_id: PROVIDER }],
    sys_scim_subject: [],
    sys_sso_provider: [{ provider_id: PROVIDER, organization_id: 'org_1', domain: entry, domain_verified: 1 }],
  };
  const engine: ScimSsoAdoptionEngine = { find: async (object) => tables[object] ?? [] };
  const verdict = await judgeScimSsoAdoption(engine, { email, organizationId: 'org_1' });
  return verdict.adopt;
}

describe('[#32975] every rule that reads a provider domain list reads each entry the same way', () => {
  it('the account rule and the SCIM adoption rule judge every entry spelling and address identically', async () => {
    const disagreements: string[] = [];
    for (const entry of ENTRY_SPELLINGS) {
      for (const email of ADDRESSES) {
        const account = ssoAddressAtProvenDomain(email, ssoProviderProvenDomains(row({ domain: entry }), PROVIDER));
        const scim = await scimAdopts(entry, email);
        if (account !== scim) disagreements.push(`${JSON.stringify(entry)} × ${email}: account ${account}, scim ${scim}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('an entry the shared parse does not accept names no domain for SCIM either', async () => {
    for (const entry of ['https://acme.com', 'acme.com:443', 'acme.com/x', 'u@acme.com']) {
      expect(ssoDomainEntryHosts(entry), entry).toEqual([]);
      expect(await scimAdopts(entry, 'bob@acme.com'), entry).toBe(false);
    }
  });

  it('SCIM reads an entry and an address in their one spelling: a root dot and the punycode form are the same domain', async () => {
    expect(await scimAdopts('acme.com.', 'bob@acme.com')).toBe(true);
    expect(await scimAdopts('bücher.de', 'bob@xn--bcher-kva.de')).toBe(true);
    expect(await scimAdopts('xn--bcher-kva.de', 'bob@bücher.de')).toBe(true);
  });

  it('CONTROL: a bare host name names its domain under the claim rule, the account rule and the SCIM rule', async () => {
    expect(providerDomains('acme.com')).toEqual(['acme.com']);
    expect(ssoProviderProvenDomains(row({ domain: 'acme.com' }), PROVIDER)).toEqual(['acme.com']);
    expect(await scimAdopts('acme.com', 'bob@acme.com')).toBe(true);
  });

  it('[#32960] every entry register and edit accept names the same domains under the claim rule as under the shared parse', () => {
    for (const entry of ENTRY_SPELLINGS) {
      const refusal = ssoDomainEntryNotBare(entry);
      if (refusal === undefined) {
        expect(providerDomains(entry), JSON.stringify(entry)).toEqual(ssoDomainEntryHosts(entry));
      } else {
        expect(ssoDomainEntryHosts(entry), JSON.stringify(entry)).toEqual([]);
      }
    }
  });
});

describe('[#32960] a requested domain entry that is not a bare host name is refused', () => {
  it('names the entry, on domain, with VALIDATION_FAILED / invalid_value', () => {
    for (const entry of ['https://acme.com', 'acme.com:443', 'acme.com/x', 'u@acme.com', 'acme%2ecom', 'acme.com..']) {
      const refusal = ssoDomainEntryNotBare(`good.example, ${entry}`);
      expect(refusal, entry).toMatchObject({
        status: 'BAD_REQUEST',
        code: 'VALIDATION_FAILED',
        field: 'domain',
        fields: [{ field: 'domain', code: 'invalid_value' }],
      });
      expect(refusal!.message, entry).toContain(`'${entry}'`);
    }
  });

  it('CONTROL: bare host names pass, in any case, with a root dot, internationalised, and with blank entries', () => {
    for (const domain of ['acme.com', 'ACME.com, eng.acme.com', 'acme.com.', 'bücher.de', 'xn--bcher-kva.de', 'acme.com, , globex.io', '']) {
      expect(ssoDomainEntryNotBare(domain), domain).toBeUndefined();
    }
    expect(ssoDomainEntryNotBare(undefined)).toBeUndefined();
  });
});
