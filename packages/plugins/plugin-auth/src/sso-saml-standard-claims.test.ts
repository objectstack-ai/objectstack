// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pure halves of `sso-saml-standard-claims.ts`: which attribute names a
 * posted SAMLResponse is read for, which unset mapping members read a standard
 * claim, and the adapter read half. The end-to-end pins, through the real
 * vendor, live in `sso-saml-refusal-landing.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  applyStandardSamlClaimsOnRead,
  readSamlAssertionAttributeNames,
  SAML_NAMES_MAX_RESPONSE_BYTES,
  SAML_STANDARD_CLAIMS,
  samlAssertionAttributeNames,
  samlStandardClaimMembers,
} from './sso-saml-standard-claims.js';
import { runWithSamlProviderScope } from './sso-sign-in-options.js';

const EMAIL = SAML_STANDARD_CLAIMS.email;
const GIVEN = SAML_STANDARD_CLAIMS.firstName;

const attribute = (name: string, value = 'v') =>
  `<saml:Attribute Name="${name}"><saml:AttributeValue>${value}</saml:AttributeValue></saml:Attribute>`;
const assertion = (attributes: string, extra = '') =>
  `<saml:Assertion ID="_a"><saml:Subject><saml:NameID>opaque</saml:NameID></saml:Subject>${extra}`
  + `<saml:AttributeStatement>${attributes}</saml:AttributeStatement></saml:Assertion>`;
const response = (body: string) =>
  Buffer.from(
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">'
      + `${body}</samlp:Response>`,
  ).toString('base64');

describe('which attribute names a posted SAMLResponse is read for', () => {
  it("the one assertion's attribute names, each once, in document order", () => {
    const posted = response(assertion(attribute(EMAIL) + attribute(GIVEN) + attribute(EMAIL)));
    expect(samlAssertionAttributeNames(posted)).toEqual([EMAIL, GIVEN]);
  });

  it('every attribute statement of that assertion', () => {
    const two = `<saml:Assertion><saml:AttributeStatement>${attribute('a')}</saml:AttributeStatement>`
      + `<saml:AttributeStatement>${attribute('b')}</saml:AttributeStatement></saml:Assertion>`;
    expect(samlAssertionAttributeNames(response(two))).toEqual(['a', 'b']);
  });

  it('none for an encrypted assertion, two assertions, a nested assertion, or no assertion', () => {
    expect(samlAssertionAttributeNames(response('<saml:EncryptedAssertion>x</saml:EncryptedAssertion>'))).toEqual([]);
    expect(samlAssertionAttributeNames(response(assertion(attribute(EMAIL)) + assertion(attribute(GIVEN))))).toEqual([]);
    expect(samlAssertionAttributeNames(response(assertion(attribute(EMAIL), assertion(attribute(GIVEN)))))).toEqual([]);
    expect(samlAssertionAttributeNames(response(''))).toEqual([]);
  });

  it('none for a value that is not base64 XML, not a Response, or larger than the vendor reads', () => {
    expect(samlAssertionAttributeNames('not base64!')).toEqual([]);
    expect(samlAssertionAttributeNames(Buffer.from('plain text').toString('base64'))).toEqual([]);
    expect(samlAssertionAttributeNames(Buffer.from(`<Other>${assertion(attribute(EMAIL))}</Other>`).toString('base64'))).toEqual([]);
    const padded = response(assertion(attribute(EMAIL) + attribute('pad', 'x'.repeat(SAML_NAMES_MAX_RESPONSE_BYTES))));
    expect(padded.length).toBeGreaterThan(SAML_NAMES_MAX_RESPONSE_BYTES);
    expect(samlAssertionAttributeNames(padded)).toEqual([]);
  });

  it('read off a form or JSON ACS post, leaving the body for the vendor; nothing off an unreadable one', async () => {
    const posted = response(assertion(attribute(EMAIL)));
    const form = new Request('http://localhost/acs', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SAMLResponse: posted }).toString(),
    });
    expect(await readSamlAssertionAttributeNames(form)).toEqual([EMAIL]);
    expect(new URLSearchParams(await form.text()).get('SAMLResponse')).toBe(posted);
    const json = new Request('http://localhost/acs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ SAMLResponse: posted }),
    });
    expect(await readSamlAssertionAttributeNames(json)).toEqual([EMAIL]);
    expect(await readSamlAssertionAttributeNames(new Request('http://localhost/acs', { method: 'POST', body: '{' , headers: { 'content-type': 'application/json' } }))).toEqual([]);
  });
});

describe('which unset mapping members read a standard claim', () => {
  const all = Object.values(SAML_STANDARD_CLAIMS);

  it('every member, when nothing is mapped and the assertion carries every claim', () => {
    expect(samlStandardClaimMembers(undefined, all)).toEqual(SAML_STANDARD_CLAIMS);
  });

  it('only the members whose claim the assertion carries', () => {
    expect(samlStandardClaimMembers({}, [EMAIL, 'email'])).toEqual({ email: EMAIL });
  });

  it('never a member the mapping names, whatever it names', () => {
    expect(samlStandardClaimMembers({ email: 'mail', firstName: '' }, all)).toEqual({
      lastName: SAML_STANDARD_CLAIMS.lastName,
      name: SAML_STANDARD_CLAIMS.name,
    });
  });
});

describe('the adapter read half', () => {
  const PROVIDER = 'entra';
  const row = (samlConfig: unknown) => ({ provider_id: PROVIDER, saml_config: samlConfig });
  const inScope = <T>(names: string[], run: () => T, providerId = PROVIDER) =>
    runWithSamlProviderScope({ providerId, assertionAttributeNames: names }, async () => run());

  it('in the ACS scope of the row\'s provider: the mapping also names the claim, as a member the fingerprint does not see', async () => {
    const read = row(JSON.stringify({ issuer: 'x' }));
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_sso_provider', read));
    const config = read.saml_config as Record<string, any>;
    expect(config.mapping.email).toBe(EMAIL);
    expect(Object.keys(config)).toEqual(['issuer']);
    expect(JSON.stringify(config)).toBe('{"issuer":"x"}');
  });

  it('a stored mapping keeps its own members visible, and gains the claim hidden', async () => {
    const read = row({ mapping: { extraFields: { groups: 'g' } } });
    await inScope([EMAIL, GIVEN], () => applyStandardSamlClaimsOnRead('sys_sso_provider', read));
    const mapping = (read.saml_config as Record<string, any>).mapping;
    expect([mapping.email, mapping.firstName]).toEqual([EMAIL, GIVEN]);
    expect(JSON.stringify(mapping)).toBe('{"extraFields":{"groups":"g"}}');
  });

  it('never changes the engine\'s own object', async () => {
    const stored = { mapping: { extraFields: { groups: 'g' } } };
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_sso_provider', row(stored)));
    expect(Object.getOwnPropertyNames(stored.mapping)).toEqual(['extraFields']);
  });

  it('untouched outside the scope, for another provider, another object, nothing to add, or a blob it cannot read', async () => {
    const blob = JSON.stringify({ issuer: 'x' });
    const outside = row(blob);
    applyStandardSamlClaimsOnRead('sys_sso_provider', outside);
    expect(outside.saml_config).toBe(blob);
    const other = row(blob);
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_sso_provider', other), 'another');
    expect(other.saml_config).toBe(blob);
    const notProvider = row(blob);
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_user', notProvider));
    expect(notProvider.saml_config).toBe(blob);
    const mapped = row(JSON.stringify({ mapping: { email: 'mail' } }));
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_sso_provider', mapped));
    expect(mapped.saml_config).toBe(JSON.stringify({ mapping: { email: 'mail' } }));
    const broken = row('{not json');
    await inScope([EMAIL], () => applyStandardSamlClaimsOnRead('sys_sso_provider', broken));
    expect(broken.saml_config).toBe('{not json');
  });
});
