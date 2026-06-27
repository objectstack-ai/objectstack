// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, vi } from 'vitest';
import { runRegisterSamlProviderFromForm } from './register-sso-provider';

const makeReq = (body: any) =>
  new Request('http://localhost:3000/api/v1/auth/admin/sso/register-saml', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=abc' },
    body: JSON.stringify(body),
  });

describe('runRegisterSamlProviderFromForm (ADR-0069 P3)', () => {
  it('reshapes flat fields into nested samlConfig + derives the ACS URL, re-dispatching to /sso/register', async () => {
    let dispatched: { url: string; body: any } | null = null;
    const handle = vi.fn(async (req: Request) => {
      dispatched = { url: req.url, body: await req.clone().json() };
      return new Response(JSON.stringify({ providerId: 'acme-saml' }), { status: 200 });
    });

    const res = await runRegisterSamlProviderFromForm(handle, makeReq({
      providerId: 'acme-saml',
      issuer: 'https://idp.acme.com/entity',
      domain: 'acme.com',
      entryPoint: 'https://idp.acme.com/sso',
      cert: 'MIICert...',
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.acsUrl).toBe('http://localhost:3000/api/v1/auth/sso/saml2/sp/acs/acme-saml');
    expect(res.body.spMetadataUrl).toBe('http://localhost:3000/api/v1/auth/sso/saml2/sp/metadata?providerId=acme-saml');
    // re-dispatched to the real /sso/register with the nested shape
    expect(dispatched!.url).toBe('http://localhost:3000/api/v1/auth/sso/register');
    expect(dispatched!.body).toMatchObject({
      providerId: 'acme-saml',
      issuer: 'https://idp.acme.com/entity',
      domain: 'acme.com',
      samlConfig: {
        entryPoint: 'https://idp.acme.com/sso',
        cert: 'MIICert...',
        callbackUrl: 'http://localhost:3000/api/v1/auth/sso/saml2/sp/acs/acme-saml',
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        spMetadata: { entityID: 'http://localhost:3000/api/v1/auth/sso/saml2/sp/metadata?providerId=acme-saml' },
      },
    });
    // forwards the caller's session cookie
    // (handle saw the inner request — cookie carried through)
  });

  it('rejects with 400 when required SAML fields are missing', async () => {
    const handle = vi.fn();
    const res = await runRegisterSamlProviderFromForm(handle, makeReq({ providerId: 'x', domain: 'acme.com' }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('invalid_request');
    expect(handle).not.toHaveBeenCalled();
  });

  it('surfaces a better-auth failure as saml_register_failed', async () => {
    const handle = vi.fn(async () => new Response(JSON.stringify({ message: 'bad cert' }), { status: 400 }));
    const res = await runRegisterSamlProviderFromForm(handle, makeReq({
      providerId: 'p', issuer: 'i', domain: 'd.com', entryPoint: 'e', cert: 'c',
    }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('saml_register_failed');
    expect(res.body.error?.message).toBe('bad cert');
  });
});
