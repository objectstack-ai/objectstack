// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A refused SAML sign-in lands on the error page, as a refused OIDC sign-in
 * does — see `sso-oidc-refusal-cause.ts` ("SAML: where a refusal lands") for
 * the rule this file pins.
 *
 * END of the chain: a real `AuthManager` with the real `sso()` plugin over the
 * in-memory engine, driven through its HTTP surface: `/sign-in/sso` → the IdP
 * → `POST /sso/saml2/sp/acs/:providerId`. The IdP is played by this file with
 * the same `samlify` the vendor verifies with: it reads the vendor's own SP
 * metadata and AuthnRequest, and answers a Response signed with a key and a
 * self-signed certificate generated here. Every refusal below is reached by
 * the vendor's real pipeline, not by a double.
 */

import { createPrivateKey, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  landSamlRefusal,
  readSamlAcsLanding,
  runSsoCallbackScope,
  ssoCallbackOf,
  ssoSamlAcsProviderId,
  type SamlLandingContext,
} from './sso-oidc-refusal-cause';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import 'better-auth/plugins/organization';
import '@better-auth/sso';

// The IdP side uses the `samlify` the installed `@better-auth/sso` resolves,
// so the Response is built by the same library version that parses it.
const vendorRequire = createRequire(createRequire(import.meta.url).resolve('@better-auth/sso'));
const samlify: any = vendorRequire('samlify');

const SECRET = 'test-secret-at-least-32-chars-long-saml-landing';
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const PROVIDER_ID = 'acme-entra';
const IDP_ENTITY = 'https://idp.acme.example/entity';
const IDP_SSO = 'https://idp.acme.example/sso';
const SP_ENTITY = `${AUTH}/sso/saml2/sp/metadata?providerId=${PROVIDER_ID}`;
const ACS = `${AUTH}/sso/saml2/sp/acs/${PROVIDER_ID}`;
const AFTER = `${BASE}/after-sign-in`;
const FAILED = `${BASE}/sign-in-failed`;
const CONSOLE_LOGIN = `${BASE}/_console/login`;
const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const KNOWN_EMAIL = 'mia.chen@acme.com';

/** Alters a signed Response after signing, so the vendor's signature check refuses it. */
const tamper = (samlResponse: string): string =>
  Buffer.from(Buffer.from(samlResponse, 'base64').toString('utf8').replace('someone@acme.com', 'other@acme.com')).toString('base64');

type Engine = ReturnType<typeof createMemoryEngine>;

// ── The IdP's signing key and certificate ───────────────────────────────────

/** DER, by hand: just enough of X.509 for a self-signed RSA certificate. */
function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len =
    n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));

function selfSignedCertificate(privateKey: KeyObject, publicKey: KeyObject): string {
  const sha256WithRsa = seq(der(0x06, Buffer.from('2a864886f70d01010b', 'hex')), Buffer.from([0x05, 0x00]));
  const name = seq(der(0x31, seq(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from('test-idp')))));
  const validity = seq(der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('491231235959Z')));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, Buffer.from([0x01, 0x23, 0x45])),
    sha256WithRsa,
    name,
    validity,
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sha256WithRsa, der(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
  new X509Certificate(cert); // refuses loudly if the encoding above is wrong
  return cert.toString('base64');
}

let idpKeyPem: string;
let idpCert: string;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  idpKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  idpCert = selfSignedCertificate(createPrivateKey(idpKeyPem), publicKey);
});

// ── The relying party ───────────────────────────────────────────────────────

interface Rp {
  manager: AuthManager;
  engine: Engine;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
}

interface RpOptions {
  /** Extra provider-row fields, written through the vendor's adapter (e.g. `allowJit`). */
  provider?: Record<string, unknown>;
  /** Extra `AuthManager` config (e.g. `audience`). */
  config?: Record<string, unknown>;
  /** Extra stored `samlConfig` members (e.g. `idpInitiatedCallbackUrl`, `mapping`, or a `cert` the IdP no longer signs with). */
  samlConfig?: Record<string, unknown>;
}

async function makeRp(opts: RpOptions = {}): Promise<Rp> {
  const engine = createMemoryEngine();
  const warn = vi.fn();
  const error = vi.fn();
  const info = vi.fn();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    trustedOrigins: [BASE],
    plugins: { sso: true },
    logger: { warn, error, info },
    ...opts.config,
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  // The provider, written through the vendor's own adapter in the shape the
  // Register SAML Provider bridge stores (`register-sso-provider.ts`).
  const auth: any = await manager.getAuthInstance();
  const ctx = await auth.$context;
  await ctx.adapter.create({
    model: 'ssoProvider',
    data: {
      providerId: PROVIDER_ID,
      issuer: IDP_ENTITY,
      domain: 'acme.com',
      samlConfig: JSON.stringify({
        issuer: IDP_ENTITY,
        entryPoint: IDP_SSO,
        cert: idpCert,
        callbackUrl: ACS,
        identifierFormat: EMAIL_FORMAT,
        idpMetadata: { entityID: IDP_ENTITY },
        spMetadata: { entityID: SP_ENTITY },
        ...opts.samlConfig,
      }),
      ...opts.provider,
    },
  });
  return { manager, engine, warn, error, info };
}

const cookiesOf = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean)
    .join('; ');

interface SignIn {
  callbackURL?: string;
  errorCallbackURL?: string;
}

/** Who answers as the IdP, when not the configured one: another entity id, another signing key, assertion attributes. */
interface IdpAs {
  entityID?: string;
  keyPem?: string;
  cert?: string;
  /** Assertion attributes by name; the Response then carries an AttributeStatement. */
  attributes?: Record<string, string>;
  /** The NameID, when it is not the email. */
  nameID?: string;
}

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** An AttributeStatement carrying each attribute as one string value. */
const attributeStatement = (attributes: Record<string, string>): string =>
  `<saml:AttributeStatement>${Object.entries(attributes)
    .map(([name, value]) => `<saml:Attribute Name="${xmlText(name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue xsi:type="xs:string">${xmlText(value)}</saml:AttributeValue></saml:Attribute>`)
    .join('')}</saml:AttributeStatement>`;

/** `/sign-in/sso` → the IdP → `POST` ACS; answers the ACS response. */
async function signInThroughIdp(
  rp: Rp,
  email: string,
  body: SignIn = { callbackURL: AFTER, errorCallbackURL: FAILED },
  shapeResponse: (samlResponse: string) => string = (r) => r,
  idpAs: IdpAs = {},
): Promise<Response> {
  const start = await rp.manager.handleRequest(
    new Request(`${AUTH}/sign-in/sso`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ providerId: PROVIDER_ID, ...body }),
    }),
  );
  const started: any = await start.clone().json().catch(() => null);
  expect(start.status, JSON.stringify(started)).toBe(200);
  const url = new URL(started.url);
  const relayState = url.searchParams.get('RelayState');
  const authnRequest = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
  const requestId = /\sID="([^"]+)"/.exec(authnRequest)?.[1];
  expect(relayState && requestId, `no RelayState / AuthnRequest ID in ${started.url}`).toBeTruthy();

  const spMetadata = await (await rp.manager.handleRequest(
    new Request(`${AUTH}/sso/saml2/sp/metadata?providerId=${PROVIDER_ID}`),
  )).text();
  const sp = samlify.ServiceProvider({ metadata: spMetadata });
  const entityID = idpAs.entityID ?? IDP_ENTITY;
  const idp = samlify.IdentityProvider({
    entityID,
    privateKey: idpAs.keyPem ?? idpKeyPem,
    signingCert: idpAs.cert ?? idpCert,
    nameIDFormat: [EMAIL_FORMAT],
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: IDP_SSO }],
  });
  // With attributes or another NameID, the Response is rendered from the
  // default template with every tag filled here, as samlify fills it itself.
  const custom =
    idpAs.attributes || idpAs.nameID
      ? (template: string) => {
          const now = new Date();
          const later = new Date(now.getTime() + 5 * 60_000).toISOString();
          const id = `_${crypto.randomUUID()}`;
          const filled = samlify.SamlLib.replaceTagsByValue(template, {
            ID: id,
            AssertionID: `_${crypto.randomUUID()}`,
            Destination: ACS,
            Audience: SP_ENTITY,
            SubjectRecipient: ACS,
            Issuer: entityID,
            IssueInstant: now.toISOString(),
            StatusCode: 'urn:oasis:names:tc:SAML:2.0:status:Success',
            ConditionsNotBefore: now.toISOString(),
            ConditionsNotOnOrAfter: later,
            SubjectConfirmationDataNotOnOrAfter: later,
            NameIDFormat: EMAIL_FORMAT,
            NameID: idpAs.nameID ?? email,
            InResponseTo: requestId,
            AuthnStatement: '',
          });
          return { id, context: filled.replace('{AttributeStatement}', idpAs.attributes ? attributeStatement(idpAs.attributes) : '') };
        }
      : undefined;
  const { context } = await idp.createLoginResponse(sp, { extract: { request: { id: requestId } } }, 'post', { email }, custom);

  return rp.manager.handleRequest(
    new Request(ACS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(start) },
      body: new URLSearchParams({ SAMLResponse: shapeResponse(context), RelayState: relayState! }).toString(),
    }),
  );
}

function landing(res: Response): { base: string; error: string | null } {
  const url = new URL(res.headers.get('location') ?? '', BASE);
  return { base: `${url.origin}${url.pathname}`, error: url.searchParams.get('error') };
}

// ── END of the chain ────────────────────────────────────────────────────────

describe('a refused SAML sign-in lands on the error page, as OIDC does', () => {
  let rp: Rp;
  beforeEach(async () => {
    rp = await makeRp();
  });

  it('CONTROL: a valid assertion for a new account signs in and lands on callbackURL', async () => {
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.status, res.headers.get('location') ?? '').toBe(302);
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });

  // The takeover case: the IdP asserts the email of a local account this
  // provider is not linked to. better-auth refuses the implicit link
  // (`handleOAuthUserInfo` answers `account not linked`), and the vendor used
  // to redirect that refusal to the SUCCESS callbackURL.
  const takeover = async () => {
    await rp.engine.insert('sys_user', { id: 'usr_known', email: KNOWN_EMAIL, name: 'Mia Chen', email_verified: true });
  };

  it('takeover: lands on errorCallbackURL with error=account_not_linked, and signs nobody in', async () => {
    await takeover();
    const res = await signInThroughIdp(rp, KNOWN_EMAIL);
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'account_not_linked' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
  });

  it('takeover with no errorCallbackURL: lands on the platform error page, as every other SAML refusal and OIDC do', async () => {
    await takeover();
    const res = await signInThroughIdp(rp, KNOWN_EMAIL, { callbackURL: AFTER });
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });

    // The vendor's own refusal of a tampered assertion, same sign-in shape:
    // the same page.
    const tampered = await signInThroughIdp(rp, 'someone@acme.com', { callbackURL: AFTER }, tamper);
    expect(landing(tampered)).toEqual({ base: CONSOLE_LOGIN, error: 'saml_error' });
  });

  it('takeover with a relative errorCallbackURL: lands on that path, kept relative', async () => {
    await takeover();
    const res = await signInThroughIdp(rp, KNOWN_EMAIL, { callbackURL: AFTER, errorCallbackURL: '/oops?from=sso' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/oops?from=sso&error=account_not_linked');
  });

  it('a response over maxResponseSize, refused before the relay state is read: lands on errorCallbackURL', async () => {
    const res = await signInThroughIdp(rp, 'someone@acme.com', undefined, (r) => r + 'A'.repeat(300_000));
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'saml_error' });
    expect(new URL(res.headers.get('location')!).searchParams.get('error_description')).toMatch(/maximum allowed size/);
  });

  it('a refusal the vendor already lands on errorCallbackURL is answered as the vendor wrote it', async () => {
    const res = await signInThroughIdp(rp, 'someone@acme.com', undefined, tamper);
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'saml_error' });
  });
});

// ── The landing, read off its own inputs ────────────────────────────────────

describe('which requests the SAML landing wraps', () => {
  it('the per-provider ACS path, POST only', () => {
    expect(ssoSamlAcsProviderId('/sso/saml2/sp/acs/acme-entra')).toBe('acme-entra');
    expect(ssoSamlAcsProviderId('/sso/saml2/sp/acs/a%20b')).toBe('a b');
    expect(ssoSamlAcsProviderId('/sso/saml2/sp/acs/')).toBeUndefined();
    expect(ssoSamlAcsProviderId('/sso/saml2/sp/acs/a/b')).toBeUndefined();
    expect(ssoSamlAcsProviderId('/sso/callback/acme')).toBeUndefined();
    const post = new Request(ACS, { method: 'POST', body: '' });
    expect(ssoCallbackOf('/sso/saml2/sp/acs/acme-entra', post)).toEqual({ protocol: 'saml', providerId: 'acme-entra', request: post });
    expect(ssoCallbackOf('/sso/saml2/sp/acs/acme-entra', new Request(ACS))).toBeUndefined();
    expect(ssoCallbackOf('/sso/callback/acme-okta', new Request(ACS))).toEqual({ protocol: 'oidc', providerId: 'acme-okta' });
  });
});

describe('reading the landing from the relay state', () => {
  const stateRow = (state: Record<string, unknown>) => ({ value: JSON.stringify(state) });
  const context = (row: { value: string } | null, trusted: string[] = []): SamlLandingContext & { reads: string[] } => {
    const reads: string[] = [];
    return {
      reads,
      baseURL: AUTH,
      options: { onAPIError: { errorURL: `${BASE}/_console/login` } },
      isTrustedOrigin: (url) => trusted.some((origin) => url.startsWith(origin)),
      internalAdapter: {
        findVerificationValue: async (identifier) => {
          reads.push(identifier);
          return row;
        },
      },
    };
  };
  const acsPost = (body: string, type = 'application/x-www-form-urlencoded') =>
    new Request(ACS, { method: 'POST', headers: { 'content-type': type }, body });

  it('reads the row the vendor wrote at sign-in, from a form or a JSON body', async () => {
    const ctx = context(stateRow({ callbackURL: AFTER, errorURL: FAILED }));
    expect(await readSamlAcsLanding(ctx, PROVIDER_ID, acsPost('SAMLResponse=x&RelayState=rs-1'))).toEqual({ success: AFTER, error: FAILED });
    expect(await readSamlAcsLanding(ctx, PROVIDER_ID, acsPost(JSON.stringify({ SAMLResponse: 'x', RelayState: 'rs-2' }), 'application/json'))).toEqual({ success: AFTER, error: FAILED });
    expect(ctx.reads).toEqual(['auth-state:rs-1', 'auth-state:rs-2']);
  });

  it('with no errorURL in the state, the platform error page', async () => {
    const ctx = context(stateRow({ callbackURL: AFTER }));
    expect(await readSamlAcsLanding(ctx, PROVIDER_ID, acsPost('RelayState=rs'))).toEqual({ success: AFTER, error: CONSOLE_LOGIN });
  });

  it('with no relay state, no row, or no readable row (IdP-initiated): the platform error page, for the bare fallback', async () => {
    const idpInitiatedLanding = { fallback: BASE, error: CONSOLE_LOGIN };
    expect(await readSamlAcsLanding(context(stateRow({ callbackURL: AFTER })), PROVIDER_ID, acsPost('SAMLResponse=x'))).toEqual(idpInitiatedLanding);
    expect(await readSamlAcsLanding(context(null), PROVIDER_ID, acsPost('RelayState=rs'))).toEqual(idpInitiatedLanding);
    expect(await readSamlAcsLanding(context({ value: '{not json' }), PROVIDER_ID, acsPost('RelayState=rs'))).toEqual(idpInitiatedLanding);
    expect(await readSamlAcsLanding(context(stateRow({ errorURL: FAILED })), PROVIDER_ID, acsPost('RelayState=rs'))).toEqual(idpInitiatedLanding);
  });

  it('with no relay-state row and no platform error page configured, the vendor default; an unsafe one, no landing', async () => {
    const bare = { ...context(null), options: {} };
    expect(await readSamlAcsLanding(bare, PROVIDER_ID, acsPost('SAMLResponse=x'))).toEqual({ fallback: BASE, error: `${AUTH}/error` });
    const elsewhere = { ...context(null), options: { onAPIError: { errorURL: 'https://elsewhere.example/login' } } };
    expect(await readSamlAcsLanding(elsewhere, PROVIDER_ID, acsPost('SAMLResponse=x'))).toBeUndefined();
  });

  it('applies the vendor redirect safety rule to the error URL', async () => {
    const land = (errorURL: string, trusted: string[] = []) =>
      readSamlAcsLanding(context(stateRow({ callbackURL: AFTER, errorURL }), trusted), PROVIDER_ID, acsPost('RelayState=rs'));
    expect(await land('https://elsewhere.example/fail')).toBeUndefined();
    expect(await land('https://partner.example/fail', ['https://partner.example'])).toEqual({ success: AFTER, error: 'https://partner.example/fail' });
    expect(await land('//elsewhere.example/fail')).toBeUndefined();
    expect(await land('/\\elsewhere.example')).toBeUndefined();
    expect(await land(ACS)).toBeUndefined();
    expect(await land('/fail')).toEqual({ success: AFTER, error: '/fail' });
  });
});

describe('putting an ACS answer on its landing', () => {
  const landingOf = { success: AFTER, error: FAILED };
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location, 'set-cookie': 'a=1' } });

  it('re-bases a refusal on the success URL, keeping error and error_description and every header', () => {
    const res = landSamlRefusal(redirect(`${AFTER}?error=account_not_linked`), landingOf);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${FAILED}?error=account_not_linked`);
    expect(res.headers.get('set-cookie')).toBe('a=1');
    const described = landSamlRefusal(redirect(`${BASE}/?error=saml_error&error_description=too+big`), landingOf);
    expect(described.headers.get('location')).toBe(`${FAILED}?error=saml_error&error_description=too+big`);
  });

  it('leaves a success alone, even one whose own URL carries error=', () => {
    const own = { success: `${AFTER}?error=keep`, error: FAILED };
    const res = redirect(`${AFTER}?error=keep`);
    expect(landSamlRefusal(res, own)).toBe(res);
    const plain = redirect(AFTER);
    expect(landSamlRefusal(plain, landingOf)).toBe(plain);
  });

  it('leaves a refusal already on the error URL byte-identical, and a non-redirect alone', () => {
    const landed = redirect(`${FAILED}?error=saml_error&error_description=Invalid+SAML+response`);
    expect(landSamlRefusal(landed, landingOf)).toBe(landed);
    const json = new Response('{}', { status: 404 });
    expect(landSamlRefusal(json, landingOf)).toBe(json);
  });

  it('IdP-initiated: a refusal on the bare app-origin fallback is re-based onto the platform error page, every header kept', () => {
    const idp = { fallback: BASE, error: CONSOLE_LOGIN };
    const res = landSamlRefusal(redirect(`${BASE}/?error=unsolicited_response&error_description=IdP-initiated+SSO+not+allowed`), idp);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${CONSOLE_LOGIN}?error=unsolicited_response&error_description=IdP-initiated+SSO+not+allowed`);
    expect(res.headers.get('set-cookie')).toBe('a=1');
    expect(landSamlRefusal(redirect('/?error=account_not_linked'), idp).headers.get('location')).toBe(`${CONSOLE_LOGIN}?error=account_not_linked`);
  });

  it('IdP-initiated: a success on the fallback, and anything not on the bare fallback, are left alone', () => {
    const idp = { fallback: BASE, error: CONSOLE_LOGIN };
    for (const location of [
      BASE, // the vendor's success on its fallback
      `${BASE}/`,
      `${BASE}/sso-landing?error=unsolicited_response`, // a configured IdP-initiated callback
      `${BASE}/?tenant=acme&error=unsolicited_response`, // the root, with a query of its own
      `${BASE}/?error=unsolicited_response#top`,
      `https://elsewhere.example/?error=unsolicited_response`,
      `//elsewhere.example/?error=unsolicited_response`,
    ]) {
      const res = redirect(location);
      expect(landSamlRefusal(res, idp), location).toBe(res);
    }
  });

  it('with no landing read, the vendor answer stands', async () => {
    const vendor = redirect(`${AFTER}?error=account_not_linked`);
    const saml = { protocol: 'saml' as const, providerId: PROVIDER_ID, request: new Request(ACS, { method: 'POST' }) };
    expect(await runSsoCallbackScope(saml, undefined, async () => undefined, async () => vendor)).toBe(vendor);
    expect(await runSsoCallbackScope(saml, undefined, async () => { throw new Error('store down'); }, async () => vendor)).toBe(vendor);
    const landed = await runSsoCallbackScope(saml, undefined, async () => landingOf, async () => vendor);
    expect(landed.headers.get('location')).toBe(`${FAILED}?error=account_not_linked`);
  });
});

// ── Per-provider sign-in options (`sso-sign-in-options.ts`) ─────────────────

/** A human who is not the newcomer, so no case below rides the zero-user bootstrap carve-out. */
const seedAdmin = async (rp: Rp) => {
  await rp.engine.insert('sys_user', { id: 'usr_admin', email: 'admin@acme.com', name: 'Admin', email_verified: true });
};

/** An IdP-initiated Response: the IdP posts an assertion no AuthnRequest asked for (no InResponseTo, no RelayState). */
async function idpInitiated(
  rp: Rp,
  email: string,
  shapeResponse: (samlResponse: string) => string = (r) => r,
): Promise<Response> {
  const spMetadata = await (await rp.manager.handleRequest(
    new Request(`${AUTH}/sso/saml2/sp/metadata?providerId=${PROVIDER_ID}`),
  )).text();
  const sp = samlify.ServiceProvider({ metadata: spMetadata });
  const idp = samlify.IdentityProvider({
    entityID: IDP_ENTITY,
    privateKey: idpKeyPem,
    signingCert: idpCert,
    nameIDFormat: [EMAIL_FORMAT],
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: IDP_SSO }],
  });
  const { context } = await idp.createLoginResponse(sp, {}, 'post', { email });
  expect(Buffer.from(context, 'base64').toString('utf8')).not.toMatch(/InResponseTo="[^"]+"/);
  return rp.manager.handleRequest(
    new Request(ACS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SAMLResponse: shapeResponse(context) }).toString(),
    }),
  );
}

describe('SAML IdP-initiated sign-in is a per-provider toggle, off by default', () => {
  it('off (the default): an unsolicited Response is refused 302 error=unsolicited_response on the platform error page, and signs nobody in', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'unsolicited_response' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(rp.engine.tables.get('sys_user')?.map((u: any) => u.email)).toEqual(['admin@acme.com']);
  });

  it('on: the same Response signs the person in', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true, allowJit: true } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(res.status, res.headers.get('location') ?? '').toBe(302);
    expect(landing(res).error).toBeNull();
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  });

  it("another provider's toggle does not open this one", async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const auth: any = await rp.manager.getAuthInstance();
    const ctx = await auth.$context;
    await ctx.adapter.create({
      model: 'ssoProvider',
      data: { providerId: 'other-idp', issuer: 'https://other.example/entity', domain: 'other.example', allowIdpInitiated: true },
    });
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'unsolicited_response' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
  });

  it('CONTROL: an SP-initiated sign-in is answered as before with the toggle off', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });
});

describe('a refused IdP-initiated SAML sign-in lands on the platform error page, as one with no errorCallbackURL does', () => {
  // With no relay state the vendor lands every IdP-initiated answer on its
  // fallback, the bare app origin, whose console redirect drops the query.

  it('on, but the person may not be provisioned: error=SELF_REGISTRATION_CLOSED on the platform error page, no user created', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'SELF_REGISTRATION_CLOSED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(rp.engine.tables.get('sys_user')?.map((u: any) => u.email)).toEqual(['admin@acme.com']);
  });

  it('on, and the email belongs to an account this provider is not linked to: error=account_not_linked on the platform error page', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true, allowJit: true } });
    await rp.engine.insert('sys_user', { id: 'usr_known', email: KNOWN_EMAIL, name: 'Mia Chen', email_verified: true });
    const res = await idpInitiated(rp, KNOWN_EMAIL);
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
  });

  it("a Response the vendor's signature check refuses: error=saml_error on the platform error page", async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true, allowJit: true } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'someone@acme.com', tamper);
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'saml_error' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
  });

  it('CONTROL: an allowed IdP-initiated sign-in still lands on the app origin, signed in', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true, allowJit: true } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(BASE);
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  });

  it("CONTROL: a provider's own IdP-initiated callback keeps its refusals, as the operator configured", async () => {
    const rp = await makeRp({ provider: { allowJit: true }, samlConfig: { idpInitiatedCallbackUrl: `${BASE}/sso-landing` } });
    await seedAdmin(rp);
    const res = await idpInitiated(rp, 'new.person@acme.com');
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: `${BASE}/sso-landing`, error: 'unsolicited_response' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
  });
});

describe('invite_only refuses an unknown SAML user unless the provider allows JIT', () => {
  it('invite_only (the default) + no account + no invitation: refused 302 error=SELF_REGISTRATION_CLOSED on the error URL, no user created', async () => {
    const rp = await makeRp();
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'SELF_REGISTRATION_CLOSED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(rp.engine.tables.get('sys_user')?.map((u: any) => u.email)).toEqual(['admin@acme.com']);
  });

  it('the provider allows JIT: the same person is provisioned and signed in', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });

  it('CONTROL: an invited person is provisioned with JIT off', async () => {
    const rp = await makeRp();
    await seedAdmin(rp);
    await inviteForAudienceGate(rp.engine, 'new.person@acme.com');
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });

  it('CONTROL: posture open provisions with JIT off, as before', async () => {
    const rp = await makeRp({ config: { audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } } });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });
});

// ── Why a SAML sign-in was refused (`sso-saml-refusal-cause.ts`, #32086) ────

describe('[#32086] a refused SAML response names its cause on error_description, keeping error=saml_error', () => {
  /** The IdP after a certificate rotation: a new key and certificate the provider does not know yet. */
  let rotated: { keyPem: string; cert: string };
  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    rotated = { keyPem, cert: selfSignedCertificate(createPrivateKey(keyPem), publicKey) };
  });

  const refusal = (res: Response) => {
    const url = new URL(res.headers.get('location') ?? '', BASE);
    return {
      base: `${url.origin}${url.pathname}`,
      params: [...url.searchParams.keys()].sort(),
      error: url.searchParams.get('error'),
      description: url.searchParams.get('error_description'),
    };
  };
  const causeLines = (rp: Rp) => rp.warn.mock.calls.filter(([text]) => String(text).startsWith('[auth] SSO sign-in refused'));
  const unsigned = (r: string) =>
    Buffer.from(Buffer.from(r, 'base64').toString('utf8').replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/g, '')).toString('base64');
  const failedStatus = (r: string) =>
    Buffer.from(Buffer.from(r, 'base64').toString('utf8').replace('urn:oasis:names:tc:SAML:2.0:status:Success', 'urn:oasis:names:tc:SAML:2.0:status:Responder')).toString('base64');

  it.each([
    ['the IdP signs with a rotated certificate the provider does not know', 'saml_signing_certificate_mismatch', (rp: Rp) => signInThroughIdp(rp, 'someone@acme.com', undefined, undefined, rotated)],
    ['the IdP answers a failure status (Entra: user not assigned)', 'saml_idp_status_not_success', (rp: Rp) => signInThroughIdp(rp, 'someone@acme.com', undefined, failedStatus)],
    ['the response carries no signature', 'saml_response_unsigned', (rp: Rp) => signInThroughIdp(rp, 'someone@acme.com', undefined, unsigned)],
    ['a known certificate signs for another IdP entity id', 'saml_issuer_mismatch', (rp: Rp) => signInThroughIdp(rp, 'someone@acme.com', undefined, undefined, { entityID: 'https://other-idp.example/entity' })],
  ])('%s: 302 to the error page, error=saml_error, error_description=%s, one warn line, nobody signed in', async (_case, cause, signIn) => {
    const rp = await makeRp();
    const res = await signIn(rp);
    expect(res.status).toBe(302);
    expect(refusal(res)).toEqual({ base: FAILED, params: ['error', 'error_description'], error: 'saml_error', description: cause });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(causeLines(rp)).toEqual([[expect.stringContaining(`(${cause})`), { providerId: PROVIDER_ID, protocol: 'saml', cause }]]);
  });

  it('CONTROL: a broken signature under the known certificate and issuer stays the unclassified "Invalid SAML response", with no cause line', async () => {
    const rp = await makeRp();
    const res = await signInThroughIdp(rp, 'someone@acme.com', undefined, tamper);
    expect(refusal(res)).toEqual({ base: FAILED, params: ['error', 'error_description'], error: 'saml_error', description: 'Invalid SAML response' });
    expect(causeLines(rp)).toEqual([]);
  });

  it('CONTROL: a valid response still signs in, with no cause line', async () => {
    const rp = await makeRp();
    const res = await signInThroughIdp(rp, 'new.person@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
    expect(causeLines(rp)).toEqual([]);
  });

  it('a configured certificate stored as PEM, with armour and line breaks, is the same certificate', async () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${idpCert.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    const rp = await makeRp({ samlConfig: { cert: pem } });
    expect((await signInThroughIdp(rp, 'new.person@acme.com')).headers.get('location')).toBe(AFTER);
    const res = await signInThroughIdp(rp, 'someone@acme.com', undefined, undefined, rotated);
    expect(refusal(res).description).toBe('saml_signing_certificate_mismatch');
  });

  it('with the rotated certificate added to the provider (a list), the same sign-in succeeds', async () => {
    const rp = await makeRp({ provider: { allowJit: true }, samlConfig: { cert: [idpCert, rotated.cert] } });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, 'new.person@acme.com', undefined, undefined, rotated);
    expect(res.headers.get('location')).toBe(AFTER);
  });

  it('neither the redirect nor the cause line carries the subject or a certificate', async () => {
    const rp = await makeRp();
    const res = await signInThroughIdp(rp, 'someone@acme.com', undefined, undefined, rotated);
    const said = `${res.headers.get('location')} ${JSON.stringify(causeLines(rp))}`;
    for (const leaked of ['someone@acme.com', rotated.cert.slice(0, 40), idpCert.slice(0, 40)]) expect(said).not.toContain(leaked);
  });
});

// ── Who a SAML sign-in resolves to: the provider's attribute mapping (#32086) ─

describe('[#32086] the attribute mapping decides the email and name a SAML sign-in resolves to', () => {
  const ENTRA = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
  const userNamed = (rp: Rp, email: string) => rp.engine.tables.get('sys_user')?.find((u: any) => u.email === email);
  const signedIn = async (rp: Rp, email: string, idpAs: IdpAs) => {
    const res = await signInThroughIdp(rp, email, undefined, undefined, idpAs);
    expect(res.headers.get('location'), res.headers.get('location') ?? '').toBe(AFTER);
  };

  it('Okta sends the full name as "name": unmapped, the user is named after the NameID; mapped, after the attribute', async () => {
    const unmapped = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(unmapped);
    await signedIn(unmapped, 'mia.chen@acme.com', { attributes: { name: 'Mia Chen' } });
    expect(userNamed(unmapped, 'mia.chen@acme.com')?.name).toBe('mia.chen@acme.com');

    const mapped = await makeRp({ provider: { allowJit: true }, samlConfig: { mapping: { name: 'name' } } });
    await seedAdmin(mapped);
    await signedIn(mapped, 'mia.chen@acme.com', { attributes: { name: 'Mia Chen' } });
    expect(userNamed(mapped, 'mia.chen@acme.com')?.name).toBe('Mia Chen');
  });

  it('Entra ID sends claim URIs: mapped, the email comes from the emailaddress claim (not an opaque NameID) and the name from givenname + surname', async () => {
    const rp = await makeRp({
      provider: { allowJit: true },
      samlConfig: { mapping: { email: `${ENTRA}/emailaddress`, firstName: `${ENTRA}/givenname`, lastName: `${ENTRA}/surname` } },
    });
    await seedAdmin(rp);
    await signedIn(rp, 'ignored@acme.com', {
      nameID: 'a1b2c3-opaque-object-id',
      attributes: { [`${ENTRA}/emailaddress`]: 'Mia.Chen@acme.com', [`${ENTRA}/givenname`]: 'Mia', [`${ENTRA}/surname`]: 'Chen' },
    });
    expect(userNamed(rp, 'mia.chen@acme.com')?.name).toBe('Mia Chen');
    expect(rp.engine.tables.get('sys_user')?.map((u: any) => u.email).sort()).toEqual(['admin@acme.com', 'mia.chen@acme.com']);
  });
});
