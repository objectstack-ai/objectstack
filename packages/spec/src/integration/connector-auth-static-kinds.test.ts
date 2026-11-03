// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 §3 / ADR-0143 D3 — the four static kinds of declarative connector
// instance auth (`none`, `bearer`, `api-key`, `basic`) refuse an undeclared
// key at the publish door (`DeclarativeConnectorEntrySchema`, which both
// authoring doors parse), and an inline secret meets the `credentialRef`
// prescription — the refusal the three ADR-0143 kinds already gave. Every
// refusal is pinned by its issue `code`, `path` and `keys`; every kind has a
// CONTROL accept, so a refusal that fired on everything could not pass.

import { describe, it, expect } from 'vitest';
import { DeclarativeConnectorEntrySchema } from './connector.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

/** An obviously-fake placeholder: the refusal must never echo it. */
const PLACEHOLDER = 'TEST_PLACEHOLDER_NOT_A_SECRET';

const entry = (auth: unknown) => ({
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl: 'https://vendor.example.com' },
  auth,
});

const DECLARED = {
  none: { type: 'none' },
  bearer: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' },
  'api-key': { type: 'api-key', credentialRef: 'VENDOR_KEY', headerName: 'X-Vendor-Key' },
  'api-key (query)': { type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'key' },
  basic: { type: 'basic', username: 'svc_objectstack', credentialRef: 'VENDOR_PASSWORD' },
} as const;

/** The one issue of a refused parse, as `[code, path, keys]`, and its message. */
function refusal(input: unknown): { located: [string, string, unknown]; message: string } {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  expect(result.error!.issues).toHaveLength(1);
  const issue = result.error!.issues[0]!;
  return {
    located: [issue.code, issue.path.join('.'), (issue as { keys?: unknown }).keys],
    message: issue.message,
  };
}

describe('the four static instance-auth kinds refuse an undeclared key (ADR-0143 D3)', () => {
  it.each(Object.entries(DECLARED))('CONTROL: %s with only its declared keys parses and comes back unchanged', (_kind, auth) => {
    expect(DeclarativeConnectorEntrySchema.parse(entry(auth)).auth).toEqual(auth);
  });

  it.each([
    ['bearer', { ...DECLARED.bearer, token: PLACEHOLDER }, 'token'],
    ['bearer', { ...DECLARED.bearer, accessToken: PLACEHOLDER }, 'accessToken'],
    ['api-key', { ...DECLARED['api-key'], key: PLACEHOLDER }, 'key'],
    ['api-key', { ...DECLARED['api-key'], apiKey: PLACEHOLDER }, 'apiKey'],
    ['basic', { ...DECLARED.basic, password: PLACEHOLDER }, 'password'],
  ] as const)('%s refuses an inline secret (`%s`) by name at `auth`, pointing at credentialRef', (kind, auth, key) => {
    const { located, message } = refusal(entry(auth));
    expect(located).toEqual(['unrecognized_keys', 'auth', [key]]);
    expect(message).toContain(`Not authorable on \`auth: { type: '${kind}' }\``);
    expect(message).toContain('credentialRef');
    expect(message).not.toContain(PLACEHOLDER);
  });

  it('none refuses a credential, and sends the author to a kind that takes one', () => {
    const { located, message } = refusal(entry({ type: 'none', token: PLACEHOLDER }));
    expect(located).toEqual(['unrecognized_keys', 'auth', ['token']]);
    expect(message).toContain('takes no credential');
    expect(message).not.toContain(PLACEHOLDER);
  });

  it('none refuses a credentialRef too: it names an upstream that takes no credential', () => {
    expect(refusal(entry({ type: 'none', credentialRef: 'VENDOR_TOKEN' })).located)
      .toEqual(['unrecognized_keys', 'auth', ['credentialRef']]);
  });

  it('a non-secret undeclared key is refused as well — the shape is closed, not a denylist', () => {
    const { located, message } = refusal(entry({ ...DECLARED.bearer, headerName: 'X-Vendor-Key' }));
    expect(located).toEqual(['unrecognized_keys', 'auth', ['headerName']]);
    expect(message).toContain('Unrecognized key(s) on this `bearer` connector auth');
  });

  it('the refusal runs on the authored stack collection as well (defineStack `connectors:`)', () => {
    const result = ObjectStackDefinitionSchema.safeParse({
      manifest: { id: 'com.example.vendor', name: 'vendor', version: '1.0.0', type: 'app' as const },
      connectors: [entry({ ...DECLARED.bearer, token: PLACEHOLDER })],
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);
    expect(paths).toContain('unrecognized_keys @ connectors.0.auth');
  });
});
