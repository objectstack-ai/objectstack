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
  ssoProviderProvenDomains,
  type SsoAccountDomainRuleDeps,
} from './sso-account-at-proven-domain.js';

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
  it('case, a trailing dot, and punycode against Unicode are one domain', () => {
    expect(ssoAddressDomain('Bob@ACME.Com')).toBe('acme.com');
    expect(ssoAddressDomain('bob@acme.com.')).toBe('acme.com');
    expect(ssoAddressDomain('bob@bücher.de')).toBe('xn--bcher-kva.de');
    expect(ssoAddressDomain('bob@XN--BCHER-KVA.de')).toBe('xn--bcher-kva.de');
    expect(ssoProviderProvenDomains(row({ domain: 'Bücher.DE.' }), PROVIDER)).toEqual(['xn--bcher-kva.de']);
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
