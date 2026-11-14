// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pure halves of `sso-saml-account-key.ts`: which attribute a SAML
 * provider keys its accounts on, what a posted assertion is read for, the
 * adapter's read and write halves, and the confirmation against the verified
 * attributes. The end-to-end pins, through the real vendor, live in
 * `sso-saml-refusal-landing.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  accountKeyAttributeOfMapping,
  ENTRA_OBJECT_ID_CLAIM,
  isEntraIssuer,
  mappingWithAccountKeyAttribute,
  refuseSamlAccountKeyContradiction,
  samlAccountKeyAttributeOf,
  samlAccountKeyOnCreate,
  samlAccountKeyReadingOf,
  samlAccountKeyWhere,
} from './sso-saml-account-key.js';
import { samlAssertionPreview } from './sso-saml-standard-claims.js';
import { runWithSamlProviderScope, type SamlAccountKeyReading } from './sso-sign-in-options.js';

const ENTRA = 'https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/';
const reading: SamlAccountKeyReading = { attribute: ENTRA_OBJECT_ID_CLAIM, nameId: 'opaque-id', value: 'oid-1' };
const inScope = <T>(run: () => T, providerId = 'acme', accountKey: SamlAccountKeyReading | undefined = reading): Promise<T> =>
  runWithSamlProviderScope({ providerId, accountKey }, async () => run());

describe('which attribute a SAML provider keys its accounts on', () => {
  it('Entra issuers by host, and nothing else', () => {
    expect(isEntraIssuer(ENTRA)).toBe(true);
    expect(isEntraIssuer('https://login.microsoftonline.com/tenant/v2.0')).toBe(true);
    expect(isEntraIssuer('https://STS.windows.net/x/')).toBe(true);
    expect(isEntraIssuer('https://sts.windows.net.evil.example/x/')).toBe(false);
    expect(isEntraIssuer('https://evil.example/sts.windows.net/')).toBe(false);
    expect(isEntraIssuer('sts.windows.net')).toBe(false);
    expect(isEntraIssuer(undefined)).toBe(false);
  });

  it('the named attribute, else the Entra object id for an Entra issuer, else none (the NameID)', () => {
    const named = { mapping: { email: 'mail', extraFields: { groups: 'g', accountKey: ' employeeNumber ' } } };
    expect(samlAccountKeyAttributeOf({ samlConfig: JSON.stringify(named), issuer: ENTRA })).toBe('employeeNumber');
    expect(samlAccountKeyAttributeOf({ samlConfig: { entryPoint: 'x' }, issuer: ENTRA })).toBe(ENTRA_OBJECT_ID_CLAIM);
    expect(samlAccountKeyAttributeOf({ samlConfig: '{}', issuer: 'https://idp.acme.example/entity' })).toBeNull();
    expect(samlAccountKeyAttributeOf({ samlConfig: { mapping: { extraFields: { accountKey: '  ' } } }, issuer: 'https://idp.acme.example/e' })).toBeNull();
    // No SAML configuration (an OIDC provider, a missing row): none.
    expect(samlAccountKeyAttributeOf({ samlConfig: null, issuer: ENTRA })).toBeNull();
    expect(samlAccountKeyAttributeOf(null)).toBeNull();
  });

  it('the register bridge stores it under extraFields, keeping every other member', () => {
    const stored = mappingWithAccountKeyAttribute({ email: 'mail', extraFields: { groups: 'g' } }, ' oid ');
    expect(stored).toEqual({ email: 'mail', extraFields: { groups: 'g', accountKey: 'oid' } });
    expect(accountKeyAttributeOfMapping(stored)).toBe('oid');
    expect(mappingWithAccountKeyAttribute(stored, '')).toEqual({ email: 'mail', extraFields: { groups: 'g' } });
    expect(mappingWithAccountKeyAttribute({ extraFields: { accountKey: 'oid' } }, '')).toEqual({});
    expect(mappingWithAccountKeyAttribute(undefined, '')).toEqual({});
  });
});

describe('what a posted assertion is read for', () => {
  const response = (subject: string, attributes: string) =>
    Buffer.from(
      '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">'
        + `<saml:Assertion ID="_a"><saml:Subject>${subject}</saml:Subject><saml:AttributeStatement>${attributes}</saml:AttributeStatement></saml:Assertion>`
        + '</samlp:Response>',
    ).toString('base64');
  const nameId = (text: string) => `<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${text}</saml:NameID>`;
  const attribute = (name: string, ...values: string[]) =>
    `<saml:Attribute Name="${name}">${values.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join('')}</saml:Attribute>`;
  const read = (subject: string, attributes: string, attr: string | null = ENTRA_OBJECT_ID_CLAIM) =>
    samlAccountKeyReadingOf(samlAssertionPreview(response(subject, attributes)), attr);

  it('the NameID and the first value of the key attribute, as written (no number coercion)', () => {
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, 'oid-1'))).toEqual({ ...reading });
    expect(read(nameId('007'), attribute('employeeNumber', '00123', '9'), 'employeeNumber')).toEqual({ attribute: 'employeeNumber', nameId: '007', value: '00123' });
  });

  it('nothing, so the NameID keys the sign-in, when either is not one plain text value', () => {
    const oid = attribute(ENTRA_OBJECT_ID_CLAIM, 'oid-1');
    expect(read(nameId('opaque-id'), attribute('other', 'x'))).toBeUndefined();
    expect(read(nameId('opaque-id'), oid, null)).toBeUndefined();
    expect(read('', oid)).toBeUndefined();
    expect(read(nameId('opa<!---->que-id'), oid)).toBeUndefined();
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, 'oid<!---->-1'))).toBeUndefined();
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, '<![CDATA[oid-1]]>'))).toBeUndefined();
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, 'a&amp;b'))).toBeUndefined();
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, '<x>oid-1</x>'))).toBeUndefined();
    expect(read(nameId('opaque-id'), attribute(ENTRA_OBJECT_ID_CLAIM, ''))).toBeUndefined();
    // The attribute twice: which one a verifier reads is not this read's to guess.
    expect(read(nameId('opaque-id'), oid + attribute(ENTRA_OBJECT_ID_CLAIM, 'oid-2'))).toBeUndefined();
    expect(read(nameId('a') + nameId('b'), oid)).toBeUndefined();
    expect(samlAccountKeyReadingOf(null, ENTRA_OBJECT_ID_CLAIM)).toBeUndefined();
  });
});

describe('the adapter halves rewrite only this provider and this NameID, inside the ACS scope', () => {
  const lookup = (providerId: string, accountId: string) => [
    { field: 'provider_id', value: providerId, operator: 'eq', connector: 'AND' },
    { field: 'account_id', value: accountId, operator: 'eq', connector: 'AND' },
  ];

  it('the lookup of this provider and NameID asks for the key value', async () => {
    const asked = lookup('acme', 'opaque-id');
    const where = await inScope(() => samlAccountKeyWhere('sys_account', asked));
    expect(where).toEqual(lookup('acme', 'oid-1'));
    expect(asked).toEqual(lookup('acme', 'opaque-id')); // the caller's array is not changed
  });

  it('every other read is handed back as it came', async () => {
    for (const [objectName, where] of [
      ['sys_account', lookup('other', 'opaque-id')],
      ['sys_account', lookup('acme', 'someone-else')],
      ['sys_account', [{ field: 'provider_id', value: 'acme' }]],
      ['sys_account', [...lookup('acme', 'opaque-id').slice(0, 1), { field: 'account_id', value: 'opaque-id', operator: 'in', connector: 'AND' }]],
      ['sys_account', [...lookup('acme', 'opaque-id').slice(0, 1), { field: 'account_id', value: 'opaque-id', operator: 'eq', connector: 'OR' }]],
      ['sys_user', lookup('acme', 'opaque-id')],
    ] as const) {
      const asked = where as unknown as Parameters<typeof samlAccountKeyWhere>[1];
      expect(await inScope(() => samlAccountKeyWhere(objectName, asked))).toBe(asked);
    }
    const asked = lookup('acme', 'opaque-id');
    expect(samlAccountKeyWhere('sys_account', asked)).toBe(asked); // no scope
    expect(await inScope(() => samlAccountKeyWhere('sys_account', asked), 'acme', undefined)).toBe(asked); // no reading
  });

  it('the account write of this provider and NameID is made with the key value', async () => {
    const row = { user_id: 'u1', provider_id: 'acme', account_id: 'opaque-id' };
    expect(await inScope(() => samlAccountKeyOnCreate('sys_account', row))).toEqual({ ...row, account_id: 'oid-1' });
    expect(row.account_id).toBe('opaque-id');
    const other = { user_id: 'u1', provider_id: 'credential', account_id: 'opaque-id' };
    expect(await inScope(() => samlAccountKeyOnCreate('sys_account', other))).toBe(other);
    expect(await inScope(() => samlAccountKeyOnCreate('sys_user', row))).toBe(row);
    expect(samlAccountKeyOnCreate('sys_account', row)).toBe(row);
  });
});

describe('the read value is confirmed against the verified attributes', () => {
  const data = (profile: Record<string, unknown>, providerId = 'acme', method = 'sso-saml') => ({
    user: { email: 'mia@acme.com' },
    source: { method, action: 'create-user', sso: { providerId, profile } },
  });

  it('goes on when the verified assertion carries the value (one value or a list)', async () => {
    expect(await inScope(() => refuseSamlAccountKeyContradiction(data({ [ENTRA_OBJECT_ID_CLAIM]: 'oid-1' })))).toBeUndefined();
    expect(await inScope(() => refuseSamlAccountKeyContradiction(data({ [ENTRA_OBJECT_ID_CLAIM]: [' oid-1 ', 'x'] })))).toBeUndefined();
  });

  it('refuses INVALID_REQUEST, naming no value, when it carries another or none', async () => {
    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    for (const profile of [{ [ENTRA_OBJECT_ID_CLAIM]: 'oid-2' }, {}, { [ENTRA_OBJECT_ID_CLAIM]: ['oid-2', 'oid-1'] }]) {
      const refusal = await inScope(() => refuseSamlAccountKeyContradiction(data(profile), logger));
      expect(refusal?.error).toBe('INVALID_REQUEST');
      expect(refusal?.errorDescription).not.toMatch(/oid-/);
    }
    expect(JSON.stringify(warnings)).not.toMatch(/oid-|opaque/);
  });

  it('judges only a SAML sign-in of the provider in scope that has a reading', async () => {
    const contradicting = { [ENTRA_OBJECT_ID_CLAIM]: 'oid-2' };
    expect(await inScope(() => refuseSamlAccountKeyContradiction(data(contradicting, 'other')))).toBeUndefined();
    expect(await inScope(() => refuseSamlAccountKeyContradiction(data(contradicting, 'acme', 'sso-oidc')))).toBeUndefined();
    expect(await inScope(() => refuseSamlAccountKeyContradiction(data(contradicting)), 'acme', undefined)).toBeUndefined();
    expect(refuseSamlAccountKeyContradiction(data(contradicting))).toBeUndefined();
  });
});
