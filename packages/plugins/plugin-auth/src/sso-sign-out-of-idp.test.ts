// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Sign out of the company sign-in too" — the save-time capability judge and
 * the small helpers of `sso-sign-out-of-idp.ts`, read off their own inputs.
 * The sign-out itself is pinned end to end in `sso-saml-refusal-landing.test.ts`
 * (SAML single logout) and `sso-oidc-refusal-cause.test.ts` (OIDC logout).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SAML_HTTP_POST_BINDING,
  SAML_HTTP_REDIRECT_BINDING,
  judgeSignOutOfIdpCapability,
  oidcEndSessionUrl,
  samlConfigHasLogoutAddress,
  samlLogoutServiceOf,
  samlSingleLogoutProviderId,
} from './sso-sign-out-of-idp';
// The judge loads the vendor's discovery helpers lazily; paid at module load.
import '@better-auth/sso';

const IDP = 'https://idp.example.test';
const trusted = (url: string) => url.startsWith(`${IDP}/`) || url === IDP;
const SLO = [{ Binding: SAML_HTTP_REDIRECT_BINDING, Location: `${IDP}/slo` }];

describe('saving "sign out of the company sign-in too" on is refused for a provider that cannot honour it', () => {
  it('SAML with no logout address: refused, on the signOutOfIdp field', async () => {
    const verdict = await judgeSignOutOfIdpCapability({
      providerId: 'acme-saml',
      stored: { samlConfig: JSON.stringify({ entryPoint: `${IDP}/sso`, idpMetadata: { entityID: IDP } }) },
      isTrustedOrigin: trusted,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.refusal).toMatchObject({ status: 'BAD_REQUEST', code: 'VALIDATION_FAILED', field: 'signOutOfIdp' });
    expect(verdict.refusal.message).toMatch(/IdP Logout URL/);
  });

  it('SAML with a logout address, stored or in the same save: accepted, nothing to keep', async () => {
    const stored = await judgeSignOutOfIdpCapability({
      providerId: 'acme-saml',
      stored: { samlConfig: { idpMetadata: { entityID: IDP, singleLogoutService: SLO } } },
      isTrustedOrigin: trusted,
    });
    expect(stored).toEqual({ ok: true });
    const inBody = await judgeSignOutOfIdpCapability({
      providerId: 'acme-saml',
      stored: { samlConfig: { idpMetadata: { entityID: IDP } } },
      body: { samlConfig: { idpMetadata: { singleLogoutService: SLO } } },
      isTrustedOrigin: trusted,
    });
    expect(inBody).toEqual({ ok: true });
  });

  const oidc = (document: Record<string, unknown> | Error) => {
    const fetchDiscovery = vi.fn(async () => {
      if (document instanceof Error) throw document;
      return document;
    });
    return {
      fetchDiscovery,
      judge: () =>
        judgeSignOutOfIdpCapability({
          providerId: 'acme-okta',
          issuer: IDP,
          stored: { oidcConfig: JSON.stringify({ issuer: IDP, clientId: 'c', discoveryEndpoint: `${IDP}/.well-known/openid-configuration` }) },
          isTrustedOrigin: trusted,
          fetchDiscovery,
        }),
    };
  };

  it('OIDC whose discovery names no end_session_endpoint: refused', async () => {
    const { judge, fetchDiscovery } = oidc({ issuer: IDP, authorization_endpoint: `${IDP}/authorize` });
    const verdict = await judge();
    expect(fetchDiscovery).toHaveBeenCalledWith(`${IDP}/.well-known/openid-configuration`, trusted);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal.message).toMatch(/end_session_endpoint/);
  });

  it('OIDC whose end_session_endpoint is on an origin the deployment does not trust: refused', async () => {
    const verdict = await oidc({ issuer: IDP, end_session_endpoint: 'https://elsewhere.example/logout' }).judge();
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal.field).toBe('signOutOfIdp');
  });

  it('OIDC whose discovery cannot be read: refused, not saved silently', async () => {
    const verdict = await oidc(new Error('discovery unreachable')).judge();
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal.message).toMatch(/discovery unreachable/);
  });

  it('OIDC with a trusted end_session_endpoint: accepted, and the endpoint is answered to be kept', async () => {
    const verdict = await oidc({ issuer: IDP, end_session_endpoint: `${IDP}/oauth2/logout` }).judge();
    expect(verdict).toEqual({ ok: true, endSessionEndpoint: `${IDP}/oauth2/logout` });
  });

  it('a provider with neither configuration: refused', async () => {
    const verdict = await judgeSignOutOfIdpCapability({ providerId: 'bare', isTrustedOrigin: trusted });
    expect(verdict.ok).toBe(false);
  });
});

describe('the IdP Logout URL field', () => {
  it('stores one http(s) address under both bindings', () => {
    expect(samlLogoutServiceOf(`${IDP}/slo`)).toEqual({
      service: [
        { Binding: SAML_HTTP_REDIRECT_BINDING, Location: `${IDP}/slo` },
        { Binding: SAML_HTTP_POST_BINDING, Location: `${IDP}/slo` },
      ],
    });
  });

  it('refuses a value that is not an http(s) URL', () => {
    expect(samlLogoutServiceOf('not a url')).toHaveProperty('refusal');
    expect(samlLogoutServiceOf('javascript:alert(1)')).toHaveProperty('refusal');
  });

  it('a stored address, as the field writes it, is what the capability judge reads', () => {
    const written = samlLogoutServiceOf(`${IDP}/slo`);
    if (!('service' in written)) throw new Error('expected a service');
    expect(samlConfigHasLogoutAddress({ idpMetadata: { singleLogoutService: written.service } })).toBe(true);
    expect(samlConfigHasLogoutAddress({ idpMetadata: { singleLogoutService: [{ Binding: SAML_HTTP_POST_BINDING, Location: ' ' }] } })).toBe(false);
    expect(samlConfigHasLogoutAddress(undefined)).toBe(false);
  });
});

describe('the SAML single-logout paths run with the provider switch in scope', () => {
  const req = (method: string, url = 'http://localhost/x') => new Request(url, { method });

  it('names the provider of the IdP logout endpoint, the SP-initiated logout and the SP metadata', () => {
    expect(samlSingleLogoutProviderId('/sso/saml2/sp/slo/acme', req('POST'))).toBe('acme');
    expect(samlSingleLogoutProviderId('/sso/saml2/sp/slo/acme', req('GET'))).toBe('acme');
    expect(samlSingleLogoutProviderId('/sso/saml2/logout/acme', req('POST'))).toBe('acme');
    expect(samlSingleLogoutProviderId('/sso/saml2/sp/metadata', req('GET', 'http://localhost/x?providerId=acme'))).toBe('acme');
  });

  it('names nothing for any other path or method', () => {
    expect(samlSingleLogoutProviderId('/sso/saml2/logout/acme', req('GET'))).toBeUndefined();
    expect(samlSingleLogoutProviderId('/sso/saml2/sp/slo/acme/extra', req('POST'))).toBeUndefined();
    expect(samlSingleLogoutProviderId('/sso/saml2/sp/metadata', req('GET'))).toBeUndefined();
    expect(samlSingleLogoutProviderId('/sign-out', req('POST'))).toBeUndefined();
    expect(samlSingleLogoutProviderId(undefined, req('POST'))).toBeUndefined();
  });
});

describe('the OIDC logout URL', () => {
  it('carries the ID token as id_token_hint, with client_id, the return address and state', () => {
    const url = new URL(
      oidcEndSessionUrl(`${IDP}/oauth2/logout?tenant=acme`, {
        idToken: 'header.payload.signature',
        clientId: 'acme-client-id',
        postLogoutRedirectUri: 'http://localhost:3000/signed-out',
        state: 's1',
      }),
    );
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('id_token_hint')).toBe('header.payload.signature');
    expect(url.searchParams.get('client_id')).toBe('acme-client-id');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:3000/signed-out');
    expect(url.searchParams.get('state')).toBe('s1');
  });

  it('leaves out every member it was not given', () => {
    expect(oidcEndSessionUrl(`${IDP}/oauth2/logout`, {})).toBe(`${IDP}/oauth2/logout`);
  });
});
