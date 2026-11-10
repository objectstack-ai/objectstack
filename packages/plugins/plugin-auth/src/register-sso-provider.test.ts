// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { sso } from '@better-auth/sso';
import {
  attributeMappingOf,
  groupsClaimOfMapping,
  mappingWithAttributes,
  mappingWithGroupsClaim,
  runRegisterSamlProviderFromForm,
  runRegisterSsoProviderFromForm,
  runSetSsoAttributeMapping,
  runSetSsoGroupsClaim,
  runShowSsoAttributeMapping,
  runShowSsoGroupsClaim,
  type StoredSsoProviderConfigs,
} from './register-sso-provider';
import { AuthPlugin } from './auth-plugin';
import type { PluginContext } from '@objectstack/core';

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
    // re-dispatched to the real /sso/register with the nested shape — with
    // `disableRefresh`, because this request carries a session cookie (#22398:
    // the inner read must not renew a session whose cookie this bridge never
    // sends back; `in-process-session-renewal.pin.test.ts` measures it).
    expect(dispatched!.url).toBe('http://localhost:3000/api/v1/auth/sso/register?disableRefresh=true');
    expect(dispatched!.body).toMatchObject({
      providerId: 'acme-saml',
      issuer: 'https://idp.acme.com/entity',
      domain: 'acme.com',
      samlConfig: {
        entryPoint: 'https://idp.acme.com/sso',
        cert: 'MIICert...',
        callbackUrl: 'http://localhost:3000/api/v1/auth/sso/saml2/sp/acs/acme-saml',
        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        // the form's "IdP Entity ID" is the IdP descriptor's EntityID
        idpMetadata: { entityID: 'https://idp.acme.com/entity' },
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

describe('Register SAML Provider through the REAL route — the INSTALLED @better-auth/sso judges the form', () => {
  // The mocked cases above pin the shape the bridge emits; this block pins that
  // the vendor ACCEPTS it. Before `idpMetadata.entityID` was sent, every
  // complete form answered `400 SAML_REGISTER_FAILED` "[body.samlConfig.
  // idpMetadata] idpMetadata.entityID is required when IdP metadata XML is not
  // provided", and nothing here could see it: every SAML case used a stand-in
  // for `/sso/register`.
  //
  // Wiring: the plugin's own `registerAuthRoutes` mounts the bridge on a real
  // Hono app; the auth manager is reduced to the two seams the route reads.
  // `handleRequest` IS the real vendor handler, so the inner `/sso/register`
  // runs its real schema, session gate and storage. The ADR-0068 platform-admin
  // gate is judged on a platform-admin session shape (its own file,
  // admin-sso-bridge-gate.test.ts, pins the refusals), while the vendor sees
  // the REAL session cookie of a signed-up user.
  const ORIGIN = 'http://localhost:3000';
  const BASE = '/api/v1/auth';
  const COMPLETE_FORM = {
    providerId: 'acme-saml',
    issuer: 'https://idp.acme.example/entity',
    domain: 'acme.example',
    entryPoint: 'https://idp.acme.example/sso',
    cert: 'MIIC-PROBE-CERT',
  };

  let db: Record<string, any[]>;
  let app: Hono;
  let cookie: string;

  beforeAll(async () => {
    db = { user: [], session: [], account: [], verification: [], ssoProvider: [] };
    const vendor = betterAuth({
      baseURL: ORIGIN,
      basePath: BASE,
      secret: 'register-saml-real-route-secret-0123456789',
      database: memoryAdapter(db),
      emailAndPassword: { enabled: true },
      plugins: [sso()],
    });
    const signUp = await vendor.handler(
      new Request(`${ORIGIN}${BASE}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'admin@example.com', password: 'Admin-Pass-123!', name: 'Admin' }),
      }),
    );
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token');

    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn(),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!', plugins: { oidcProvider: false } });
    await plugin.init(ctx);
    (plugin as any).authManager = {
      handleRequest: (req: Request) => vendor.handler(req),
      getApi: async () => ({
        getSession: async () => ({ user: { id: 'usr_admin', positions: ['user', 'platform_admin'], isPlatformAdmin: true } }),
      }),
      isSsoDomainVerificationEnabled: () => false,
    };
    app = new Hono();
    (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  });

  const post = (form: Record<string, unknown>) =>
    app.request(`${ORIGIN}${BASE}/admin/sso/register-saml`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify(form),
    });

  it('a complete form registers the provider: 200, one stored provider keyed on the IdP EntityID', async () => {
    const res = await post(COMPLETE_FORM);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.providerId).toBe('acme-saml');
    expect(body.acsUrl).toBe(`${ORIGIN}${BASE}/sso/saml2/sp/acs/acme-saml`);

    expect(db.ssoProvider).toHaveLength(1);
    const stored = JSON.parse(db.ssoProvider[0].samlConfig);
    expect(stored.idpMetadata).toEqual({ entityID: 'https://idp.acme.example/entity' });
    expect(stored.entryPoint).toBe('https://idp.acme.example/sso');
  });

  it('an incomplete form is still refused before the vendor, naming the missing field', async () => {
    const { issuer: _omitted, ...withoutEntityId } = COMPLETE_FORM;
    const storedBefore = db.ssoProvider.length;
    const res = await post({ ...withoutEntityId, providerId: 'acme-saml-2' });
    const body: any = await res.json();
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('INVALID_REQUEST');
    expect(body.error?.message).toContain('issuer');
    expect(db.ssoProvider).toHaveLength(storedBefore);
  });

  it('a groups attribute on the form is stored where the register door stores it: mapping.extraFields.groups', async () => {
    const res = await post({ ...COMPLETE_FORM, providerId: 'acme-saml-groups', mapGroups: ' memberOf ' });
    expect(res.status, await res.clone().text()).toBe(200);
    // The register door, handed the same mapping directly.
    const door = await app.request(`${ORIGIN}${BASE}/sso/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify({
        providerId: 'acme-saml-door',
        issuer: COMPLETE_FORM.issuer,
        domain: COMPLETE_FORM.domain,
        samlConfig: {
          entryPoint: COMPLETE_FORM.entryPoint,
          cert: COMPLETE_FORM.cert,
          idpMetadata: { entityID: COMPLETE_FORM.issuer },
          spMetadata: { entityID: 'door-sp' },
          mapping: { extraFields: { groups: 'memberOf' } },
        },
      }),
    });
    expect(door.status, await door.clone().text()).toBe(200);
    const mappingOf = (providerId: string) => JSON.parse(db.ssoProvider.find((p) => p.providerId === providerId).samlConfig).mapping;
    expect(mappingOf('acme-saml-groups')).toEqual({ extraFields: { groups: 'memberOf' } });
    expect(mappingOf('acme-saml-groups')).toEqual(mappingOf('acme-saml-door'));
    // CONTROL: the form without it stores no mapping, as before.
    expect(JSON.parse(db.ssoProvider.find((p) => p.providerId === 'acme-saml').samlConfig).mapping).toBeUndefined();
  });

  it('[#32086] the attribute names on the form are stored where the register door stores them: mapping.email / firstName / lastName / name', async () => {
    const ENTRA = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
    const res = await post({
      ...COMPLETE_FORM,
      providerId: 'acme-saml-mapped',
      mapEmail: ` ${ENTRA}/emailaddress `,
      mapFirstName: `${ENTRA}/givenname`,
      mapLastName: `${ENTRA}/surname`,
      mapName: 'http://schemas.microsoft.com/identity/claims/displayname',
      mapGroups: 'memberOf',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const door = await app.request(`${ORIGIN}${BASE}/sso/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify({
        providerId: 'acme-saml-mapped-door',
        issuer: COMPLETE_FORM.issuer,
        domain: COMPLETE_FORM.domain,
        samlConfig: {
          entryPoint: COMPLETE_FORM.entryPoint,
          cert: COMPLETE_FORM.cert,
          idpMetadata: { entityID: COMPLETE_FORM.issuer },
          spMetadata: { entityID: 'door-sp' },
          mapping: {
            email: `${ENTRA}/emailaddress`,
            firstName: `${ENTRA}/givenname`,
            lastName: `${ENTRA}/surname`,
            name: 'http://schemas.microsoft.com/identity/claims/displayname',
            extraFields: { groups: 'memberOf' },
          },
        },
      }),
    });
    expect(door.status, await door.clone().text()).toBe(200);
    const mappingOf = (providerId: string) => JSON.parse(db.ssoProvider.find((p) => p.providerId === providerId).samlConfig).mapping;
    expect(mappingOf('acme-saml-mapped')).toEqual(mappingOf('acme-saml-mapped-door'));
    expect(mappingOf('acme-saml-mapped').email).toBe(`${ENTRA}/emailaddress`);
  });

  // A SAML EntityID is a URI, and many IdPs publish a URN. The bridge sends the
  // form's Entity ID both as the top-level `issuer` and as
  // `idpMetadata.entityID`, and the vendor's register body types `issuer` as
  // `z.string().url()`. In the installed zod (4.6.7) that check is the WHATWG
  // URL parser, which accepts `urn:` values, so a URN form registers. A vendor
  // or zod release that narrows the check to http(s) would refuse every URN
  // IdP at the vendor's parse step; these cases turn red when that happens.
  //
  // Usable, not only stored: sign-in finds the provider by `providerId`
  // (or organization / domain), never by `issuer`, and the ACS reads the IdP
  // identity from `idpMetadata.entityID`.
  it.each([
    ['urn-oasis', 'urn:oasis:names:tc:SAML:2.0:idp:acme'],
    ['urn-short', 'urn:example:idp'],
  ])('a URN IdP Entity ID registers and starts a sign-in (%s)', async (providerId, entityId) => {
    const res = await post({ ...COMPLETE_FORM, providerId, issuer: entityId });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.providerId).toBe(providerId);

    const row = db.ssoProvider.find((p) => p.providerId === providerId);
    expect(row?.issuer).toBe(entityId);
    expect(JSON.parse(row.samlConfig).idpMetadata).toEqual({ entityID: entityId });

    const signIn = await app.request(`${ORIGIN}${BASE}/sign-in/sso`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ providerId, callbackURL: '/' }),
    });
    const started: any = await signIn.json();
    expect(signIn.status, JSON.stringify(started)).toBe(200);
    expect(started.redirect).toBe(true);
    expect(started.url.startsWith(`${COMPLETE_FORM.entryPoint}?SAMLRequest=`)).toBe(true);
  });
});

describe('the groups claim on the register forms: mapping.extraFields.groups, where the register door keeps it', () => {
  const captureOidc = async (form: Record<string, unknown>) => {
    let dispatched: any = null;
    const handle = vi.fn(async (req: Request) => {
      if (req.url.endsWith('/get-session')) return new Response('null', { status: 200 });
      dispatched = await req.clone().json();
      return new Response(JSON.stringify({ providerId: 'acme' }), { status: 200 });
    });
    const res = await runRegisterSsoProviderFromForm(handle, makeOidcReq(form));
    expect(res.status).toBe(200);
    return dispatched;
  };

  it('the OIDC form sends its groups claim beside the email and name claims', async () => {
    const sent = await captureOidc({ ...OIDC_FORM, mapGroups: ' groups ' });
    expect(sent.oidcConfig.mapping).toEqual({ email: 'email', name: 'name', extraFields: { groups: 'groups' } });
  });

  it('CONTROL: an OIDC form without it sends the mapping it sent before', async () => {
    for (const mapGroups of [undefined, '', '   ']) {
      const sent = await captureOidc({ ...OIDC_FORM, ...(mapGroups === undefined ? {} : { mapGroups }) });
      expect(sent.oidcConfig.mapping).toEqual({ email: 'email', name: 'name' });
    }
  });

  it('the OIDC body with a groups claim clears the INSTALLED vendor schema (reaches the session gate)', async () => {
    const res = await runRegisterSsoProviderFromForm(makeRealAuthHandler(), makeOidcReq({ ...OIDC_FORM, mapGroups: 'groups' }));
    expect(res.body.error?.message ?? '').not.toMatch(/Unrecognized key|Invalid/);
    expect(res.status).toBe(401);
  });

  it('the SAML form sends its groups attribute as the mapping; without it, no mapping', async () => {
    const sentFor = async (extra: Record<string, unknown>) => {
      let dispatched: any = null;
      const handle = vi.fn(async (req: Request) => {
        if (req.url.endsWith('/get-session')) return new Response('null', { status: 200 });
        dispatched = await req.clone().json();
        return new Response(JSON.stringify({ providerId: 'p' }), { status: 200 });
      });
      await runRegisterSamlProviderFromForm(handle, makeReq({ providerId: 'p', issuer: 'https://idp.acme.com/entity', domain: 'acme.com', entryPoint: 'https://idp.acme.com/sso', cert: 'c', ...extra }));
      return dispatched.samlConfig;
    };
    expect((await sentFor({ mapGroups: 'memberOf' })).mapping).toEqual({ extraFields: { groups: 'memberOf' } });
    expect('mapping' in (await sentFor({}))).toBe(false);
  });
});

describe('the groups-claim bridges: show it, set it, clear it, and answer nothing but the claim', () => {
  const CLIENT_SECRET = 'SECRET-VALUE-NEVER-ANSWERED';
  const CERT = 'CERT-BODY-NEVER-ANSWERED';
  const OIDC_STORED = {
    issuer: 'https://idp.acme.com',
    clientId: 'cid',
    clientSecret: CLIENT_SECRET,
    tokenEndpoint: 'https://idp.acme.com/token',
    mapping: { email: 'upn', name: 'display_name', image: 'picture', extraFields: { department: 'dept', groups: 'groups' } },
  };
  const SAML_STORED = {
    entryPoint: 'https://idp.acme.com/sso',
    cert: CERT,
    privateKey: CLIENT_SECRET,
    mapping: { email: 'mail', firstName: 'givenName' },
  };

  /** A stand-in for the stored row: reads hand back the blob as JSON text; update-provider writes the mapping into it. */
  const storeOf = (configs: Record<string, StoredSsoProviderConfigs>) => {
    const read = vi.fn(async (providerId: string) => configs[providerId] ?? null);
    const sent: any[] = [];
    const handle = vi.fn(async (req: Request) => {
      const body = await req.clone().json();
      sent.push({ url: req.url, body });
      const row = configs[body.providerId];
      const key = body.samlConfig ? 'samlConfig' : 'oidcConfig';
      const current = JSON.parse(String(row[key]));
      row[key] = JSON.stringify({ ...current, mapping: body[key].mapping });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    return { read, handle, sent };
  };
  const call = (path: string, body: Record<string, unknown>) =>
    new Request(`http://localhost:3000/api/v1/auth/admin/sso/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    });

  it('mappingWithGroupsClaim changes only the groups member and drops an emptied extraFields', () => {
    const before = { email: 'upn', extraFields: { department: 'dept' } };
    expect(mappingWithGroupsClaim(before, 'memberOf')).toEqual({ email: 'upn', extraFields: { department: 'dept', groups: 'memberOf' } });
    expect(before).toEqual({ email: 'upn', extraFields: { department: 'dept' } });
    expect(mappingWithGroupsClaim({ email: 'upn', extraFields: { groups: 'g' } }, '')).toEqual({ email: 'upn' });
    expect(mappingWithGroupsClaim(undefined, '')).toEqual({});
    expect(groupsClaimOfMapping({ extraFields: { groups: 'g' } })).toBe('g');
    expect(groupsClaimOfMapping({ extraFields: {} })).toBeNull();
  });

  it('show answers the claim of a provider the register door wrote, and null for one that maps none', async () => {
    const { read } = storeOf({
      okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null },
      plain: { oidcConfig: JSON.stringify({ clientId: 'cid', mapping: { email: 'email', name: 'name' } }), samlConfig: null },
      saml: { oidcConfig: null, samlConfig: JSON.stringify({ ...SAML_STORED, mapping: { extraFields: { groups: 'memberOf' } } }) },
    });
    expect((await runShowSsoGroupsClaim(call('get-groups-claim', { providerId: 'okta' }), read)).body).toEqual({ success: true, data: { providerId: 'okta', groupsClaim: 'groups' } });
    expect((await runShowSsoGroupsClaim(call('get-groups-claim', { providerId: 'plain' }), read)).body).toEqual({ success: true, data: { providerId: 'plain', groupsClaim: null } });
    expect((await runShowSsoGroupsClaim(call('get-groups-claim', { providerId: 'saml' }), read)).body).toEqual({ success: true, data: { providerId: 'saml', groupsClaim: 'memberOf' } });
  });

  it('set sends update-provider the stored mapping with only the groups member changed (OIDC and SAML)', async () => {
    const { read, handle, sent } = storeOf({
      okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null },
      saml: { oidcConfig: null, samlConfig: JSON.stringify(SAML_STORED) },
    });
    const oidc = await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId: 'okta', groupsClaim: ' memberOf ' }), read);
    expect(oidc.body).toEqual({ success: true, data: { providerId: 'okta', groupsClaim: 'memberOf' } });
    expect(sent[0].url).toBe('http://localhost:3000/api/v1/auth/sso/update-provider');
    expect(sent[0].body).toEqual({
      providerId: 'okta',
      oidcConfig: { mapping: { ...OIDC_STORED.mapping, extraFields: { department: 'dept', groups: 'memberOf' } } },
    });

    const saml = await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId: 'saml', groupsClaim: 'memberOf' }), read);
    expect(saml.body).toEqual({ success: true, data: { providerId: 'saml', groupsClaim: 'memberOf' } });
    expect(sent[1].body).toEqual({ providerId: 'saml', samlConfig: { mapping: { ...SAML_STORED.mapping, extraFields: { groups: 'memberOf' } } } });
  });

  it('a blank claim removes it and keeps every other member as stored', async () => {
    const { read, handle, sent } = storeOf({ okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null } });
    for (const groupsClaim of ['', '  ', undefined, null]) {
      const res = await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId: 'okta', ...(groupsClaim === undefined ? {} : { groupsClaim }) }), read);
      expect(res.body).toEqual({ success: true, data: { providerId: 'okta', groupsClaim: null } });
    }
    expect(sent.at(-1).body.oidcConfig.mapping).toEqual({ email: 'upn', name: 'display_name', image: 'picture', extraFields: { department: 'dept' } });
  });

  it('an unknown provider is 404 RESOURCE_NOT_FOUND and nothing is written; a non-text claim is 400', async () => {
    const { read, handle } = storeOf({ okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null } });
    const unknown = await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId: 'nobody', groupsClaim: 'g' }), read);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe('RESOURCE_NOT_FOUND');
    const shown = await runShowSsoGroupsClaim(call('get-groups-claim', { providerId: 'nobody' }), read);
    expect(shown.status).toBe(404);
    expect(shown.body.error?.code).toBe('RESOURCE_NOT_FOUND');
    const notText = await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId: 'okta', groupsClaim: ['g'] }), read);
    expect(notText.status).toBe(400);
    expect(notText.body.error?.code).toBe('INVALID_REQUEST');
    expect(handle).not.toHaveBeenCalled();
  });

  it('no answer carries another member of the stored configuration: not on show, not on set, not on a vendor refusal', async () => {
    const { read, handle } = storeOf({
      okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null },
      saml: { oidcConfig: null, samlConfig: JSON.stringify(SAML_STORED) },
    });
    const answers: unknown[] = [];
    for (const providerId of ['okta', 'saml']) {
      answers.push((await runShowSsoGroupsClaim(call('get-groups-claim', { providerId }), read)).body);
      answers.push((await runSetSsoGroupsClaim(handle, call('set-groups-claim', { providerId, groupsClaim: 'g' }), read)).body);
    }
    // A refusal whose own body describes the stored configuration.
    const refusing = vi.fn(async () => new Response(JSON.stringify({ message: `bad config: ${CLIENT_SECRET} ${CERT}`, code: 'BAD_REQUEST' }), { status: 400 }));
    const refused = await runSetSsoGroupsClaim(refusing, call('set-groups-claim', { providerId: 'okta', groupsClaim: 'g' }), read);
    expect(refused.status).toBe(400);
    expect(refused.body.error?.code).toBe('VALIDATION_ERROR');
    answers.push(refused.body);

    for (const answer of answers) {
      const text = JSON.stringify(answer);
      for (const leaked of [CLIENT_SECRET, CERT, 'cid', 'https://idp.acme.com', 'dept', 'upn']) expect(text).not.toContain(leaked);
      const data = (answer as { data?: Record<string, unknown> }).data;
      if (data) expect(Object.keys(data).sort()).toEqual(['groupsClaim', 'providerId']);
    }
  });
});

describe('[#32086] the attribute names on the SAML register form: mapping.email / firstName / lastName / name', () => {
  const sentFor = async (extra: Record<string, unknown>) => {
    let dispatched: any = null;
    const handle = vi.fn(async (req: Request) => {
      if (req.url.endsWith('/get-session')) return new Response('null', { status: 200 });
      dispatched = await req.clone().json();
      return new Response(JSON.stringify({ providerId: 'p' }), { status: 200 });
    });
    const res = await runRegisterSamlProviderFromForm(handle, makeReq({ providerId: 'p', issuer: 'https://idp.acme.com/entity', domain: 'acme.com', entryPoint: 'https://idp.acme.com/sso', cert: 'c', ...extra }));
    expect(res.status).toBe(200);
    return dispatched.samlConfig;
  };

  it('each named attribute is sent trimmed, beside the groups attribute', async () => {
    const sent = await sentFor({ mapEmail: ' mail ', mapFirstName: 'first', mapLastName: 'last', mapName: 'name', mapGroups: 'memberOf' });
    expect(sent.mapping).toEqual({ email: 'mail', firstName: 'first', lastName: 'last', name: 'name', extraFields: { groups: 'memberOf' } });
  });

  it('only the attributes named are sent; a blank one is left to the vendor default', async () => {
    expect((await sentFor({ mapName: 'name', mapEmail: '   ', mapFirstName: '' })).mapping).toEqual({ name: 'name' });
  });

  it('CONTROL: a form naming none of them still sends no mapping', async () => {
    expect('mapping' in (await sentFor({ mapEmail: '', mapFirstName: ' ', mapLastName: undefined, mapName: '' }))).toBe(false);
  });
});

describe('[#32086] the attribute-mapping bridges: show it, change some members, keep the rest, answer nothing else', () => {
  const CLIENT_SECRET = 'SECRET-VALUE-NEVER-ANSWERED';
  const CERT = 'CERT-BODY-NEVER-ANSWERED';
  const OIDC_STORED = {
    issuer: 'https://idp.acme.com',
    clientId: 'cid',
    clientSecret: CLIENT_SECRET,
    mapping: { id: 'sub', email: 'upn', name: 'display_name', image: 'picture', emailVerified: 'email_verified', extraFields: { groups: 'groups', department: 'dept' } },
  };
  const SAML_STORED = {
    entryPoint: 'https://idp.acme.com/sso',
    cert: CERT,
    privateKey: CLIENT_SECRET,
    mapping: { email: 'mail', firstName: 'givenName', emailVerified: 'verified', extraFields: { groups: 'memberOf' } },
  };

  const storeOf = (configs: Record<string, StoredSsoProviderConfigs>) => {
    const read = vi.fn(async (providerId: string) => configs[providerId] ?? null);
    const sent: any[] = [];
    const handle = vi.fn(async (req: Request) => {
      const body = await req.clone().json();
      sent.push({ url: req.url, body });
      const row = configs[body.providerId];
      const key = body.samlConfig ? 'samlConfig' : 'oidcConfig';
      row[key] = JSON.stringify({ ...JSON.parse(String(row[key])), mapping: body[key].mapping });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    return { read, handle, sent };
  };
  const stores = () =>
    storeOf({
      okta: { oidcConfig: JSON.stringify(OIDC_STORED), samlConfig: null },
      saml: { oidcConfig: null, samlConfig: JSON.stringify(SAML_STORED) },
      bare: { oidcConfig: null, samlConfig: JSON.stringify({ entryPoint: 'https://idp.acme.com/sso', cert: CERT }) },
    });
  const call = (path: string, body: Record<string, unknown>) =>
    new Request(`http://localhost:3000/api/v1/auth/admin/sso/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    });
  const show = (read: any, providerId: string) => runShowSsoAttributeMapping(call('get-attribute-mapping', { providerId }), read);
  const set = (handle: any, read: any, body: Record<string, unknown>) => runSetSsoAttributeMapping(handle, call('set-attribute-mapping', body), read);

  it('mappingWithAttributes changes only the members named: a value sets, a blank removes, the rest is kept', () => {
    const before = { email: 'mail', name: 'cn', extraFields: { groups: 'g' } };
    expect(mappingWithAttributes(before, { name: ' displayName ', firstName: 'given' })).toEqual({ email: 'mail', name: 'displayName', firstName: 'given', extraFields: { groups: 'g' } });
    expect(mappingWithAttributes(before, { email: '  ' })).toEqual({ name: 'cn', extraFields: { groups: 'g' } });
    expect(before).toEqual({ email: 'mail', name: 'cn', extraFields: { groups: 'g' } });
    expect(mappingWithAttributes(undefined, { email: '' })).toEqual({});
    expect(attributeMappingOf({ email: 'upn', firstName: 'f' }, 'oidc')).toEqual({ email: 'upn', firstName: null, lastName: null, name: null });
  });

  it('show answers each protocol\'s members, null where the default applies', async () => {
    const { read } = stores();
    expect((await show(read, 'okta')).body).toEqual({ success: true, data: { providerId: 'okta', protocol: 'oidc', email: 'upn', firstName: null, lastName: null, name: 'display_name' } });
    expect((await show(read, 'saml')).body).toEqual({ success: true, data: { providerId: 'saml', protocol: 'saml', email: 'mail', firstName: 'givenName', lastName: null, name: null } });
    expect((await show(read, 'bare')).body).toEqual({ success: true, data: { providerId: 'bare', protocol: 'saml', email: null, firstName: null, lastName: null, name: null } });
  });

  it('set sends update-provider the stored mapping with only the given members changed, and answers it read back', async () => {
    const { read, handle, sent } = stores();
    const saml = await set(handle, read, { providerId: 'saml', name: 'name', lastName: ' sn ' });
    expect(saml.status).toBe(200);
    expect(saml.body).toEqual({ success: true, data: { providerId: 'saml', protocol: 'saml', email: 'mail', firstName: 'givenName', lastName: 'sn', name: 'name' } });
    expect(sent[0].url).toBe('http://localhost:3000/api/v1/auth/sso/update-provider');
    expect(sent[0].body).toEqual({ providerId: 'saml', samlConfig: { mapping: { ...SAML_STORED.mapping, lastName: 'sn', name: 'name' } } });

    const oidc = await set(handle, read, { providerId: 'okta', email: 'email' });
    expect(oidc.body.data).toEqual({ providerId: 'okta', protocol: 'oidc', email: 'email', firstName: null, lastName: null, name: 'display_name' });
    expect(sent[1].body).toEqual({ providerId: 'okta', oidcConfig: { mapping: { ...OIDC_STORED.mapping, email: 'email' } } });
  });

  it('a blank member is removed, so the default applies again; an absent or null one is kept', async () => {
    const { read, handle, sent } = stores();
    const res = await set(handle, read, { providerId: 'saml', email: '  ', firstName: null });
    expect(res.body.data).toEqual({ providerId: 'saml', protocol: 'saml', email: null, firstName: 'givenName', lastName: null, name: null });
    expect(sent[0].body.samlConfig.mapping).toEqual({ firstName: 'givenName', emailVerified: 'verified', extraFields: { groups: 'memberOf' } });
  });

  it('a body naming no member is 400 INVALID_REQUEST and nothing is written', async () => {
    const { read, handle } = stores();
    for (const body of [{ providerId: 'saml' }, { providerId: 'saml', email: null, name: undefined }]) {
      const res = await set(handle, read, body);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_REQUEST');
      expect(res.body.error?.message).toContain('Nothing to change');
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('first or last name on an OIDC provider is 400 INVALID_REQUEST naming the one claim it reads, and nothing is written', async () => {
    const { read, handle } = stores();
    const res = await set(handle, read, { providerId: 'okta', name: 'name', firstName: 'given_name' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(res.body.error?.message).toContain('map "name", not firstName');
    expect(handle).not.toHaveBeenCalled();
  });

  it('an unknown provider is 404 RESOURCE_NOT_FOUND on both; a non-text member and a missing providerId are 400; nothing is written', async () => {
    const { read, handle } = stores();
    for (const res of [await show(read, 'nobody'), await set(handle, read, { providerId: 'nobody', name: 'n' })]) {
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('RESOURCE_NOT_FOUND');
    }
    for (const body of [{ providerId: 'saml', name: ['n'] }, { providerId: 'saml', email: 7 }, { name: 'n' }]) {
      const res = await set(handle, read, body);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_REQUEST');
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('no answer carries another member of the stored configuration: not on show, not on set, not on a vendor refusal', async () => {
    const { read, handle } = stores();
    const answers: unknown[] = [];
    for (const providerId of ['okta', 'saml']) {
      answers.push((await show(read, providerId)).body);
      answers.push((await set(handle, read, { providerId, name: 'n' })).body);
    }
    const refusing = vi.fn(async () => new Response(JSON.stringify({ message: `bad config: ${CLIENT_SECRET} ${CERT}` }), { status: 400 }));
    const refused = await set(refusing, read, { providerId: 'okta', name: 'n2' });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.code).toBe('VALIDATION_ERROR');
    answers.push(refused.body);

    for (const answer of answers) {
      const text = JSON.stringify(answer);
      for (const leaked of [CLIENT_SECRET, CERT, 'cid', 'https://idp.acme.com', 'dept', 'memberOf', 'picture', 'verified']) expect(text).not.toContain(leaked);
      const data = (answer as { data?: Record<string, unknown> }).data;
      if (data) expect(Object.keys(data).sort()).toEqual(['email', 'firstName', 'lastName', 'name', 'protocol', 'providerId']);
    }
  });
});
