// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { sso } from '@better-auth/sso';
import { runRegisterSamlProviderFromForm, runRegisterSsoProviderFromForm } from './register-sso-provider';

const makeReq = (body: any) =>
  new Request('http://localhost:3000/api/v1/auth/admin/sso/register-saml', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=abc' },
    body: JSON.stringify(body),
  });

const makeOidcReq = (body: any) =>
  new Request('http://localhost:3000/api/v1/auth/admin/sso/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });

const OIDC_FORM = {
  providerId: 'acme',
  issuer: 'https://idp.acme.com',
  domain: 'acme.com',
  clientId: 'cid',
  clientSecret: 'csecret',
};

/**
 * A REAL `betterAuth()` instance carrying the REAL `@better-auth/sso` plugin, so
 * the body this bridge emits is judged by the installed package's own Zod
 * schema — not by a hand-copied restatement of it that would drift silently on
 * the next dependency bump.
 */
const makeRealAuthHandler = () => {
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    basePath: '/api/v1/auth',
    secret: 'register-sso-provider-test-secret-0123456789',
    database: memoryAdapter({}),
    plugins: [sso()],
  });
  return (request: Request) => auth.handler(request);
};

describe('runRegisterSsoProviderFromForm (OIDC) — the emitted body must satisfy the INSTALLED @better-auth/sso schema', () => {
  // Regression pin for the end-to-end break where the bridge always emitted
  // `oidcConfig.mapping.id`, which `oidcMappingSchema` (a `z.strictObject` with
  // no `id` member since 1.7.0-rc.2) rejects outright — every OIDC registration
  // answered `400 [body.oidcConfig.mapping] Unrecognized key: "id"`. "since
  // 1.7.0-rc.2" is provenance, not a stamp: the member has been absent from
  // every release since, the installed `@better-auth/sso@1.7.1` included
  // (`dist/index.mjs:1852`, re-read 2026-08-20).
  //
  // These cases drive the REAL `/sso/register` endpoint. `@better-auth/sso`
  // validates the request body BEFORE the endpoint's session gate, so an
  // unauthenticated call separates the two failure modes cleanly:
  //   • body rejected by the schema → 400 VALIDATION_ERROR (the bug)
  //   • body accepted, stopped by the gate → 401 Unauthorized (the fix)
  // Reaching 401 is therefore positive evidence that the emitted body parsed.
  it('clears the real body schema and reaches the endpoint session gate', async () => {
    const res = await runRegisterSsoProviderFromForm(makeRealAuthHandler(), makeOidcReq(OIDC_FORM));

    expect(res.body.error?.message ?? '').not.toMatch(/Unrecognized key/);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('SSO_REGISTER_FAILED');
    expect(res.body.error?.message).toBe('Unauthorized');
  });

  it('clears the real body schema with operator-supplied claim mappings too', async () => {
    const res = await runRegisterSsoProviderFromForm(
      makeRealAuthHandler(),
      makeOidcReq({ ...OIDC_FORM, mapEmail: 'upn', mapName: 'display_name', scopes: 'openid email' }),
    );

    expect(res.body.error?.message ?? '').not.toMatch(/Unrecognized key/);
    expect(res.status).toBe(401);
  });

  it('emits exactly the strict schema’s required members — never the retired `id`', async () => {
    let dispatched: any = null;
    const handle = vi.fn(async (req: Request) => {
      if (req.url.endsWith('/get-session')) return new Response('null', { status: 200 });
      dispatched = await req.clone().json();
      return new Response(JSON.stringify({ providerId: 'acme' }), { status: 200 });
    });

    const res = await runRegisterSsoProviderFromForm(handle, makeOidcReq(OIDC_FORM));

    expect(res.status).toBe(200);
    expect(dispatched.oidcConfig.mapping).toEqual({ email: 'email', name: 'name' });
    expect(Object.keys(dispatched.oidcConfig.mapping)).not.toContain('id');
  });

  // The subject claim is no longer configurable anywhere in the plugin: rc.2
  // reads it from `sub` and overwrites any `extraFields.id` with it. Telling the
  // caller beats accepting a value we would silently discard.
  it('rejects a non-`sub` user-ID claim loudly instead of silently discarding it', async () => {
    const handle = vi.fn();
    const res = await runRegisterSsoProviderFromForm(handle, makeOidcReq({ ...OIDC_FORM, mapId: 'employee_id' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(res.body.error?.message).toMatch(/not configurable/);
    expect(handle).not.toHaveBeenCalled();
  });

  it('accepts an explicit `sub` (the value the form field suggests) as the no-op it is', async () => {
    const res = await runRegisterSsoProviderFromForm(
      makeRealAuthHandler(),
      makeOidcReq({ ...OIDC_FORM, mapId: 'sub' }),
    );

    expect(res.status).toBe(401);
    expect(res.body.error?.message).toBe('Unauthorized');
  });
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
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(handle).not.toHaveBeenCalled();
  });

  it('surfaces a better-auth failure as saml_register_failed', async () => {
    const handle = vi.fn(async () => new Response(JSON.stringify({ message: 'bad cert' }), { status: 400 }));
    const res = await runRegisterSamlProviderFromForm(handle, makeReq({
      providerId: 'p', issuer: 'i', domain: 'd.com', entryPoint: 'e', cert: 'c',
    }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('SAML_REGISTER_FAILED');
    expect(res.body.error?.message).toBe('bad cert');
  });
});
