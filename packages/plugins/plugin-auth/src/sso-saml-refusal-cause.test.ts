// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SAML refusal diagnosis read off its own inputs (`sso-saml-refusal-cause.ts`).
 * The end of the chain — a real AuthManager refusing real samlify responses —
 * is `sso-saml-refusal-landing.test.ts` ("a refused SAML response names its
 * cause"); this file pins each rule on hand-written envelopes, where every
 * branch can be reached on its own.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SSO_SAML_REFUSAL_CAUSES,
  classifySamlRefusal,
  normalizeSamlCertificate,
  readStoredSamlConfig,
  runSsoSamlRefusalCauseScope,
  samlSigningConfigOf,
  type SamlSigningConfig,
} from './sso-saml-refusal-cause';

const IDP = 'https://idp.acme.example/entity';
const CERT = 'MIICcertKNOWNbodyAAAA';
const OTHER_CERT = 'MIICcertROTATEDbodyBBBB';
const SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
const CONFIG: SamlSigningConfig = { certificates: [CERT], idpEntityId: IDP };

const signature = (cert?: string) =>
  `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/><ds:SignatureValue>c2ln</ds:SignatureValue>${
    cert === undefined ? '' : `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`
  }</ds:Signature>`;

interface Envelope {
  status?: string | null;
  responseSignature?: string;
  assertionSignature?: string;
  issuer?: string;
  issuerXml?: string;
  assertion?: 'plain' | 'encrypted';
  confirmationExtra?: string;
}

/** A Response envelope, base64 as the IdP posts it. */
function samlResponse(e: Envelope = {}): string {
  const status = e.status === null ? '' : `<samlp:Status><samlp:StatusCode Value="${e.status ?? SUCCESS}"/></samlp:Status>`;
  const issuer = e.issuerXml ?? `<saml:Issuer>${e.issuer ?? IDP}</saml:Issuer>`;
  const assertion =
    e.assertion === 'encrypted'
      ? '<saml:EncryptedAssertion><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/></saml:EncryptedAssertion>'
      : `<saml:Assertion ID="_a1" Version="2.0">${issuer}${e.assertionSignature ?? ''}<saml:Subject><saml:NameID>someone@acme.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="https://sp.example/acs">${e.confirmationExtra ?? ''}</saml:SubjectConfirmationData></saml:SubjectConfirmation></saml:Subject></saml:Assertion>`;
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" Version="2.0"><saml:Issuer>${e.issuer ?? IDP}</saml:Issuer>${e.responseSignature ?? ''}${status}${assertion}</samlp:Response>`;
  return Buffer.from(xml).toString('base64');
}

describe('classifySamlRefusal: the first failing check in samlify order names the cause', () => {
  it('the list is closed and in check order', () => {
    expect(SSO_SAML_REFUSAL_CAUSES).toEqual([
      'saml_idp_status_not_success',
      'saml_response_unsigned',
      'saml_signing_certificate_mismatch',
      'saml_issuer_mismatch',
    ]);
  });

  it('a non-success status, checked before anything else (an unsigned, foreign response with it is still that)', () => {
    expect(classifySamlRefusal(samlResponse({ status: 'urn:oasis:names:tc:SAML:2.0:status:Responder' }), CONFIG)).toBe('saml_idp_status_not_success');
    expect(classifySamlRefusal(samlResponse({ status: 'urn:oasis:names:tc:SAML:2.0:status:Requester', issuer: 'x' }), CONFIG)).toBe('saml_idp_status_not_success');
  });

  it('no signature on the Response nor the Assertion', () => {
    expect(classifySamlRefusal(samlResponse(), CONFIG)).toBe('saml_response_unsigned');
  });

  it('the first signature samlify checks embeds a certificate that is not configured', () => {
    expect(classifySamlRefusal(samlResponse({ assertionSignature: signature(OTHER_CERT) }), CONFIG)).toBe('saml_signing_certificate_mismatch');
    expect(classifySamlRefusal(samlResponse({ responseSignature: signature(OTHER_CERT), assertionSignature: signature(CERT) }), CONFIG)).toBe('saml_signing_certificate_mismatch');
  });

  it('a configured certificate with another Assertion issuer, plain or carrying a Format attribute', () => {
    expect(classifySamlRefusal(samlResponse({ assertionSignature: signature(CERT), issuer: 'https://other.example' }), CONFIG)).toBe('saml_issuer_mismatch');
    const formatted = '<saml:Issuer Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">https://other.example</saml:Issuer>';
    expect(classifySamlRefusal(samlResponse({ assertionSignature: signature(CERT), issuerXml: formatted }), CONFIG)).toBe('saml_issuer_mismatch');
    const formattedSame = `<saml:Issuer Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">${IDP}</saml:Issuer>`;
    expect(classifySamlRefusal(samlResponse({ assertionSignature: signature(CERT), issuerXml: formattedSame }), CONFIG)).toBeUndefined();
  });

  it('certificates compare as samlify normalises them: PEM armour, line breaks, spaces and tabs ignored', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${CERT.slice(0, 8)}\r\n\t${CERT.slice(8)} \n-----END CERTIFICATE-----\n`;
    expect(normalizeSamlCertificate(pem)).toBe(CERT);
    const embeddedWrapped = `\n  ${CERT.slice(0, 10)}\n  ${CERT.slice(10)}\n`;
    expect(classifySamlRefusal(samlResponse({ assertionSignature: signature(embeddedWrapped) }), samlSigningConfigOf({ cert: pem, idpMetadata: { entityID: IDP } })!)).toBeUndefined();
  });

  describe('unclassified: the vendor answer stands', () => {
    it.each([
      ['configured certificate and issuer (a broken signature, an expired assertion)', samlResponse({ assertionSignature: signature(CERT) }), CONFIG],
      ['a later signature with a foreign certificate after a configured first one', samlResponse({ responseSignature: signature(CERT), assertionSignature: signature(OTHER_CERT) }), CONFIG],
      ['a signature with no embedded certificate', samlResponse({ assertionSignature: signature() }), CONFIG],
      ['a configuration naming no certificate', samlResponse({ assertionSignature: signature(OTHER_CERT) }), { certificates: [], idpEntityId: IDP }],
      ['a configuration naming no IdP entity id', samlResponse({ assertionSignature: signature(CERT), issuer: 'x' }), { certificates: [CERT], idpEntityId: undefined }],
      ['an encrypted assertion with no visible signature', samlResponse({ assertion: 'encrypted' }), CONFIG],
      ['an encrypted assertion under a configured Response signature', samlResponse({ assertion: 'encrypted', responseSignature: signature(CERT) }), CONFIG],
      ['a missing status (samlify ERR_UNDEFINED_STATUS)', samlResponse({ status: null }), CONFIG],
      ['a wrapped Assertion inside SubjectConfirmationData', samlResponse({ assertionSignature: signature(OTHER_CERT), confirmationExtra: '<saml:Assertion/>' }), CONFIG],
      ['XML the vendor validator rejects', Buffer.from('<samlp:Response><unclosed></samlp:Response>').toString('base64'), CONFIG],
      ['a document that is not a Response', Buffer.from('<samlp:LogoutResponse/>').toString('base64'), CONFIG],
      ['text that is not base64', 'not base64 at all!', CONFIG],
      ['base64 that is not XML', Buffer.from('just words').toString('base64'), CONFIG],
    ])('%s', (_case, posted, config) => {
      expect(classifySamlRefusal(posted, config)).toBeUndefined();
    });
  });
});

describe('samlSigningConfigOf: the certificates and entity id the vendor builds its IdP from', () => {
  it('reads the stored JSON text: idpMetadata.cert before cert, one or a list, and idpMetadata.entityID', () => {
    expect(samlSigningConfigOf(JSON.stringify({ cert: CERT, idpMetadata: { entityID: IDP } }))).toEqual({ certificates: [CERT], idpEntityId: IDP });
    expect(samlSigningConfigOf({ cert: 'ignored', idpMetadata: { entityID: IDP, cert: [CERT, OTHER_CERT] } })).toEqual({ certificates: [CERT, OTHER_CERT], idpEntityId: IDP });
    expect(samlSigningConfigOf({ entryPoint: 'https://idp/sso' })).toEqual({ certificates: [], idpEntityId: undefined });
  });

  it('reads IdP metadata XML when present: one certificate serves both uses; otherwise only use="signing"', () => {
    const shared = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${IDP}"><md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:KeyDescriptor><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${CERT}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor></md:IDPSSODescriptor></md:EntityDescriptor>`;
    expect(samlSigningConfigOf({ cert: 'ignored', idpMetadata: { metadata: shared } })).toEqual({ certificates: [CERT], idpEntityId: IDP });
    const split = shared.replace(
      /<md:KeyDescriptor>[\s\S]*<\/md:KeyDescriptor>/,
      `<md:KeyDescriptor use="encryption"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${OTHER_CERT}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor><md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${CERT}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`,
    );
    expect(samlSigningConfigOf({ idpMetadata: { metadata: split } })).toEqual({ certificates: [CERT], idpEntityId: IDP });
  });

  it('a configuration that cannot be read is undefined', () => {
    expect(samlSigningConfigOf('{not json')).toBeUndefined();
    expect(samlSigningConfigOf(null)).toBeUndefined();
    expect(samlSigningConfigOf({ idpMetadata: { metadata: '<nothing/>' } })).toBeUndefined();
  });
});

describe('runSsoSamlRefusalCauseScope: only the opaque refusal is rewritten, only its error_description', () => {
  const ACS = 'http://localhost:3000/api/v1/auth/sso/saml2/sp/acs/acme';
  const posting = (samlResponseValue: string, json = false) =>
    new Request(ACS, {
      method: 'POST',
      headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
      body: json ? JSON.stringify({ SAMLResponse: samlResponseValue, RelayState: 'rs' }) : new URLSearchParams({ SAMLResponse: samlResponseValue, RelayState: 'rs' }).toString(),
    });
  const redirect = (location: string, extra: Record<string, string> = {}) => new Response(null, { status: 302, headers: { location, ...extra } });
  const OPAQUE = 'http://localhost:3000/sign-in-failed?error=saml_error&error_description=Invalid+SAML+response';
  const stored = JSON.stringify({ cert: CERT, idpMetadata: { entityID: IDP } });
  const rotated = samlResponse({ assertionSignature: signature(OTHER_CERT) });

  /** Runs the scope the way the ACS does: the vendor consumes the request body inside `run`. */
  const scope = async (request: Request, vendor: Response, read: () => Promise<unknown> = async () => stored, host = { warn: vi.fn() }) => {
    const res = await runSsoSamlRefusalCauseScope({ providerId: 'acme', request }, host, read, async () => {
      await request.text();
      return vendor;
    });
    return { res, host };
  };

  it('names the cause, keeps error=saml_error and every header, and writes one warn line', async () => {
    const { res, host } = await scope(posting(rotated), redirect(OPAQUE, { 'set-cookie': 'a=b' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3000/sign-in-failed?error=saml_error&error_description=saml_signing_certificate_mismatch');
    expect(res.headers.get('set-cookie')).toBe('a=b');
    expect(host.warn).toHaveBeenCalledTimes(1);
    expect(host.warn).toHaveBeenCalledWith(expect.stringContaining('(saml_signing_certificate_mismatch)'), { providerId: 'acme', protocol: 'saml', cause: 'saml_signing_certificate_mismatch' });
  });

  it('reads a JSON body too, and keeps a relative target relative', async () => {
    const { res } = await scope(posting(rotated, true), redirect('/oops?from=sso&error=saml_error&error_description=Invalid+SAML+response'));
    expect(res.headers.get('location')).toBe('/oops?from=sso&error=saml_error&error_description=saml_signing_certificate_mismatch');
  });

  it.each([
    ['a success', redirect('http://localhost:3000/after')],
    ['another refusal', redirect('http://localhost:3000/sign-in-failed?error=invalid_saml_response&error_description=Invalid+SAML+response')],
    ['another saml_error description', redirect('http://localhost:3000/sign-in-failed?error=saml_error&error_description=SAML+response+exceeds+maximum+allowed+size')],
    ['a non-redirect', new Response('{}', { status: 400 })],
  ])('%s is returned as the vendor answered it, with no line', async (_case, vendor) => {
    const { res, host } = await scope(posting(rotated), vendor);
    expect(res).toBe(vendor);
    expect(host.warn).not.toHaveBeenCalled();
  });

  it('an unclassified refusal, an unreadable or missing configuration, and a failing read leave the vendor answer as it is', async () => {
    for (const [request, read] of [
      [posting(samlResponse({ assertionSignature: signature(CERT) })), async () => stored],
      [posting(rotated), async () => '{not json'],
      [posting(rotated), async () => undefined],
      [posting(rotated), async () => { throw new Error('store down'); }],
    ] as const) {
      const vendor = redirect(OPAQUE);
      const { res, host } = await scope(request, vendor, read);
      expect(res).toBe(vendor);
      expect(host.warn).not.toHaveBeenCalled();
    }
  });

  it('readStoredSamlConfig reads the row by providerId through the vendor adapter', async () => {
    const findOne = vi.fn(async () => ({ providerId: 'acme', samlConfig: stored }));
    expect(await readStoredSamlConfig({ adapter: { findOne } }, 'acme')).toBe(stored);
    expect(findOne).toHaveBeenCalledWith({ model: 'ssoProvider', where: [{ field: 'providerId', value: 'acme' }] });
    expect(await readStoredSamlConfig({ adapter: { findOne: async () => null } }, 'acme')).toBeUndefined();
  });
});
