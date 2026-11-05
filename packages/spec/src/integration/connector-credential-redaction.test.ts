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
  CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES,
  declaredConnectorAuthKeys,
  declaredConnectorEntryKeys,
  redactConnectorItem,
} from './connector-credential-redaction';
import { DeclarativeConnectorEntrySchema } from './connector.zod';
import { METADATA_READ_DECORATIONS } from '../kernel/metadata-read-decorations';

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

describe('the connector redactor — `auth` / `authentication` that is not an object', () => {
  it.each([
    ['auth', 'a string', P(20)],
    ['auth', 'a number', 4242],
    ['auth', 'an array', [P(21)]],
    ['authentication', 'a string', P(22)],
  ] as const)('`%s` holding %s is withheld whole', (position, _what, value) => {
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, [position]: value });
    expect(redactedKeys).toEqual([position]);
    expect(served).not.toHaveProperty(position);
    expect(holds(served, P(20), P(21), P(22))).toBe(false);
    expect(served.name).toBe('vendor');
  });

  it.each([
    ['an empty string', ''],
    ['a null', null],
  ] as const)('a cleared form (%s) is served as written and not reported', (_what, value) => {
    const item = { ...base, auth: value, authentication: value };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });
});

describe('the connector redactor — credentials inside a URL under `providerConfig`', () => {
  const at = (providerConfig: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    redactConnectorItem({ ...base, providerConfig, ...extra });

  it('rewrites the userinfo out of `baseUrl`, keeping the rest of the URL byte for byte', () => {
    const { item: served, redactedKeys } = at({ baseUrl: `https://svc:${P(30)}@api.vendor.example:8443/v2/?region=eu#top` });
    expect(redactedKeys).toEqual(['providerConfig.baseUrl']);
    expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe('https://api.vendor.example:8443/v2/?region=eu#top');
  });

  it('a bare token in the user part goes too', () => {
    const { item: served } = at({ baseUrl: `https://${P(31)}@api.vendor.example/v1` });
    expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe('https://api.vendor.example/v1');
  });

  it('strips each credential query parameter, case-insensitively, and keeps the others in order', () => {
    const { item: served, redactedKeys } = at({
      baseUrl: `https://api.vendor.example/v1?region=eu&API_KEY=${P(32)}&page=2&access_token=${P(33)}`,
    });
    expect(redactedKeys).toEqual(['providerConfig.baseUrl']);
    expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe('https://api.vendor.example/v1?region=eu&page=2');
  });

  it('covers `transport.url` and a URL `spec`, and leaves a package-relative `spec` path alone', () => {
    const { item: served, redactedKeys } = at({
      spec: `https://u:${P(34)}@spec.vendor.example/openapi.json?token=${P(35)}`,
      transport: { kind: 'http', url: `https://mcp.vendor.example/mcp?sig=${P(36)}` },
    });
    expect(redactedKeys).toEqual(['providerConfig.spec', 'providerConfig.transport.url']);
    expect(served.providerConfig).toEqual({
      spec: 'https://spec.vendor.example/openapi.json',
      transport: { kind: 'http', url: 'https://mcp.vendor.example/mcp' },
    });
    const relative = { ...base, providerConfig: { spec: './vendor-openapi.json' } };
    expect(redactConnectorItem(relative)).toEqual({ item: relative, redactedKeys: [] });
  });

  it('strips the query parameter an `api-key` instance itself names with `paramName`', () => {
    const { item: served } = at(
      { baseUrl: `https://api.vendor.example/v1?appid=${P(37)}&units=metric` },
      { auth: { type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'appid' } },
    );
    expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe('https://api.vendor.example/v1?units=metric');
    expect(served.auth).toEqual({ type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'appid' });
  });

  it('a URL with no credential part, and a string that is not a URL holding none, are untouched', () => {
    const item = {
      ...base,
      providerConfig: {
        baseUrl: 'https://api.vendor.example/v1?region=eu',
        note: 'call the regional endpoint by hand',
        include: ['search'],
      },
    };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });

  it('a credential query parameter is rewritten out of any string, a string that is not a URL included', () => {
    const { item: served, redactedKeys } = at({
      baseUrl: 'https://api.vendor.example/v1?region=eu',
      note: `call ?page=2&token=${P(38)}`,
    });
    expect(redactedKeys).toEqual(['providerConfig.note']);
    expect((served.providerConfig as Record<string, unknown>).note).toBe('call ?page=2');
  });

  it('withholds whole an array holding a URL with credential parts, at any depth', () => {
    const { item: served, redactedKeys } = at({
      servers: [`https://u:${P(39)}@a.example`, 'https://b.example'],
      mirrors: ['https://c.example', `https://d.example/v1?token=${P(42)}`],
      transport: { kind: 'http', fallbacks: [{ url: `https://u:${P(43)}@e.example` }] },
      include: ['search', 'https://f.example/v1?region=eu'],
    });
    expect(redactedKeys).toEqual(['providerConfig.mirrors', 'providerConfig.servers', 'providerConfig.transport.fallbacks']);
    expect(served.providerConfig).toEqual({
      transport: { kind: 'http' },
      include: ['search', 'https://f.example/v1?region=eu'],
    });
    expect(holds(served, P(39), P(42), P(43))).toBe(false);
  });

  it('withholds whole a dot-spelled key under providerConfig that holds a credential URL (fail closed)', () => {
    const { item: served, redactedKeys } = at({
      'v1.url': `https://u:${P(40)}@b.example`,
      'legacy.list': ['https://c.example', `https://d.example/v1?token=${P(44)}`],
      'plain.note': 'https://e.example/v1?region=eu',
    });
    expect(redactedKeys).toEqual(['providerConfig.legacy.list', 'providerConfig.v1.url']);
    expect(served.providerConfig).toEqual({ 'plain.note': 'https://e.example/v1?region=eu' });
    expect(holds(served, P(40), P(44))).toBe(false);
  });

  it('a map withheld whole is not walked for URLs: it is reported once, as the map', () => {
    const { redactedKeys } = at({ headers: { Referer: `https://u:${P(41)}@c.example` } });
    expect(redactedKeys).toEqual(['providerConfig.headers']);
  });

  it('the query names include the datasource set and the HTTP conventions', () => {
    for (const name of ['password', 'authToken', 'api_key', 'apikey', 'access_token', 'token', 'key', 'sig', 'client_secret']) {
      expect(CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES).toContain(name);
    }
  });
});

describe('the connector redactor — credentials inside a URL under `auth`', () => {
  const oauth2 = (over: Record<string, unknown>) => ({
    type: 'oauth2', grant: 'authorization_code', clientId: 'client-1', credentialRef: 'V_CLIENT_SECRET',
    authorizationUrl: 'https://auth.vendor.example/authorize', tokenUrl: 'https://auth.vendor.example/token', ...over,
  });

  it('rewrites the userinfo out of `auth.tokenUrl` and `auth.authorizationUrl`, keeping the rest byte for byte', () => {
    const { item: served, redactedKeys } = redactConnectorItem({
      ...base,
      auth: oauth2({
        tokenUrl: `https://c:${P(60)}@auth.vendor.example:8443/oauth/token?region=eu`,
        authorizationUrl: `https://${P(61)}@auth.vendor.example/authorize`,
      }),
    });
    expect(redactedKeys).toEqual(['auth.authorizationUrl', 'auth.tokenUrl']);
    expect(served.auth).toEqual(oauth2({
      tokenUrl: 'https://auth.vendor.example:8443/oauth/token?region=eu',
      authorizationUrl: 'https://auth.vendor.example/authorize',
    }));
    expect(holds(served, P(60), P(61))).toBe(false);
  });

  it('strips a credential query parameter from `auth.resource`', () => {
    const { item: served, redactedKeys } = redactConnectorItem({
      ...base,
      auth: oauth2({ resource: `https://api.vendor.example/?audience=v1&token=${P(62)}` }),
    });
    expect(redactedKeys).toEqual(['auth.resource']);
    expect((served.auth as Record<string, unknown>).resource).toBe('https://api.vendor.example/?audience=v1');
  });

  it('declared `auth` URLs with no credential part are untouched', () => {
    const item = { ...base, auth: oauth2({ resource: 'https://api.vendor.example/' }) };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });
});

describe('the connector redactor — top-level keys the entry does not declare', () => {
  it.each([
    ['a credential-shaped scalar', { apiKey: P(50) }, ['apiKey']],
    ['several credential-shaped keys', { token: P(51), clientSecret: P(52), password: P(53) }, ['clientSecret', 'password', 'token']],
    ['a nested container', { credentials: { user: 'svc', secret: P(54) } }, ['credentials']],
    ['a plain undeclared key', { region: 'eu-west-1' }, ['region']],
  ] as const)('withholds undeclared root keys on read: %s', (_label, extra, keys) => {
    const item = { ...base, providerConfig: { baseUrl: 'https://v.example' }, ...extra };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(keys);
    for (const key of keys) expect(served).not.toHaveProperty(key);
    expect(holds(served, P(50), P(51), P(52), P(53), P(54), 'eu-west-1')).toBe(false);
    expect(served.providerConfig).toEqual({ baseUrl: 'https://v.example' });
    expect(served._diagnostics).toEqual(base._diagnostics);
  });

  it('the declared set is the closed entry\'s own shape, and every declared key is served as stored', () => {
    const shape = (DeclarativeConnectorEntrySchema as unknown as { shape: Record<string, unknown> }).shape;
    expect([...declaredConnectorEntryKeys()].sort()).toEqual(Object.keys(shape).sort());
    for (const key of ['name', 'label', 'type', 'provider', 'providerConfig', 'auth', 'enabled', '_packageId', '_provenance']) {
      expect(declaredConnectorEntryKeys().has(key), key).toBe(true);
    }
    const item = { ...base, providerConfig: { baseUrl: 'https://v.example' }, retryConfig: { maxAttempts: 3 }, _packageId: 'com.vendor' };
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });

  it('the read decorations are the response\'s and are left alone', () => {
    const item = { ...base, _draft: true };
    for (const key of METADATA_READ_DECORATIONS) expect(item).toHaveProperty(key);
    expect(redactConnectorItem(item)).toEqual({ item, redactedKeys: [] });
  });

  it('withholds a cleared undeclared key too, and names it (the save door refuses it whatever its value)', () => {
    const item = { ...base, apiKey: '', token: null, extra: {} };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(['apiKey', 'extra', 'token']);
    for (const key of ['apiKey', 'token', 'extra']) expect(served).not.toHaveProperty(key);
  });

  it('withholds an undeclared root key whose own name carries a dot, and names it whole', () => {
    const item = { ...base, 'x.y': P(59) };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(['x.y']);
    expect(served).not.toHaveProperty('x.y');
    expect(holds(served, P(59))).toBe(false);
  });

  it('withholds an undeclared root key beside the other positions, each named once', () => {
    const { item: served, redactedKeys } = redactConnectorItem({
      ...base,
      apiKey: P(55),
      auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: P(56) },
      providerConfig: { baseUrl: `https://u:${P(57)}@v.example`, headers: { Authorization: P(58) } },
    });
    expect(redactedKeys).toEqual(['apiKey', 'auth.token', 'providerConfig.baseUrl', 'providerConfig.headers']);
    expect(holds(served, P(55), P(56), P(57), P(58))).toBe(false);
  });
});

describe('the connector redactor — keys `retryConfig` and `actions` elements do not declare', () => {
  it('withholds an undeclared key inside `retryConfig`, keeping its declared keys', () => {
    const retryConfig = { strategy: 'exponential_backoff', maxAttempts: 4, secret: P(30) };
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, retryConfig });
    expect(redactedKeys).toEqual(['retryConfig.secret']);
    expect(served.retryConfig).toEqual({ strategy: 'exponential_backoff', maxAttempts: 4 });
    expect(holds(served, P(30))).toBe(false);
  });

  it('withholds an undeclared key inside each `actions` element, addressed by index, keeping the declared keys', () => {
    const actions = [
      { key: 'get_invoice', label: 'Get invoice', effect: 'read', inputSchema: { type: 'object' } },
      { key: 'post_invoice', label: 'Post invoice', token: P(31), extra: { secret: P(32) } },
    ];
    const { item: served, redactedKeys } = redactConnectorItem({ ...base, actions });
    expect(redactedKeys).toEqual(['actions.1.extra', 'actions.1.token']);
    expect(served.actions).toEqual([actions[0], { key: 'post_invoice', label: 'Post invoice' }]);
    expect((served.actions as unknown[])[0]).toBe(actions[0]);
    expect(holds(served, P(31), P(32))).toBe(false);
  });

  it('withholds a cleared undeclared nested key too, as at the top level', () => {
    const item = { ...base, retryConfig: { strategy: 'no_retry', note: null }, actions: [{ key: 'a', label: 'A', extra: {} }] };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(['actions.0.extra', 'retryConfig.note']);
    expect(served.retryConfig).toEqual({ strategy: 'no_retry' });
    expect(served.actions).toEqual([{ key: 'a', label: 'A' }]);
  });

  it('the declared nested keys are the schemas\' own', () => {
    const retryConfig = {
      strategy: 'exponential_backoff', maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 60000,
      backoffMultiplier: 2, retryableStatusCodes: [429], retryOnNetworkError: true, jitter: true,
    };
    const action = { key: 'a', label: 'A', description: 'd', inputSchema: {}, outputSchema: {}, effect: 'write' };
    const item = { ...base, retryConfig, actions: [action] };
    const result = redactConnectorItem(item);
    expect(result.redactedKeys).toEqual([]);
    expect(result.item).toBe(item);
  });

  it.each([
    ['a non-object `retryConfig`', { retryConfig: P(60) }, ['retryConfig']],
    ['an `actions` element that is not an object', { actions: [{ key: 'a', label: 'A' }, P(61)] }, ['actions']],
    ['a `null` `actions` element', { actions: [{ key: 'a', label: 'A', token: P(62) }, null] }, ['actions']],
    ['an `actions` that is not an array', { actions: { key: 'a', token: P(63) } }, ['actions']],
  ] as const)('withholds the container WHOLE when it is not the declared shape: %s', (_label, extra, keys) => {
    const item = { ...base, ...extra };
    const { item: served, redactedKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(keys);
    for (const key of keys) expect(served).not.toHaveProperty(key);
    expect(holds(served, P(60), P(61), P(62), P(63))).toBe(false);
  });

  it('a cleared `retryConfig` or `actions`, and an empty `actions` list, are served as written', () => {
    for (const extra of [{ retryConfig: null }, { retryConfig: '' }, { actions: null }, { actions: [] }]) {
      const item = { ...base, ...extra };
      const result = redactConnectorItem(item);
      expect(result.redactedKeys).toEqual([]);
      expect(result.item).toBe(item);
    }
  });

  it('never mutates its input', () => {
    const item = { ...base, retryConfig: { maxAttempts: 3, secret: P(33) }, actions: [{ key: 'a', label: 'A', token: P(34) }] };
    const before = JSON.stringify(item);
    redactConnectorItem(item);
    expect(JSON.stringify(item)).toBe(before);
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

// [#28640 ②B, ruling 6566912252; ruling 6593804783] Which withheld positions a
// save does NOT carry forward: the undeclared `auth` keys and the undeclared
// keys of an object `retryConfig`, and nothing else.
describe('the connector redactor — withheld and not carried forward', () => {
  it('names every undeclared `auth` key in `notCarriedForwardKeys` as well as in `redactedKeys`', () => {
    const { item: served, redactedKeys, notCarriedForwardKeys } = redactConnectorItem({
      ...base, auth: { type: 'basic', username: 'svc', credentialRef: 'PW', password: P(70), token: P(71) },
    });
    expect(redactedKeys).toEqual(['auth.password', 'auth.token']);
    expect(notCarriedForwardKeys).toEqual(['auth.password', 'auth.token']);
    expect(served.auth).toEqual({ type: 'basic', username: 'svc', credentialRef: 'PW' });
  });

  it('a `type` that names no kind: every key but `type` is undeclared, so none is carried forward', () => {
    const { redactedKeys, notCarriedForwardKeys } = redactConnectorItem({ ...base, auth: { type: 'digest', credentialRef: 'X', secret: P(72) } });
    expect(notCarriedForwardKeys).toEqual(redactedKeys);
  });

  it.each([
    ['a null', null],
    ['an empty string', ''],
    ['an empty map', {}],
  ] as const)('withholds a cleared undeclared `auth` key (%s) too, so the served form passes the closed entry', (_what, value) => {
    const item = {
      name: 'vendor', label: 'Vendor', type: 'api', provider: 'rest',
      providerConfig: { baseUrl: 'https://v.example' },
      auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: value },
    };
    // The reason: the strict instance-auth shape refuses the key whatever it holds.
    expect(DeclarativeConnectorEntrySchema.safeParse(item).success).toBe(false);
    const { item: served, redactedKeys, notCarriedForwardKeys } = redactConnectorItem(item);
    expect(redactedKeys).toEqual(['auth.token']);
    expect(notCarriedForwardKeys).toEqual(['auth.token']);
    expect(DeclarativeConnectorEntrySchema.safeParse(served).success).toBe(true);
  });

  it('CONTROL: every other withheld position stays carried forward — the member is absent', () => {
    const result = redactConnectorItem({
      ...base,
      apiKey: P(73),
      authentication: { type: 'api-key', key: P(74) },
      actions: [{ key: 'get_invoice', label: 'Get invoice', token: P(76) }],
      providerConfig: {
        baseUrl: `https://u:${P(77)}@v.example`,
        headers: { Authorization: P(78) },
        defaultHeaders: { Accept: 'application/json' },
        transport: { kind: 'http', url: 'https://mcp.example.com', headers: { Cookie: P(79) }, env: { TOKEN: P(80) } },
      },
      auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' },
    });
    expect(result.redactedKeys).toEqual([
      'actions.0.token', 'apiKey', 'authentication.key', 'providerConfig.baseUrl', 'providerConfig.defaultHeaders',
      'providerConfig.headers', 'providerConfig.transport.env', 'providerConfig.transport.headers',
    ]);
    expect(result).not.toHaveProperty('notCarriedForwardKeys');
  });

  it('names every undeclared key of an object `retryConfig` in `notCarriedForwardKeys` as well as in `redactedKeys`', () => {
    const { item: served, redactedKeys, notCarriedForwardKeys } = redactConnectorItem({
      ...base, retryConfig: { strategy: 'exponential_backoff', maxAttempts: 2, secret: P(75), token: P(85) },
    });
    expect(redactedKeys).toEqual(['retryConfig.secret', 'retryConfig.token']);
    expect(notCarriedForwardKeys).toEqual(['retryConfig.secret', 'retryConfig.token']);
    expect(served.retryConfig).toEqual({ strategy: 'exponential_backoff', maxAttempts: 2 });
  });

  it('a cleared undeclared `retryConfig` key is withheld and not carried forward too', () => {
    const { redactedKeys, notCarriedForwardKeys } = redactConnectorItem({ ...base, retryConfig: { maxAttempts: 2, secret: null } });
    expect(redactedKeys).toEqual(['retryConfig.secret']);
    expect(notCarriedForwardKeys).toEqual(['retryConfig.secret']);
  });

  it('CONTROL: a `retryConfig` that is not an object is withheld whole and still carried forward', () => {
    const result = redactConnectorItem({ ...base, retryConfig: P(86) });
    expect(result.redactedKeys).toEqual(['retryConfig']);
    expect(result).not.toHaveProperty('notCarriedForwardKeys');
  });

  it('beside an `actions` element\'s undeclared key, only the `retryConfig` key is marked', () => {
    const { redactedKeys, notCarriedForwardKeys } = redactConnectorItem({
      ...base,
      retryConfig: { strategy: 'exponential_backoff', secret: P(87) },
      actions: [{ key: 'get_invoice', label: 'Get invoice', token: P(88) }],
    });
    expect(redactedKeys).toEqual(['actions.0.token', 'retryConfig.secret']);
    expect(notCarriedForwardKeys).toEqual(['retryConfig.secret']);
  });

  it('CONTROL: `auth` that is not an object is withheld whole and still carried forward', () => {
    const result = redactConnectorItem({ ...base, auth: P(81) });
    expect(result.redactedKeys).toEqual(['auth']);
    expect(result).not.toHaveProperty('notCarriedForwardKeys');
  });

  it('beside the other positions, only the undeclared `auth` key is marked', () => {
    const { redactedKeys, notCarriedForwardKeys } = redactConnectorItem({
      ...base,
      apiKey: P(82),
      auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: P(83) },
      providerConfig: { headers: { Authorization: P(84) } },
    });
    expect(redactedKeys).toEqual(['apiKey', 'auth.token', 'providerConfig.headers']);
    expect(notCarriedForwardKeys).toEqual(['auth.token']);
  });
});

/**
 * Fail-closed census: the redactor serves every key an instance-auth kind
 * DECLARES, so a secret that became a declared key would be served. Every key
 * any kind declares is listed here; a key added to the union reds this test
 * until it is confirmed to be a reference or not a secret, and listed.
 */
const DECLARED_NOT_A_SECRET = [
  'appId', 'authorizationUrl', 'clientId', 'clientSource', 'credentialRef', 'grant', 'headerName', 'keyId',
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
