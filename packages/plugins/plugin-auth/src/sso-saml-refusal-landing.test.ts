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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
// The egress guard the SSO discovery reaches is loaded at module top, never inside a clocked case.
import '@objectstack/core/egress';

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
  /** The provider signed in through, when not {@link PROVIDER_ID} (one {@link addSamlProvider} stored). */
  providerId?: string;
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
  /** The NameID format, when it is not the email format (an IdP-initiated Entra ID response sends `persistent`). */
  nameIDFormat?: string;
}

const PERSISTENT_FORMAT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** An AttributeStatement carrying each attribute as one string value. */
const attributeStatement = (attributes: Record<string, string>): string =>
  `<saml:AttributeStatement>${Object.entries(attributes)
    .map(([name, value]) => `<saml:Attribute Name="${xmlText(name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue xsi:type="xs:string">${xmlText(value)}</saml:AttributeValue></saml:Attribute>`)
    .join('')}</saml:AttributeStatement>`;

/**
 * With attributes, another NameID or another NameID format, the Response is
 * rendered from samlify's default template with every tag filled here, as
 * samlify fills it itself; `undefined` (samlify's own rendering) otherwise. No
 * `requestId` renders an IdP-initiated Response (no `InResponseTo`).
 */
function customResponse(entityID: string, email: string, idpAs: IdpAs, requestId?: string) {
  if (!idpAs.attributes && !idpAs.nameID && !idpAs.nameIDFormat) return undefined;
  return (template: string) => {
    const now = new Date();
    const later = new Date(now.getTime() + 5 * 60_000).toISOString();
    const id = `_${crypto.randomUUID()}`;
    const filled = samlify.SamlLib.replaceTagsByValue(requestId ? template : template.replace(/ InResponseTo="\{InResponseTo\}"/g, ''), {
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
      NameIDFormat: idpAs.nameIDFormat ?? EMAIL_FORMAT,
      NameID: idpAs.nameID ?? email,
      InResponseTo: requestId ?? '',
      AuthnStatement: '',
    });
    return { id, context: filled.replace('{AttributeStatement}', idpAs.attributes ? attributeStatement(idpAs.attributes) : '') };
  };
}

/** `/sign-in/sso` → the IdP → `POST` ACS; answers the ACS response. */
async function signInThroughIdp(
  rp: Rp,
  email: string,
  body: SignIn = { callbackURL: AFTER, errorCallbackURL: FAILED },
  shapeResponse: (samlResponse: string) => string = (r) => r,
  idpAs: IdpAs = {},
): Promise<Response> {
  const providerId = body.providerId ?? PROVIDER_ID;
  const start = await rp.manager.handleRequest(
    new Request(`${AUTH}/sign-in/sso`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ ...body, providerId }),
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
    new Request(`${AUTH}/sso/saml2/sp/metadata?providerId=${providerId}`),
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
  const custom = customResponse(entityID, email, idpAs, requestId);
  const { context } = await idp.createLoginResponse(sp, { extract: { request: { id: requestId } } }, 'post', { email }, custom);

  return rp.manager.handleRequest(
    new Request(providerId === PROVIDER_ID ? ACS : `${AUTH}/sso/saml2/sp/acs/${providerId}`, {
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
    const get = new Request(ACS);
    expect(ssoCallbackOf('/sso/callback/acme-okta', get)).toEqual({ protocol: 'oidc', providerId: 'acme-okta', request: get });
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
  idpAs: IdpAs = {},
): Promise<Response> {
  const spMetadata = await (await rp.manager.handleRequest(
    new Request(`${AUTH}/sso/saml2/sp/metadata?providerId=${PROVIDER_ID}`),
  )).text();
  const sp = samlify.ServiceProvider({ metadata: spMetadata });
  const entityID = idpAs.entityID ?? IDP_ENTITY;
  const idp = samlify.IdentityProvider({
    entityID,
    privateKey: idpKeyPem,
    signingCert: idpCert,
    nameIDFormat: [EMAIL_FORMAT],
    singleSignOnService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: IDP_SSO }],
  });
  const { context } = await idp.createLoginResponse(sp, {}, 'post', { email }, customResponse(entityID, email, idpAs));
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

// ── An unmapped SAML sign-in reads the standard claims before the NameID ──
//
// `sso-saml-standard-claims.ts` states the rule. Microsoft Entra ID's default
// claims, an SP-initiated entry (email-format NameID: the user principal name)
// and an IdP-initiated one (Entra's default persistent NameID: an opaque id),
// through the real vendor pipeline. Every provider here leaves the mapping
// unset unless the case says otherwise.

describe('an unmapped SAML sign-in reads the standard claims before the NameID', () => {
  const C = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
  const UPN = 'mia.chen@acme.com';
  const OPAQUE = 'pov4hy2mt2xk9-opaque-pairwise-id';
  const ENTRA_CLAIMS = {
    [`${C}/emailaddress`]: 'Mia.Chen@acme.com',
    [`${C}/givenname`]: 'Mia',
    [`${C}/surname`]: 'Chen',
    [`${C}/name`]: UPN,
  };
  const spInitiated: IdpAs = { nameID: UPN, attributes: ENTRA_CLAIMS };
  const idpInitiatedPersistent: IdpAs = { nameID: OPAQUE, nameIDFormat: PERSISTENT_FORMAT, attributes: ENTRA_CLAIMS };

  /** Every user besides the seeded admin, as `email (name)`. */
  const people = (rp: Rp) =>
    (rp.engine.tables.get('sys_user') ?? []).filter((u: any) => u.email !== 'admin@acme.com').map((u: any) => `${u.email} (${u.name})`);
  const entraRp = async (provider: Record<string, unknown> = {}, rest: RpOptions = {}) => {
    const rp = await makeRp({ ...rest, provider: { allowJit: true, allowIdpInitiated: true, ...provider } });
    await seedAdmin(rp);
    return rp;
  };
  const admitted = (res: Response) => {
    expect(res.status).toBe(302);
    expect(landing(res).error, res.headers.get('location') ?? '').toBeNull();
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  };

  it('SP-initiated then IdP-initiated with a persistent NameID: one account, keyed on the emailaddress claim; the second entry makes no other', async () => {
    const rp = await entraRp();
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);

    const second = await idpInitiated(rp, UPN, undefined, idpInitiatedPersistent);
    // The second entry resolves to the same address, so it reaches the account
    // the first one made, and the platform's linking rules judge it there: an
    // unverified provider's assertion does not link itself to an existing
    // account (`implicit-account-linking.ts`).
    expect(landing(second)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });
    expect(cookiesOf(second)).not.toMatch(/session_token=[^;]/);
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
  });

  it('with domain verification on: the same two entries still end on one account', async () => {
    const rp = await entraRp({ domainVerified: true }, { config: { plugins: { sso: true, ssoDomainVerification: true } } });
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    const second = await idpInitiated(rp, UPN, undefined, idpInitiatedPersistent);
    // The provider is trusted here, and the account it made is not
    // email-verified, so the local-verification rule refuses the link.
    expect(landing(second)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
  });

  it('IdP-initiated first, with a persistent NameID: the account is made for the address, never for the opaque id', async () => {
    const rp = await entraRp();
    admitted(await idpInitiated(rp, UPN, undefined, idpInitiatedPersistent));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    // ...and the same person entering SP-initiated next makes no second account.
    await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated);
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
  });

  it('portal first: an IdP-initiated sign-in with no account yet lands on the app origin signed in, the account keyed on the opaque NameID at the claim address; the sign-in page entry after it is refused', async () => {
    const rp = await entraRp();
    const first = await idpInitiated(rp, UPN, undefined, idpInitiatedPersistent);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(BASE);
    expect(cookiesOf(first)).toMatch(/session_token=[^;]/);
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    const keys = () => (rp.engine.tables.get('sys_account') ?? []).filter((a: any) => a.provider_id === PROVIDER_ID).map((a: any) => a.account_id);
    expect(keys()).toEqual([OPAQUE]);

    const second = await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated);
    expect(landing(second)).toEqual({ base: FAILED, error: 'account_not_linked' });
    expect(cookiesOf(second)).not.toMatch(/session_token=[^;]/);
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(keys()).toEqual([OPAQUE]);
  });

  it('the claim is read before an "email" attribute the same assertion carries', async () => {
    const rp = await entraRp();
    admitted(await idpInitiated(rp, UPN, undefined, { ...idpInitiatedPersistent, attributes: { ...ENTRA_CLAIMS, email: 'other@acme.com' } }));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
  });

  it("the name claim names the user when the assertion carries no given name or surname", async () => {
    const rp = await entraRp();
    admitted(await idpInitiated(rp, UPN, undefined, {
      nameID: OPAQUE,
      nameIDFormat: PERSISTENT_FORMAT,
      attributes: { [`${C}/emailaddress`]: 'mia.chen@acme.com', [`${C}/name`]: 'Mia Chen (Sales)' },
    }));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen (Sales))']);
  });

  it('a member the administrator named is read as named, whatever claims the assertion carries', async () => {
    const rp = await entraRp({}, { samlConfig: { mapping: { email: 'mail', firstName: 'first' } } });
    admitted(await idpInitiated(rp, UPN, undefined, {
      ...idpInitiatedPersistent,
      attributes: { ...ENTRA_CLAIMS, mail: 'mia@acme.com', first: 'M.' },
    }));
    // email and first name as named; the unset last name reads its claim.
    expect(people(rp)).toEqual(['mia@acme.com (M. Chen)']);
  });

  it('a stored mapping that names only the groups attribute: the claims are read, and an SP-initiated sign-in still completes', async () => {
    // The vendor fingerprints the provider configuration at the sign-in's
    // start and again at the ACS; a mapping member it could see would differ
    // between the two and refuse this sign-in.
    const rp = await entraRp({}, { samlConfig: { mapping: { extraFields: { groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups' } } } });
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, { nameID: UPN, attributes: { ...ENTRA_CLAIMS, [`${C}/emailaddress`]: 'mia@acme.com' } }));
    expect(people(rp)).toEqual(['mia@acme.com (Mia Chen)']);
  });

  it('CONTROL: an IdP that sends "email" and none of the claims signs in exactly as before', async () => {
    const rp = await entraRp();
    admitted(await idpInitiated(rp, 'bob@acme.com', undefined, { nameID: OPAQUE, nameIDFormat: PERSISTENT_FORMAT, attributes: { email: 'bob@acme.com' } }));
    expect(people(rp)).toEqual(['bob@acme.com (pov4hy2mt2xk9-opaque-pairwise-id)']);
  });

  it('CONTROL: the stored mapping is unchanged by a sign-in that read the claims', async () => {
    const rp = await entraRp();
    admitted(await idpInitiated(rp, UPN, undefined, idpInitiatedPersistent));
    const row = (rp.engine.tables.get('sys_sso_provider') ?? []).find((p: any) => p.provider_id === PROVIDER_ID);
    expect(JSON.parse(row.saml_config).mapping).toBeUndefined();
  });
});

// ── A SAML provider keyed on a stable attribute: both entries reach one account ──
//
// `sso-saml-account-key.ts` states the rule. Microsoft Entra ID's default
// claims plus its object id, an SP-initiated entry (email-format NameID: the
// user principal name) and an IdP-initiated one (Entra's default persistent
// NameID: an opaque id), through the real vendor pipeline. The CONTROL for a
// provider that is not Entra and names no attribute is the describe above,
// whose portal-first case still keys its account on the NameID.

describe('a SAML provider keyed on a stable attribute: the app and the IdP portal reach one account', () => {
  const C = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';
  const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
  const ENTRA = 'https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/';
  const UPN = 'mia.chen@acme.com';
  const OPAQUE = 'pov4hy2mt2xk9-opaque-pairwise-id';
  const OID = '8b6e3c1a-5f2d-4e7b-9a10-3c4d5e6f7a8b';
  const CLAIMS = {
    [`${C}/emailaddress`]: 'Mia.Chen@acme.com',
    [`${C}/givenname`]: 'Mia',
    [`${C}/surname`]: 'Chen',
    [`${C}/name`]: UPN,
    [OID_CLAIM]: OID,
  };
  const spInitiated: IdpAs = { entityID: ENTRA, nameID: UPN, attributes: CLAIMS };
  const portal: IdpAs = { entityID: ENTRA, nameID: OPAQUE, nameIDFormat: PERSISTENT_FORMAT, attributes: CLAIMS };

  const people = (rp: Rp) =>
    (rp.engine.tables.get('sys_user') ?? []).filter((u: any) => u.email !== 'admin@acme.com').map((u: any) => `${u.email} (${u.name})`);
  /** The account keys this provider's accounts carry, and whose they are. */
  const accounts = (rp: Rp) =>
    (rp.engine.tables.get('sys_account') ?? [])
      .filter((a: any) => a.provider_id === PROVIDER_ID)
      .map((a: any) => `${a.account_id} -> ${(rp.engine.tables.get('sys_user') ?? []).find((u: any) => u.id === a.user_id)?.email}`);
  /** The users the live sessions belong to. */
  const sessionUsers = (rp: Rp) => [...new Set((rp.engine.tables.get('sys_session') ?? []).map((s: any) => s.user_id))];
  const keyedRp = async (opts: { issuer?: string; mapping?: Record<string, unknown>; allowJit?: boolean } = {}) => {
    const issuer = opts.issuer ?? ENTRA;
    const rp = await makeRp({
      provider: { allowJit: opts.allowJit ?? true, allowIdpInitiated: true, issuer },
      samlConfig: { issuer, idpMetadata: { entityID: issuer }, ...(opts.mapping ? { mapping: opts.mapping } : {}) },
    });
    await seedAdmin(rp);
    return rp;
  };
  const admitted = (res: Response) => {
    expect(res.status).toBe(302);
    expect(landing(res).error, res.headers.get('location') ?? '').toBeNull();
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  };

  it('Entra: SP-initiated, then IdP-initiated with a persistent NameID: one account keyed on the object id, and both sign in', async () => {
    const rp = await keyedRp();
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    admitted(await idpInitiated(rp, UPN, undefined, portal));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(rp)).toEqual([`${OID} -> mia.chen@acme.com`]);
    expect(sessionUsers(rp)).toHaveLength(1);
  });

  it('Entra, portal first: IdP-initiated, then SP-initiated: one account keyed on the object id, and both sign in', async () => {
    const rp = await keyedRp();
    admitted(await idpInitiated(rp, UPN, undefined, portal));
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(rp)).toEqual([`${OID} -> mia.chen@acme.com`]);
    expect(sessionUsers(rp)).toHaveLength(1);
  });

  it('Entra: an email change at the IdP keeps the account', async () => {
    const rp = await keyedRp();
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    const renamed = { ...CLAIMS, [`${C}/emailaddress`]: 'mia.wong@acme.com' };
    admitted(await idpInitiated(rp, 'mia.wong@acme.com', undefined, { ...portal, attributes: renamed }));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(rp)).toEqual([`${OID} -> mia.chen@acme.com`]);
  });

  it('a named attribute keys a provider that is not Entra: both entries reach one account', async () => {
    const rp = await keyedRp({ issuer: IDP_ENTITY, mapping: { extraFields: { accountKey: 'employeeNumber' } } });
    const attributes = { email: UPN, employeeNumber: 'E-004711' };
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, { nameID: UPN, attributes }));
    admitted(await idpInitiated(rp, UPN, undefined, { nameID: OPAQUE, nameIDFormat: PERSISTENT_FORMAT, attributes }));
    expect(accounts(rp)).toEqual(['E-004711 -> mia.chen@acme.com']);
  });

  it('a named attribute is read before the Entra default', async () => {
    const rp = await keyedRp({ mapping: { extraFields: { accountKey: 'employeeNumber' } } });
    admitted(await idpInitiated(rp, UPN, undefined, { ...portal, attributes: { ...CLAIMS, employeeNumber: 'E-004711' } }));
    expect(accounts(rp)).toEqual(['E-004711 -> mia.chen@acme.com']);
  });

  it('the same provider only: an account another provider made under the same key is never reached by it', async () => {
    const rp = await keyedRp();
    await rp.engine.insert('sys_user', { id: 'usr_other', email: 'someone.else@acme.com', name: 'Someone Else', email_verified: true });
    await rp.engine.insert('sys_account', { id: 'acc_other', user_id: 'usr_other', provider_id: 'other-entra', account_id: OID });
    admitted(await idpInitiated(rp, UPN, undefined, portal));
    expect(accounts(rp)).toEqual([`${OID} -> mia.chen@acme.com`]);
    expect(sessionUsers(rp)).not.toContain('usr_other');
  });

  it('an existing password account at the same address keeps the linking rule: refused account_not_linked, nothing written', async () => {
    const rp = await keyedRp();
    await rp.engine.insert('sys_user', { id: 'usr_known', email: UPN, name: 'Mia Chen', email_verified: true });
    await rp.engine.insert('sys_account', { id: 'acc_known', user_id: 'usr_known', provider_id: 'credential', account_id: 'usr_known' });
    const res = await idpInitiated(rp, UPN, undefined, portal);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(accounts(rp)).toEqual([]);
  });

  it('Entra, an assertion without the object id: the NameID keys that sign-in, as before', async () => {
    const rp = await keyedRp();
    const { [OID_CLAIM]: _oid, ...withoutOid } = CLAIMS;
    admitted(await idpInitiated(rp, UPN, undefined, { ...portal, attributes: withoutOid }));
    expect(accounts(rp)).toEqual([`${OPAQUE} -> mia.chen@acme.com`]);
  });

  it('a key value written with a comment is not read: the NameID keys that sign-in (the comment keeps the signature valid)', async () => {
    const rp = await keyedRp();
    const split = (posted: string) =>
      Buffer.from(Buffer.from(posted, 'base64').toString('utf8').replace(OID, `${OID.slice(0, 8)}<!---->${OID.slice(8)}`)).toString('base64');
    admitted(await idpInitiated(rp, UPN, split, portal));
    expect(accounts(rp)).toEqual([`${OPAQUE} -> mia.chen@acme.com`]);
  });

  // An account made before the key applied: the row a SP-initiated Entra
  // sign-in wrote under the old rule, keyed on its NameID (the UPN), for a
  // user JIT made unverified. It is not rewritten; these three pins measure
  // what reaches it now.
  const seedLegacy = async (rp: Rp) => {
    await rp.engine.insert('sys_user', { id: 'usr_legacy', email: UPN, name: 'Mia Chen', email_verified: false });
    await rp.engine.insert('sys_account', { id: 'acc_legacy', user_id: 'usr_legacy', provider_id: PROVIDER_ID, account_id: UPN });
  };

  it('a legacy NameID-keyed account, same NameID and same email: signs in to it (found by email, then by its NameID), nothing new written', async () => {
    const rp = await keyedRp();
    await seedLegacy(rp);
    admitted(await signInThroughIdp(rp, UPN, undefined, undefined, spInitiated));
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(rp)).toEqual([`${UPN} -> mia.chen@acme.com`]);
    expect(sessionUsers(rp)).toEqual(['usr_legacy']);
  });

  it('a legacy NameID-keyed account, from the other entry (another NameID): the linking rule refuses it account_not_linked, as before; nothing written', async () => {
    const rp = await keyedRp();
    await seedLegacy(rp);
    const res = await idpInitiated(rp, UPN, undefined, portal);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'account_not_linked' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(people(rp)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(rp)).toEqual([`${UPN} -> mia.chen@acme.com`]);
  });

  it('a legacy NameID-keyed account, after an email change at the IdP (same NameID): not reached; with JIT a new user is made, without JIT the sign-in is refused', async () => {
    const renamed: IdpAs = { ...spInitiated, attributes: { ...CLAIMS, [`${C}/emailaddress`]: 'mia.wong@acme.com' } };

    const jit = await keyedRp();
    await seedLegacy(jit);
    admitted(await signInThroughIdp(jit, 'mia.wong@acme.com', undefined, undefined, renamed));
    expect(people(jit).sort()).toEqual(['mia.chen@acme.com (Mia Chen)', 'mia.wong@acme.com (Mia Chen)']);
    expect(accounts(jit).sort()).toEqual([`${OID} -> mia.wong@acme.com`, `${UPN} -> mia.chen@acme.com`]);
    expect(sessionUsers(jit)).not.toContain('usr_legacy');

    const noJit = await keyedRp({ allowJit: false });
    await seedLegacy(noJit);
    const res = await signInThroughIdp(noJit, 'mia.wong@acme.com', undefined, undefined, renamed);
    expect(landing(res)).toEqual({ base: FAILED, error: 'SELF_REGISTRATION_CLOSED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(people(noJit)).toEqual(['mia.chen@acme.com (Mia Chen)']);
    expect(accounts(noJit)).toEqual([`${UPN} -> mia.chen@acme.com`]);
  });

  it('CONTROL: an IdP that is not Entra and names no attribute keys on the NameID, whatever the assertion carries', async () => {
    const rp = await keyedRp({ issuer: IDP_ENTITY });
    admitted(await idpInitiated(rp, UPN, undefined, { ...portal, entityID: IDP_ENTITY }));
    expect(accounts(rp)).toEqual([`${OPAQUE} -> mia.chen@acme.com`]);
  });
});

// ── Verification on or off, an SSO provider creates an account only for an email address ──
//
// `sso-account-at-proven-domain.ts` (`refuseSsoAccountWithoutAddress`) states the rule.

describe('verification on or off, a SAML provider creates an account only for an email address', () => {
  const OPAQUE = 'pov4hy2mt2xk9-opaque-pairwise-id';
  const entraRp = async () => {
    const rp = await makeRp({ provider: { allowJit: true, allowIdpInitiated: true } });
    await seedAdmin(rp);
    return rp;
  };
  const nothingWritten = (rp: Rp) => {
    expect((rp.engine.tables.get('sys_user') ?? []).map((u: any) => u.email)).toEqual(['admin@acme.com']);
    expect(rp.engine.tables.get('sys_account') ?? []).toEqual([]);
    expect(rp.engine.tables.get('sys_session') ?? []).toEqual([]);
  };

  it('an IdP-initiated persistent NameID and no email attribute or claim: refused error=INVALID_EMAIL, nothing written', async () => {
    const rp = await entraRp();
    const res = await idpInitiated(rp, 'ignored@acme.com', undefined, { nameID: OPAQUE, nameIDFormat: PERSISTENT_FORMAT, attributes: { other: 'x' } });
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: CONSOLE_LOGIN, error: 'INVALID_EMAIL' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    nothingWritten(rp);
  });

  it('an SP-initiated sign-in whose NameID is not an address: refused on the error URL, nothing written', async () => {
    const rp = await entraRp();
    const res = await signInThroughIdp(rp, 'ignored@acme.com', undefined, undefined, { nameID: 'mia.chen', attributes: { other: 'x' } });
    expect(landing(res)).toEqual({ base: FAILED, error: 'INVALID_EMAIL' });
    nothingWritten(rp);
  });

  it('CONTROL: the same sign-in carrying an address is admitted', async () => {
    const rp = await entraRp();
    const res = await signInThroughIdp(rp, 'mia.chen@acme.com');
    expect(res.headers.get('location')).toBe(AFTER);
  });
});

// ── With SSO domain verification on, a provider creates an account only at a domain it has proven ──
//
// `sso-account-at-proven-domain.ts` states the rule. Every case runs with
// verification on, the provider's `domain_verified` on and its JIT toggle on,
// and one human already present, so the audience gate would admit each
// newcomer: the rule alone decides.

describe('with SSO domain verification on, a SAML provider creates an account only at a domain it has proven', () => {
  const VERIFICATION_ON = { plugins: { sso: true, ssoDomainVerification: true } };
  const verifiedRp = async (domain = 'acme.com', provider: Record<string, unknown> = {}) => {
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domain, domainVerified: true, allowJit: true, ...provider } });
    await seedAdmin(rp);
    return rp;
  };
  /** What a sign-in left behind besides the seeded admin. */
  const written = (rp: Rp) => ({
    users: (rp.engine.tables.get('sys_user') ?? []).map((u: any) => u.email).filter((e: string) => e !== 'admin@acme.com'),
    accounts: (rp.engine.tables.get('sys_account') ?? []).length,
    members: (rp.engine.tables.get('sys_member') ?? []).length,
    sessions: (rp.engine.tables.get('sys_session') ?? []).length,
  });
  const NOTHING = { users: [], accounts: 0, members: 0, sessions: 0 };

  const expectAdmitted = (res: Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.get('location'), res.headers.get('location') ?? '').toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  };
  const expectRefused = (rp: Rp, res: Response) => {
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'EMAIL_DOMAIN_NOT_ALLOWED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(written(rp)).toEqual(NOTHING);
  };

  it('admits an address exactly at the single listed domain', async () => {
    const rp = await verifiedRp();
    expectAdmitted(await signInThroughIdp(rp, 'bob@acme.com'));
    expect(written(rp).users).toEqual(['bob@acme.com']);
  });

  it('admits an address exactly at the second entry of a multi-entry list', async () => {
    const rp = await verifiedRp('acme.com, acme.co.uk');
    expectAdmitted(await signInThroughIdp(rp, 'bob@acme.co.uk'));
  });

  const refused: Array<[string, string, string?]> = [
    ['another domain', 'bob@other.example'],
    ['a subdomain of a listed domain', 'bob@eng.acme.com'],
    ['a parent of a listed domain', 'bob@acme.com', 'eng.acme.com'],
    ['a look-alike of a listed domain', 'bob@acme.com.other.example'],
    ['an asserted email that is not an address', 'bob.acme.com'],
    ['a domain part with a port', 'bob@acme.com:443'],
    ['a domain part with a path', 'bob@acme.com/x'],
    ['a domain part with a trailing dot', 'bob@acme.com.'],
    ['a full-width spelling of a listed domain', 'bob@\uFF41\uFF43\uFF4D\uFF45.com'],
    ['an address at a listed entry that is not written as a bare host', 'ceo@victim.example', 'victim.example\\@evil.example'],
  ];
  for (const [what, email, domain] of refused) {
    it(`refuses ${what}, and writes no user, account, membership or session`, async () => {
      const rp = await verifiedRp(domain);
      expectRefused(rp, await signInThroughIdp(rp, email));
    });
  }

  it('case, and punycode against Unicode for an internationalised name, are one domain', async () => {
    for (const [domain, email] of [
      ['acme.com', 'Bob@ACME.com'],
      ['bücher.de', 'bob@xn--bcher-kva.de'],
      ['xn--bcher-kva.de', 'bob@bücher.de'],
    ]) {
      const rp = await verifiedRp(domain);
      expectAdmitted(await signInThroughIdp(rp, email));
    }
  });

  it('no carve-out: the first human of a deployment, at an outside domain, is refused', async () => {
    // JIT off: without the rule, the first-human carve-out alone would admit.
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domainVerified: true, allowJit: false } });
    const email = 'bob@other.example';
    expectRefused(rp, await signInThroughIdp(rp, email));
    expect(rp.engine.tables.get('sys_user') ?? []).toEqual([]);
  });

  it('no carve-out: an outside-domain address holding a pending invitation is refused', async () => {
    // JIT off: without the rule, the invitation alone would admit.
    const rp = await verifiedRp('acme.com', { allowJit: false });
    const email = 'bob@other.example';
    await inviteForAudienceGate(rp.engine, email);
    expectRefused(rp, await signInThroughIdp(rp, email));
  });

  it('CONTROL (stays green under ablation): a provider whose domain is not verified signs nobody in', async () => {
    // The vendor refuses this before any account is judged, so it does not
    // pin the rule above.
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domainVerified: false, allowJit: true } });
    await seedAdmin(rp);
    const start = await rp.manager.handleRequest(
      new Request(`${AUTH}/sign-in/sso`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: AFTER, errorCallbackURL: FAILED }),
      }),
    );
    expect(start.status).toBe(401);
    expect(written(rp)).toEqual(NOTHING);
  });

  it('CONTROL: with verification off, the outside-domain account is created as today', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    expectAdmitted(await signInThroughIdp(rp, 'bob@other.example'));
    expect(written(rp).users).toEqual(['bob@other.example']);
  });

  it('CONTROL: an existing linked account at an outside domain still signs in', async () => {
    const rp = await verifiedRp();
    // The account is made while the environment reports verification off (as
    // it was before it was turned on); the vendor's own provider gate stays on.
    const off = vi.spyOn(rp.manager, 'isSsoDomainVerificationEnabled').mockReturnValue(false);
    expectAdmitted(await signInThroughIdp(rp, 'bob@other.example'));
    off.mockRestore();
    expect(rp.manager.isSsoDomainVerificationEnabled()).toBe(true);
    expectAdmitted(await signInThroughIdp(rp, 'bob@other.example'));
    expect(written(rp).users).toEqual(['bob@other.example']);
  });

  it('CONTROL: invite_only without allowJit still answers SELF_REGISTRATION_CLOSED for an on-domain stranger', async () => {
    const rp = await verifiedRp('acme.com', { allowJit: false });
    const res = await signInThroughIdp(rp, 'bob@acme.com');
    expect(landing(res)).toEqual({ base: FAILED, error: 'SELF_REGISTRATION_CLOSED' });
    expect(written(rp)).toEqual(NOTHING);
  });
});

// ── With SSO domain verification on, an implicit link reaches an existing account only at a proven domain ──
//
// The rule above, for an SSO sign-in that links to an account that already
// exists (`implicit-account-linking.ts`, reusing
// `sso-account-at-proven-domain.ts`). Verification on, the provider's
// `domain_verified` on for `acme.com`, and one human already present.

describe('with SSO domain verification on, a SAML implicit link reaches an existing account only with an address at a domain the provider has proven', () => {
  afterEach(() => vi.restoreAllMocks());
  const VERIFICATION_ON = { plugins: { sso: true, ssoDomainVerification: true } };
  const verifiedRp = async () => {
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domain: 'acme.com', domainVerified: true, allowJit: true } });
    await seedAdmin(rp);
    return rp;
  };
  const seedLocal = (rp: Rp, email: string) =>
    rp.engine.insert('sys_user', { id: 'usr_local', email, name: 'Erin', email_verified: true });
  const accounts = (rp: Rp) => (rp.engine.tables.get('sys_account') ?? []).filter((a: any) => a.provider_id === PROVIDER_ID);
  const sessions = (rp: Rp) => (rp.engine.tables.get('sys_session') ?? []).length;

  it('to an existing account at a subdomain the provider has not listed is refused: no account row, no session', async () => {
    const rp = await verifiedRp();
    await seedLocal(rp, 'erin@eng.acme.com');
    const res = await signInThroughIdp(rp, 'erin@eng.acme.com');
    expect(res.status).toBe(302);
    expect(landing(res)).toEqual({ base: FAILED, error: 'EMAIL_DOMAIN_NOT_ALLOWED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(accounts(rp)).toEqual([]);
    expect(sessions(rp)).toBe(0);
  });

  it('to an existing account at a proven domain still links and signs in', async () => {
    const rp = await verifiedRp();
    await seedLocal(rp, 'erin@acme.com');
    const res = await signInThroughIdp(rp, 'erin@acme.com');
    expect(res.headers.get('location'), res.headers.get('location') ?? '').toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
    expect(accounts(rp).map((a: any) => a.user_id)).toEqual(['usr_local']);
  });

  it('CONTROL: with verification off, the same link is made as today', async () => {
    const rp = await verifiedRp();
    await seedLocal(rp, 'erin@eng.acme.com');
    // The vendor's own provider gate stays on; only the environment's verification switch reads off.
    vi.spyOn(rp.manager, 'isSsoDomainVerificationEnabled').mockReturnValue(false);
    const res = await signInThroughIdp(rp, 'erin@eng.acme.com');
    expect(res.headers.get('location'), res.headers.get('location') ?? '').toBe(AFTER);
    expect(accounts(rp).map((a: any) => a.user_id)).toEqual(['usr_local']);
  });
});

describe('with SSO domain verification on, a later SAML sign-in changes a linked account\'s address only at a domain the provider has proven', () => {
  const VERIFICATION_ON = { plugins: { sso: true, ssoDomainVerification: true } };
  // The email comes from an attribute and the NameID is stable, so a later
  // sign-in reaches the same linked account with another address.
  const NAME_ID = 'saml-subject-7f3a';
  const as = (email: string) => ({ nameID: NAME_ID, attributes: { email } });

  it('a SAML provider does not update the account: an outside address asserted later signs in and the stored address is unchanged', async () => {
    const rp = await makeRp({
      config: VERIFICATION_ON,
      provider: { domain: 'acme.com', domainVerified: true, allowJit: true },
      samlConfig: { mapping: { email: 'email' } },
    });
    await seedAdmin(rp);
    const first = await signInThroughIdp(rp, 'bob@acme.com', undefined, undefined, as('bob@acme.com'));
    expect(first.headers.get('location'), first.headers.get('location') ?? '').toBe(AFTER);
    const bob = (rp.engine.tables.get('sys_user') ?? []).find((u: any) => u.email === 'bob@acme.com');
    expect(bob, 'the on-domain account').toBeTruthy();
    const later = await signInThroughIdp(rp, 'bob@other.example', undefined, undefined, as('bob@other.example'));
    expect(later.headers.get('location'), later.headers.get('location') ?? '').toBe(AFTER);
    expect(cookiesOf(later)).toMatch(/session_token=[^;]/);
    expect((rp.engine.tables.get('sys_user') ?? []).find((u: any) => u.id === bob.id)?.email).toBe('bob@acme.com');
    expect((rp.engine.tables.get('sys_account') ?? []).filter((a: any) => a.provider_id === PROVIDER_ID)).toHaveLength(1);
  });
});

// ── Sign out of the company sign-in too: SAML single logout ─────────────────
//
// Ruling record 6866334319 (`sso-sign-out-of-idp.ts`). The IdP side of single
// logout is played with the same `samlify`: a LogoutRequest the IdP sends when
// the person signs out there, and the LogoutResponse it answers the platform's
// own LogoutRequest with, each signed with the IdP key above or unsigned.

describe('sign out of the company sign-in too: SAML single logout', () => {
  const REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
  const IDP_SLO = 'https://idp.acme.example/slo';
  const POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
  const SP_SLO = `${AUTH}/sso/saml2/sp/slo/${PROVIDER_ID}`;
  // As the IdP Logout URL field stores it (`samlLogoutServiceOf`): one address, both bindings.
  const withLogoutAddress = {
    idpMetadata: {
      entityID: IDP_ENTITY,
      singleLogoutService: [
        { Binding: REDIRECT, Location: IDP_SLO },
        { Binding: POST, Location: IDP_SLO },
      ],
    },
  };

  const sessionOf = async (rp: Rp, cookie: string): Promise<{ user?: { email?: string } } | null> => {
    const res = await rp.manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
    const body = (await res.json().catch(() => null)) as { user?: { email?: string } } | null;
    return body?.user ? body : null;
  };

  const signOut = (rp: Rp, cookie: string, body: Record<string, unknown> = {}): Promise<Response> =>
    rp.manager.handleRequest(
      new Request(`${AUTH}/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  /** The IdP's view of this SP, built from configuration (not the SP metadata, which advertises single logout only while it is on). */
  const spAsIdpSees = (signed: boolean) =>
    samlify.ServiceProvider({
      entityID: SP_ENTITY,
      assertionConsumerService: [{ Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST', Location: ACS }],
      singleLogoutService: [{ Binding: POST, Location: SP_SLO }, { Binding: REDIRECT, Location: SP_SLO }],
      wantLogoutRequestSigned: signed,
      wantLogoutResponseSigned: signed,
    });
  const idpWithLogout = () =>
    samlify.IdentityProvider({
      entityID: IDP_ENTITY,
      privateKey: idpKeyPem,
      signingCert: idpCert,
      nameIDFormat: [EMAIL_FORMAT],
      singleSignOnService: [{ Binding: REDIRECT, Location: IDP_SSO }],
      singleLogoutService: [{ Binding: REDIRECT, Location: IDP_SLO }, { Binding: POST, Location: IDP_SLO }],
    });

  /** A logout message the IdP's page posts to the SP's logout endpoint (HTTP-POST binding, no cookie). */
  const postToSpSlo = (rp: Rp, type: string, context: string): Promise<Response> =>
    rp.manager.handleRequest(
      new Request(SP_SLO, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ [type]: context }).toString(),
      }),
    );

  /** The IdP's LogoutRequest for `email` (the person signed out at the IdP). */
  const idpLogoutRequest = (rp: Rp, email: string, signed: boolean): Promise<Response> => {
    const { context, type } = idpWithLogout().createLogoutRequest(spAsIdpSees(signed), 'post', { logoutNameID: email });
    return postToSpSlo(rp, type, context);
  };

  /** The IdP's LogoutResponse to a LogoutRequest of the SP. */
  const idpLogoutResponse = (rp: Rp, signed: boolean): Promise<Response> => {
    const { context, type } = idpWithLogout().createLogoutResponse(
      spAsIdpSees(signed),
      { extract: { request: { id: `_${crypto.randomUUID()}` } } },
      'post',
    );
    return postToSpSlo(rp, type, context);
  };

  it('CONTROL, switch off: sign-out ends the platform session only, and the IdP logout endpoint stays closed', async () => {
    const rp = await makeRp({ samlConfig: withLogoutAddress });
    const signedIn = cookiesOf(await signInThroughIdp(rp, 'ann@acme.com'));
    expect((await sessionOf(rp, signedIn))?.user?.email).toBe('ann@acme.com');

    // The IdP's signed LogoutRequest is refused, and the session stands.
    const refused = await idpLogoutRequest(rp, 'ann@acme.com', true);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code?: string }).code).toBe('SINGLE_LOGOUT_NOT_ENABLED');
    expect((await sessionOf(rp, signedIn))?.user?.email).toBe('ann@acme.com');

    const out = await signOut(rp, signedIn);
    expect(out.status).toBe(200);
    const body = (await out.json()) as { success?: boolean; url?: string };
    expect(body.success).toBe(true);
    expect(body.url).toBeUndefined();
    expect(out.headers.get('location')).toBeNull();
    expect(await sessionOf(rp, signedIn)).toBeNull();
  });

  it('on: sign-out also signs out at the IdP through its single logout, and the session ends', async () => {
    const rp = await makeRp({ provider: { signOutOfIdp: true }, samlConfig: withLogoutAddress });
    const signedIn = cookiesOf(await signInThroughIdp(rp, 'ann@acme.com'));

    const out = await signOut(rp, signedIn, { callbackURL: AFTER });
    expect(out.status).toBe(200);
    const body = (await out.json()) as { success?: boolean; url?: string; redirect?: boolean };
    expect(body).toMatchObject({ success: true, redirect: true });
    const url = new URL(body.url!);
    expect(`${url.origin}${url.pathname}`).toBe(IDP_SLO);
    expect(out.headers.get('location')).toBe(body.url);
    const logoutRequest = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
    expect(logoutRequest).toContain('LogoutRequest');
    expect(logoutRequest).toContain('ann@acme.com');
    expect(await sessionOf(rp, signedIn)).toBeNull();
  });

  it('on: an unsigned LogoutRequest and an unsigned LogoutResponse from the IdP are each refused', async () => {
    const rp = await makeRp({ provider: { signOutOfIdp: true }, samlConfig: withLogoutAddress });
    const signedIn = cookiesOf(await signInThroughIdp(rp, 'ann@acme.com'));

    const request = await idpLogoutRequest(rp, 'ann@acme.com', false);
    expect(request.status).toBe(400);
    expect(((await request.json()) as { code?: string }).code).toBe('INVALID_LOGOUT_REQUEST');
    expect((await sessionOf(rp, signedIn))?.user?.email).toBe('ann@acme.com');

    const response = await idpLogoutResponse(rp, false);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe('INVALID_LOGOUT_RESPONSE');

    // CONTROL: the same LogoutResponse, signed, is accepted (and lands on the app's root).
    const signed = await idpLogoutResponse(rp, true);
    expect(signed.status).toBe(302);
    expect(signed.headers.get('location')).toBe(BASE);
  });

  it('on: a signed message in the HTTP-Redirect binding is refused too (the vendor verifies no redirect signature): fail closed', async () => {
    const rp = await makeRp({ provider: { signOutOfIdp: true }, samlConfig: withLogoutAddress });
    const signedIn = cookiesOf(await signInThroughIdp(rp, 'ann@acme.com'));
    const { context } = idpWithLogout().createLogoutRequest(spAsIdpSees(true), 'redirect', { logoutNameID: 'ann@acme.com' });
    expect(new URL(context).searchParams.get('Signature')).toBeTruthy();
    const res = await rp.manager.handleRequest(new Request(context));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_LOGOUT_REQUEST');
    expect((await sessionOf(rp, signedIn))?.user?.email).toBe('ann@acme.com');
  });

  it('on: a signed LogoutRequest ends only the session it names', async () => {
    // `allowJit`: under the default invite-only posture only the first person is admitted without it.
    const rp = await makeRp({ provider: { signOutOfIdp: true, allowJit: true }, samlConfig: withLogoutAddress });
    const ann = cookiesOf(await signInThroughIdp(rp, 'ann@acme.com'));
    const bob = cookiesOf(await signInThroughIdp(rp, 'bob@acme.com'));
    expect((await sessionOf(rp, ann))?.user?.email).toBe('ann@acme.com');
    expect((await sessionOf(rp, bob))?.user?.email).toBe('bob@acme.com');

    const res = await idpLogoutRequest(rp, 'ann@acme.com', true);
    // The vendor answers the IdP in the binding the request came in: a POST form carrying its LogoutResponse.
    expect(res.status, await res.clone().text()).toBe(200);
    const form = await res.text();
    expect(form).toContain(IDP_SLO);
    expect(form).toContain('SAMLResponse');

    expect(await sessionOf(rp, ann)).toBeNull();
    expect((await sessionOf(rp, bob))?.user?.email).toBe('bob@acme.com');
  });

  it('the SP metadata advertises the logout service only while the switch is on', async () => {
    const metadataOf = async (rp: Rp) =>
      (await rp.manager.handleRequest(new Request(`${AUTH}/sso/saml2/sp/metadata?providerId=${PROVIDER_ID}`))).text();
    expect(await metadataOf(await makeRp({ samlConfig: withLogoutAddress }))).not.toContain('SingleLogoutService');
    expect(await metadataOf(await makeRp({ provider: { signOutOfIdp: true }, samlConfig: withLogoutAddress }))).toContain(
      'SingleLogoutService',
    );
  });
});

// ── Deleting an identity provider ends the sessions a sign-in through it opened ──
// `sso-provider-lifecycle.ts` ("Deleting a provider"): a real sign-in through
// each provider, a real delete through the vendor's own door, then each first
// session cookie presented again.

describe('deleting an identity provider ends the sessions signed in through it', () => {
  const OTHER = 'globex-okta';

  /** A second SAML provider, answered by the same test IdP, under its own id and ACS. */
  async function addSamlProvider(rp: Rp, providerId: string, domain: string, extra: Record<string, unknown> = {}) {
    const ctx = await ((await rp.manager.getAuthInstance()) as any).$context;
    await ctx.adapter.create({
      model: 'ssoProvider',
      data: {
        providerId,
        issuer: IDP_ENTITY,
        domain,
        samlConfig: JSON.stringify({
          issuer: IDP_ENTITY,
          entryPoint: IDP_SSO,
          cert: idpCert,
          callbackUrl: `${AUTH}/sso/saml2/sp/acs/${providerId}`,
          identifierFormat: EMAIL_FORMAT,
          idpMetadata: { entityID: IDP_ENTITY },
          spMetadata: { entityID: `${AUTH}/sso/saml2/sp/metadata?providerId=${providerId}` },
        }),
        ...extra,
      },
    });
  }

  /** The vendor admits a delete by the provider's owner: make `userId` it. */
  async function ownProvider(rp: Rp, providerId: string, userId: string) {
    const ctx = await ((await rp.manager.getAuthInstance()) as any).$context;
    await ctx.adapter.update({ model: 'ssoProvider', where: [{ field: 'providerId', value: providerId }], update: { userId } });
  }

  const sessionOf = async (rp: Rp, cookie: string): Promise<{ user?: { id?: string; email?: string } } | null> => {
    const res = await rp.manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));
    const body = (await res.json().catch(() => null)) as { user?: { id?: string; email?: string } } | null;
    return body?.user ? body : null;
  };

  const remove = (rp: Rp, providerId: string, cookie: string): Promise<Response> =>
    rp.manager.handleRequest(
      new Request(`${AUTH}/sso/delete-provider`, {
        method: 'POST',
        headers: { cookie, origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify({ providerId }),
      }),
    );

  async function twoProviders() {
    const rp = await makeRp({ provider: { allowJit: true } });
    await addSamlProvider(rp, OTHER, 'globex.com', { allowJit: true });
    const member = cookiesOf(await signInThroughIdp(rp, 'p.member@acme.com'));
    const operator = cookiesOf(
      await signInThroughIdp(rp, 'q.operator@globex.com', { callbackURL: AFTER, errorCallbackURL: FAILED, providerId: OTHER }),
    );
    const memberSession = await sessionOf(rp, member);
    const operatorSession = await sessionOf(rp, operator);
    expect(memberSession?.user?.email).toBe('p.member@acme.com');
    expect(operatorSession?.user?.email).toBe('q.operator@globex.com');
    await ownProvider(rp, PROVIDER_ID, operatorSession!.user!.id!);
    return { rp, member, operator };
  }

  const sessionRows = (rp: Rp) => (rp.engine.tables.get('sys_session') ?? []) as Array<Record<string, any>>;

  it('the session signed in through the deleted provider ends; one signed in through another provider does not', async () => {
    const { rp, member, operator } = await twoProviders();
    // A returning sign-in through the same provider: its session is that provider's too.
    const again = cookiesOf(await signInThroughIdp(rp, 'p.member@acme.com'));
    expect((await sessionOf(rp, again))?.user?.email).toBe('p.member@acme.com');
    expect(sessionRows(rp).map((r) => r.sso_provider_id).sort()).toEqual([PROVIDER_ID, PROVIDER_ID, OTHER]);

    const res = await remove(rp, PROVIDER_ID, operator);
    const body = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ providerId: PROVIDER_ID, revokedSessions: 2, dependentsRemoved: true });

    expect(await sessionOf(rp, member)).toBeNull();
    expect(await sessionOf(rp, again)).toBeNull();
    expect((await sessionOf(rp, operator))?.user?.email).toBe('q.operator@globex.com');
    const ended = sessionRows(rp).filter((r) => r.sso_provider_id === PROVIDER_ID);
    expect(ended.map((r) => r.revoke_reason)).toEqual(['sso_provider_deleted', 'sso_provider_deleted']);
    expect(sessionRows(rp).find((r) => r.sso_provider_id === OTHER)?.revoked_at).toBeFalsy();
  });

  it('CONTROL: a delete the vendor refuses ends no session', async () => {
    const { rp, member, operator } = await twoProviders();
    // The member does not own the other provider: the vendor refuses the delete.
    const res = await remove(rp, OTHER, member);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await sessionOf(rp, member))?.user?.email).toBe('p.member@acme.com');
    expect((await sessionOf(rp, operator))?.user?.email).toBe('q.operator@globex.com');
  });
});
