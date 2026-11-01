// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The built-in `connector` read-path redactor
// (`connector-credential-redaction.ts`): which positions it withholds, what it
// leaves byte for byte, and the fail-closed census that keeps a secret from
// ever becoming a DECLARED instance-auth key unnoticed.
//
// Every value below is an obviously-fake placeholder; every assertion on one is
// its absence from the served item.

import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CREDENTIAL_MAP_PATHS,
  declaredConnectorAuthKeys,
  redactConnectorItem,
} from './connector-credential-redaction';

const P = (n: number) => `TEST_PLACEHOLDER_${n}`;

const base = {
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  description: 'A vendor API.',
  provider: 'rest',
  enabled: true,
  _diagnostics: { valid: false, issues: [{ path: 'auth', message: 'Unrecognized key(s)' }] },
};

const holds = (v: unknown, ...needles: string[]) => needles.some((n) => JSON.stringify(v).includes(n));

describe('the connector redactor — instance `auth`', () => {
  it('withholds an undeclared key on a static kind and serves the declared ones as stored', () => {
    const item = { ...base, auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: P(1) } };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(['auth.token']);
    expect(served.auth).toEqual({ type: 'bearer', credentialRef: 'VENDOR_TOKEN' });
    expect(holds(served, P(1))).toBe(false);
  });

  it.each([
    ['api-key', { type: 'api-key', credentialRef: 'K', headerName: 'X-Key', key: P(2) }, ['auth.key']],
    ['basic', { type: 'basic', username: 'svc', credentialRef: 'PW', password: P(3) }, ['auth.password']],
    ['none', { type: 'none', token: P(4), key: P(5) }, ['auth.key', 'auth.token']],
  ] as const)('%s: withholds exactly the undeclared keys', (_kind, auth, expected) => {
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, auth });
    expect(redactedKeys).toEqual(expected);
    expect(holds(served, P(2), P(3), P(4), P(5))).toBe(false);
  });

  it('a grant kind keeps every key its grant declares and withholds the secret beside them', () => {
    const auth = {
      type: 'oauth2', grant: 'authorization_code', authorizationUrl: 'https://v.example/authorize',
      tokenUrl: 'https://v.example/token', clientId: 'client-1', credentialRef: 'V_CLIENT_SECRET',
      scopes: ['read'], clientSecret: P(6), refreshToken: P(7),
    };
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, auth });
    expect(redactedKeys).toEqual(['auth.clientSecret', 'auth.refreshToken']);
    const { clientSecret: _s, refreshToken: _r, ...declared } = auth;
    expect(served.auth).toEqual(declared);
  });

  it('a signed scheme keeps its own declared reference keys and withholds key material', () => {
    const auth = {
      type: 'signed', scheme: 'alipay-v3', keyId: 'app-1', credentialRef: 'ALIPAY_PRIVATE_KEY',
      vendorPublicKeyRef: 'ALIPAY_PUBLIC_KEY', appPrivateKey: P(8),
    };
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, auth });
    expect(redactedKeys).toEqual(['auth.appPrivateKey']);
    expect((served.auth as Record<string, unknown>).vendorPublicKeyRef).toBe('ALIPAY_PUBLIC_KEY');
  });

  it('a `type` that names no kind leaves `type` alone declared (fail closed)', () => {
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, auth: { type: 'digest', credentialRef: 'X', secret: P(9) } });
    expect(redactedKeys).toEqual(['auth.credentialRef', 'auth.secret']);
    expect(served.auth).toEqual({ type: 'digest' });
  });

  it('an unknown grant keeps the keys its kind\'s grants declare, never the secret', () => {
    const keys = declaredConnectorAuthKeys({ type: 'oauth2', grant: 'password' });
    expect(keys.has('tokenUrl')).toBe(true);
    expect(keys.has('authorizationUrl')).toBe(true);
    expect(keys.has('clientSecret')).toBe(false);
  });
});

describe('the connector redactor — runtime `authentication` and provider maps', () => {
  it('withholds every `authentication` key but `type`', () => {
    const { item: served, redactedKeys } = redactConnectorItem({
      ...base, authentication: { type: 'api-key', key: P(10), headerName: 'X-Key' },
    });
    expect(redactedKeys).toEqual(['authentication.headerName', 'authentication.key']);
    expect(served.authentication).toEqual({ type: 'api-key' });
  });

  it('`authentication: { type: \'none\' }` holds nothing to withhold', () => {
    const item = { ...base, authentication: { type: 'none' } };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });

  it('withholds each header and environment map WHOLE, and serves the rest of providerConfig as stored', () => {
    const item = {
      ...base,
      providerConfig: {
        baseUrl: 'https://vendor.example.com',
        headers: { Authorization: `Bearer ${P(11)}` },
        defaultHeaders: { Accept: 'application/json', 'X-Api-Key': P(12) },
        transport: { kind: 'http', url: 'https://mcp.example.com', headers: { Cookie: P(13) }, env: { VENDOR_TOKEN: P(14) } },
      },
    };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual([
      'providerConfig.defaultHeaders',
      'providerConfig.headers',
      'providerConfig.transport.env',
      'providerConfig.transport.headers',
    ]);
    expect(served.providerConfig).toEqual({
      baseUrl: 'https://vendor.example.com',
      transport: { kind: 'http', url: 'https://mcp.example.com' },
    });
    expect(holds(served, P(11), P(12), P(13), P(14))).toBe(false);
  });

  it('serves a cleared map and a null as written, and reports neither', () => {
    const item = { ...base, providerConfig: { baseUrl: 'https://v.example', headers: {}, defaultHeaders: null } };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });

  it('withholds a non-map value at a map position too (fail closed)', () => {
    const { redactedKeys } = redactConnectorItem({ ...base, providerConfig: { headers: `Authorization: Bearer ${P(15)}` } });
    expect(redactedKeys).toEqual(['providerConfig.headers']);
  });

  it('the four map positions are the ones the providers send upstream', () => {
    expect(CONNECTOR_CREDENTIAL_MAP_PATHS.map((p) => p.join('.'))).toEqual([
      'providerConfig.headers',
      'providerConfig.defaultHeaders',
      'providerConfig.transport.headers',
      'providerConfig.transport.env',
    ]);
  });
});

describe('the connector redactor — purity and the untouched remainder', () => {
  it('never mutates its input, and leaves every other key (`_diagnostics` included) byte for byte', () => {
    const item = {
      ...base,
      auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: P(16) },
      providerConfig: { baseUrl: 'https://v.example', defaultHeaders: { Authorization: P(17) } },
      retryConfig: { maxAttempts: 3 },
    };
    const before = JSON.stringify(item);
    const { item: served } = redactConnectorItem(item);
    expect(JSON.stringify(item)).toBe(before);
    for (const key of ['name', 'label', 'type', 'description', 'provider', 'enabled', '_diagnostics', 'retryConfig']) {
      expect(served[key], key).toEqual((item as Record<string, unknown>)[key]);
    }
  });

  it('an item with nothing to withhold is returned by reference with []', () => {
    const item = { ...base, auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' }, providerConfig: { baseUrl: 'https://v.example' } };
    const result = redactConnectorItem(item);
    expect(result.item).toBe(item);
    expect(result.redactedKeys).toEqual([]);
  });
});

/**
 * Fail-closed census: the redactor serves every key an instance-auth kind
 * DECLARES, so a secret that became a declared key would be served. Every key
 * any kind declares is listed here; a key added to the union reds this test
 * until it is confirmed to be a reference or not a secret, and listed.
 */
const DECLARED_NOT_A_SECRET = [
  'appId', 'authorizationUrl', 'clientId', 'credentialRef', 'grant', 'headerName', 'keyId',
  'paramName', 'resource', 'scheme', 'scopes', 'tokenUrl', 'type', 'username', 'vendor',
  'vendorPublicKeyRef',
];

describe('fail-closed census of the declared instance-auth keys', () => {
  it('every key any kind declares is a reference or not a secret, and is listed', () => {
    const all = new Set<string>();
    for (const type of ['none', 'bearer', 'api-key', 'basic', 'oauth2', 'app-credential', 'signed']) {
      for (const key of declaredConnectorAuthKeys({ type })) all.add(key);
    }
    expect([...all].sort()).toEqual(DECLARED_NOT_A_SECRET);
  });
});
