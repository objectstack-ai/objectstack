// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The connector metadata doors, booted on the showcase with its own connector
// plugins — an authored connector keeps no credential part in a URL and no key
// its nested shapes do not declare:
//
//  - WRITE: the save door refuses, with the `422 INVALID_METADATA` envelope
//    located at the position, a URL holding a userinfo or a credential query
//    parameter — under `providerConfig` (`baseUrl`, `transport.url`, a URL
//    `spec`, a URL inside an inline `spec` document) and under `auth`
//    (`tokenUrl`, `authorizationUrl`) — and a key `retryConfig` or an
//    `actions` element does not declare. Nothing is stored, and an existing
//    row is left as it was.
//  - CONTROL: an inline `spec` document with credential-free URLs saves as
//    written; an instance with credential-free URLs that names its secret with
//    `credentialRef` saves, materializes and dispatches upstream with the
//    reference resolved; a descriptor with declared action and retry keys saves.
//  - READ: a stored row whose `auth` endpoints carry a userinfo (seeded through
//    the system context, the only way such a row is written now) is served
//    with the userinfo withheld and every declared key as stored, to a member
//    and to an administrator, in the item, layered and list reads. The stored
//    row is never touched.
//  - CARRY-FORWARD: a save of the served form keeps the stored values; an
//    author's own edit of a served URL is stored as the author wrote it. An
//    explicit `retryConfig` — `{}` or the served form — replaces the stored
//    one whole: a key it does not declare is gone from the next read of the
//    stored row, and the answer names it, while a withheld header map on the
//    same row is kept (CONTROL). A `retryConfig` the author leaves out is
//    removed with its stored keys, as before (CONTROL), and one stored as a
//    non-object is still kept at rest by a save that leaves it out (CONTROL).
//
// Every credential below is an obviously-fake placeholder, and every assertion
// on one is its absence from what a door served or stored, or its presence at
// rest on a seeded row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const PLACEHOLDERS = {
  urlPassword: 'TEST_PLACEHOLDER_CUN_URL_PASSWORD',
  urlToken: 'TEST_PLACEHOLDER_CUN_URL_TOKEN',
  urlQuery: 'TEST_PLACEHOLDER_CUN_URL_QUERY',
  nested: 'TEST_PLACEHOLDER_CUN_NESTED',
  header: 'TEST_PLACEHOLDER_CUN_HEADER',
  authEndpoint: 'TEST_PLACEHOLDER_CUN_AUTH_ENDPOINT',
  resolvedRef: 'TEST_PLACEHOLDER_CUN_RESOLVED_REFERENCE',
} as const;
const NEVER_SERVED = Object.values(PLACEHOLDERS).filter((p) => p !== PLACEHOLDERS.resolvedRef);

/** The reference every instance here names; set in this process's environment before any save. */
const REF = 'CUN_CONTROL_CREDENTIAL_REF';
const CONTROL = 'cun_control';
const DESCRIPTOR = 'cun_descriptor';
const EXISTING = 'cun_existing';
const OAUTH_ROW = 'cun_oauth_stored';
const RETRY_ROW = 'cun_retry_stored';
const RETRY_EMPTY = 'cun_retry_empty';
const RETRY_OMIT = 'cun_retry_omit';
const RETRY_MALFORMED = 'cun_retry_malformed';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return NEVER_SERVED.some((p) => text.includes(p));
};
/** A served item as a client sends it back: the read decorations dropped. */
const authorable = (served: Record<string, any>): Record<string, any> =>
  Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));

describe('connector metadata doors: an authored connector keeps no credential in a URL and no undeclared nested key', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let ql: any;
  let automation: any;
  let upstream: Server;
  let upstreamUrl: string;
  const received: string[] = [];
  let previousRef: string | undefined;

  const stored = async (name: string) =>
    rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name }, context: SYSTEM }));

  const instance = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    label: `CUN ${name}`,
    type: 'api',
    description: 'A provider-bound instance for the URL and nested-key pins.',
    provider: 'rest',
    providerConfig: { baseUrl: `${upstreamUrl}/v1` },
    auth: { type: 'bearer', credentialRef: REF },
    ...over,
  });

  const oauth2 = (name: string, over: Record<string, unknown> = {}) => instance(name, {
    auth: {
      type: 'oauth2',
      grant: 'authorization_code',
      authorizationUrl: 'https://auth.vendor.example.com/authorize',
      tokenUrl: 'https://auth.vendor.example.com/token',
      clientId: 'cun-client',
      credentialRef: REF,
      ...over,
    },
  });

  /** A minimal inline OpenAPI document whose one server is `serverUrl`. */
  const inlineSpec = (serverUrl: string) => ({
    openapi: '3.0.3',
    info: { title: 'CUN inline', version: '1.0.0' },
    servers: [{ url: serverUrl }],
    paths: {},
  });

  const descriptor = {
    name: DESCRIPTOR,
    label: 'CUN descriptor',
    type: 'saas',
    description: 'A catalog-only descriptor for the nested-key pins.',
    actions: [{ key: 'get_invoice', label: 'Get invoice', effect: 'read', inputSchema: { type: 'object' } }],
  };

  const read = async (token: string, name: string) => {
    const res = await stack.apiAs(token, 'GET', `/meta/connector/${name}`);
    const text = await res.text();
    expect(res.status, text.slice(0, 200)).toBe(200);
    return { text, item: itemOf(JSON.parse(text)) };
  };

  /** One refused save: the 422 envelope, located at `at`, echoing no credential. */
  const expectRefused = async (name: string, body: Record<string, unknown>, at: string) => {
    const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${name}`, body);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(422);
    const json = JSON.parse(text);
    expect(json.code ?? json.error?.code).toBe('INVALID_METADATA');
    const paths = (json.issues ?? json.error?.issues ?? []).map((i: any) => (Array.isArray(i.path) ? i.path.join('.') : i.path));
    expect(paths, text.slice(0, 300)).toContain(at);
    expect(holdsAPlaceholder(text), 'the refusal echoes no credential').toBe(false);
  };

  const waitReady = async (name: string): Promise<void> => {
    const deadline = Date.now() + 15_000;
    let last = '';
    while (Date.now() < deadline) {
      const res = await stack.apiAs(admin, 'GET', '/automation/connectors');
      const json = (await res.json()) as any;
      const found = (json?.data?.connectors ?? []).find((c: any) => c?.name === name);
      last = JSON.stringify(found ?? null);
      if (found?.state === 'ready') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`connector ${name} never reached ready: ${last}`);
  };

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      received.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    previousRef = process.env[REF];
    process.env[REF] = PLACEHOLDERS.resolvedRef;

    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    automation = await stack.kernel.getServiceAsync<any>('automation');
    admin = await stack.signIn();
    member = await stack.signUp('cun-member@connector-url-nested.test');

    const existing = await stack.apiAs(admin, 'PUT', `/meta/connector/${EXISTING}`, instance(EXISTING));
    expect(existing.status, await existing.clone().text()).toBe(200);

    // Rows stored before the save door refused them: a clean save, then the
    // system context writes the credential parts / undeclared key over it.
    const seedOver = async (name: string, clean: Record<string, unknown>, seeded: Record<string, unknown>) => {
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${name}`, clean);
      expect(res.status, await res.clone().text()).toBe(200);
      const [row] = await stored(name);
      await ql.update('sys_metadata', { id: row.id, metadata: JSON.stringify(seeded) }, { context: SYSTEM });
    };
    await seedOver(OAUTH_ROW, oauth2(OAUTH_ROW), oauth2(OAUTH_ROW, {
      tokenUrl: `https://cun:${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/token`,
      authorizationUrl: `https://${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/authorize?region=eu`,
    }));
    // Each also holds a withheld header map, carried forward: the control on the same save.
    for (const name of [RETRY_ROW, RETRY_EMPTY, RETRY_OMIT]) {
      await seedOver(name, instance(name, { retryConfig: { maxAttempts: 2 } }), instance(name, {
        providerConfig: { baseUrl: `${upstreamUrl}/v1`, defaultHeaders: { Authorization: `Bearer ${PLACEHOLDERS.header}` } },
        retryConfig: { maxAttempts: 2, secret: PLACEHOLDERS.nested },
      }));
    }
    // Saved disabled: the pin is the door's answer, not a materialization of a policy no parse accepts.
    await seedOver(
      RETRY_MALFORMED,
      instance(RETRY_MALFORMED, { enabled: false }),
      instance(RETRY_MALFORMED, { enabled: false, retryConfig: PLACEHOLDERS.nested }),
    );
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
    if (previousRef === undefined) delete process.env[REF];
    else process.env[REF] = previousRef;
  });

  describe('WRITE: a credential part in a URL, or an undeclared nested key, is refused and nothing is stored', () => {
    const cases: Array<[label: string, name: string, body: () => Record<string, unknown>, at: string]> = [
      ['a userinfo password in `providerConfig.baseUrl`', 'cun_w_userinfo',
        () => instance('cun_w_userinfo', { providerConfig: { baseUrl: `https://u:${PLACEHOLDERS.urlPassword}@api.vendor.example.com/v1` } }), 'providerConfig.baseUrl'],
      ['a userinfo token in `providerConfig.baseUrl`', 'cun_w_usertoken',
        () => instance('cun_w_usertoken', { providerConfig: { baseUrl: `https://${PLACEHOLDERS.urlToken}@api.vendor.example.com/v1` } }), 'providerConfig.baseUrl'],
      ['`api_key` in the `providerConfig.baseUrl` query', 'cun_w_api_key',
        () => instance('cun_w_api_key', { providerConfig: { baseUrl: `https://api.vendor.example.com/v1?api_key=${PLACEHOLDERS.urlQuery}` } }), 'providerConfig.baseUrl'],
      ['`token` in the `providerConfig.baseUrl` query', 'cun_w_token',
        () => instance('cun_w_token', { providerConfig: { baseUrl: `https://api.vendor.example.com/v1?page=2&token=${PLACEHOLDERS.urlQuery}` } }), 'providerConfig.baseUrl'],
      ['`access_token` in the `providerConfig.baseUrl` query', 'cun_w_access_token',
        () => instance('cun_w_access_token', { providerConfig: { baseUrl: `https://api.vendor.example.com/v1?access_token=${PLACEHOLDERS.urlQuery}` } }), 'providerConfig.baseUrl'],
      ['the instance\'s own `auth.paramName` in the `providerConfig.baseUrl` query', 'cun_w_param_name',
        () => instance('cun_w_param_name', {
          providerConfig: { baseUrl: `https://api.vendor.example.com/v1?vendor_key=${PLACEHOLDERS.urlQuery}` },
          auth: { type: 'api-key', credentialRef: REF, paramName: 'vendor_key' },
        }), 'providerConfig.baseUrl'],
      ['a userinfo password in an mcp `providerConfig.transport.url`', 'cun_w_mcp',
        () => ({ name: 'cun_w_mcp', label: 'CUN mcp', type: 'api', provider: 'mcp',
          providerConfig: { transport: { kind: 'http', url: `https://u:${PLACEHOLDERS.urlPassword}@mcp.vendor.example.com/mcp` } } }), 'providerConfig.transport.url'],
      ['`token` in an openapi URL `providerConfig.spec`', 'cun_w_openapi',
        () => ({ name: 'cun_w_openapi', label: 'CUN openapi', type: 'api', provider: 'openapi',
          providerConfig: { spec: `https://api.vendor.example.com/openapi.json?token=${PLACEHOLDERS.urlQuery}` },
          auth: { type: 'bearer', credentialRef: REF } }), 'providerConfig.spec'],
      ['`token` in a URL inside an inline openapi `providerConfig.spec` document', 'cun_w_inline_spec',
        () => ({ name: 'cun_w_inline_spec', label: 'CUN inline spec', type: 'api', provider: 'openapi',
          providerConfig: { spec: inlineSpec(`https://api.vendor.example.com/v1?token=${PLACEHOLDERS.urlQuery}`) },
          auth: { type: 'bearer', credentialRef: REF } }), 'providerConfig.spec.servers.0.url'],
      ['a userinfo password in `auth.tokenUrl`', 'cun_w_token_url',
        () => oauth2('cun_w_token_url', { tokenUrl: `https://c:${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/token` }), 'auth.tokenUrl'],
      ['a userinfo in `auth.authorizationUrl`', 'cun_w_authz_url',
        () => oauth2('cun_w_authz_url', { authorizationUrl: `https://${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/authorize` }), 'auth.authorizationUrl'],
      ['an undeclared key inside `retryConfig`', 'cun_w_retry',
        () => instance('cun_w_retry', { retryConfig: { maxAttempts: 2, secret: PLACEHOLDERS.nested } }), 'retryConfig'],
      ['an undeclared key inside an `actions` element', 'cun_w_action',
        () => ({ ...descriptor, name: 'cun_w_action', actions: [{ key: 'list', label: 'List', token: PLACEHOLDERS.nested }] }), 'actions.0'],
    ];

    it.each(cases)('%s', async (_label, name, body, at) => {
      await expectRefused(name, body(), at);
      expect(await stored(name), `${name}: nothing stored`).toEqual([]);
    });

    it('on an existing row, the refused save leaves the row as it was', async () => {
      const before = bodyOf((await stored(EXISTING))[0]);
      await expectRefused(EXISTING, instance(EXISTING, {
        providerConfig: { baseUrl: `https://u:${PLACEHOLDERS.urlPassword}@api.vendor.example.com/v1` },
      }), 'providerConfig.baseUrl');
      await expectRefused(EXISTING, instance(EXISTING, { retryConfig: { secret: PLACEHOLDERS.nested } }), 'retryConfig');
      expect(bodyOf((await stored(EXISTING))[0])).toEqual(before);
      expect(holdsAPlaceholder(await stored(EXISTING))).toBe(false);
    });
  });

  describe('CONTROL: credential-free URLs and declared nested keys save and work', () => {
    it('an instance naming its secret with `credentialRef` saves, materializes ready, and dispatches with the reference resolved', async () => {
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CONTROL}`, instance(CONTROL, {
        providerConfig: { baseUrl: `${upstreamUrl}/v1?region=eu&token=` },
        retryConfig: { strategy: 'exponential_backoff', maxAttempts: 2 },
      }));
      expect(put.status, await put.clone().text()).toBe(200);
      await waitReady(CONTROL);
      const handler = automation.resolveConnectorAction(CONTROL, 'request');
      expect(handler, `${CONTROL} is materialized with its request action`).toBeTypeOf('function');
      const before = received.length;
      const out = await handler({ method: 'GET', path: '/probe' }, {});
      expect(out?.status, JSON.stringify(out)).toBe(200);
      expect(received.length).toBe(before + 1);
      expect(received[received.length - 1]).toMatch(/^\/v1\/probe/);
    });

    it('an inline openapi document whose URLs carry no credential part saves as written', async () => {
      // Saved disabled: the pin is the door's answer, not a materialization.
      const body = {
        name: 'cun_inline_spec_clean', label: 'CUN inline spec (clean)', type: 'api', provider: 'openapi', enabled: false,
        providerConfig: { spec: inlineSpec('https://api.vendor.example.com/v1?region=eu') },
        auth: { type: 'bearer', credentialRef: REF },
      };
      const res = await stack.apiAs(admin, 'PUT', '/meta/connector/cun_inline_spec_clean', body);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(bodyOf((await stored('cun_inline_spec_clean'))[0]).providerConfig).toEqual(body.providerConfig);
    });

    it('a descriptor with declared action keys, and an oauth2 instance with credential-free endpoints, save', async () => {
      const desc = await stack.apiAs(admin, 'PUT', `/meta/connector/${DESCRIPTOR}`, descriptor);
      expect(desc.status, await desc.clone().text()).toBe(200);
      const oauth = await stack.apiAs(admin, 'PUT', '/meta/connector/cun_oauth_clean', oauth2('cun_oauth_clean'));
      expect(oauth.status, await oauth.clone().text()).toBe(200);
      expect(bodyOf((await stored(DESCRIPTOR))[0]).actions).toEqual(descriptor.actions);
    });
  });

  describe('READ: a stored `auth` endpoint\'s userinfo is withheld from every reader; declared keys are served', () => {
    it('guard the guard: the stored row holds the seeded userinfo', async () => {
      const row = bodyOf((await stored(OAUTH_ROW))[0]);
      expect(row.auth.tokenUrl).toContain(PLACEHOLDERS.authEndpoint);
      expect(row.auth.authorizationUrl).toContain(PLACEHOLDERS.authEndpoint);
    });

    it('the item, layered and list reads, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        const { text, item } = await read(token, OAUTH_ROW);
        expect(holdsAPlaceholder(text)).toBe(false);
        expect(item.auth).toEqual({
          type: 'oauth2',
          grant: 'authorization_code',
          authorizationUrl: 'https://auth.vendor.example.com/authorize?region=eu',
          tokenUrl: 'https://auth.vendor.example.com/token',
          clientId: 'cun-client',
          credentialRef: REF,
        });
        for (const path of [`/meta/connector/${OAUTH_ROW}/layers`, '/meta/connector', '/meta/connectors']) {
          const res = await stack.apiAs(token, 'GET', path);
          const body = await res.text();
          expect(res.status, `${path}: ${body.slice(0, 200)}`).toBe(200);
          expect(body.includes(OAUTH_ROW), `${path} names ${OAUTH_ROW}`).toBe(true);
          expect(holdsAPlaceholder(body), `${path} withholds the userinfo`).toBe(false);
        }
      }
    });

    it('the stored row is never redacted: redaction is a serving act', async () => {
      expect(bodyOf((await stored(OAUTH_ROW))[0]).auth.tokenUrl).toContain(PLACEHOLDERS.authEndpoint);
    });
  });

  describe('CARRY-FORWARD: the served form saves and keeps the stored values; an explicit edit is the author\'s word', () => {
    it('a save of the served oauth2 row succeeds and keeps each stored endpoint', async () => {
      const served = authorable((await read(admin, OAUTH_ROW)).item);
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${OAUTH_ROW}`, { ...served, label: 'CUN oauth (edited)' });
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(OAUTH_ROW))[0]);
      expect(atRest.label).toBe('CUN oauth (edited)');
      expect(atRest.auth.tokenUrl).toBe(`https://cun:${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/token`);
      expect(atRest.auth.authorizationUrl).toBe(`https://${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/authorize?region=eu`);
    });

    it('an author\'s edit of a served URL is stored exactly as written', async () => {
      const served = authorable((await read(admin, OAUTH_ROW)).item);
      const edited = { ...served, auth: { ...served.auth, tokenUrl: 'https://auth.vendor.example.com/oauth2/token' } };
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${OAUTH_ROW}`, edited);
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(OAUTH_ROW))[0]);
      expect(atRest.auth.tokenUrl).toBe('https://auth.vendor.example.com/oauth2/token');
      expect(atRest.auth.authorizationUrl).toBe(`https://${PLACEHOLDERS.authEndpoint}@auth.vendor.example.com/authorize?region=eu`);
    });

    const HEADERS_AT_REST = () => ({ Authorization: `Bearer ${PLACEHOLDERS.header}` });

    it('`retryConfig: {}` replaces the stored one whole: the next read of the stored row no longer has the undeclared key', async () => {
      expect(bodyOf((await stored(RETRY_EMPTY))[0]).retryConfig, 'guard the guard: the seeded row holds the key')
        .toEqual({ maxAttempts: 2, secret: PLACEHOLDERS.nested });
      const served = authorable((await read(admin, RETRY_EMPTY)).item);
      expect(served.retryConfig).toEqual({ maxAttempts: 2 });
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY_EMPTY}`, { ...served, retryConfig: {} });
      const text = await res.text();
      expect(res.status, text.slice(0, 300)).toBe(200);
      expect(JSON.parse(text).data.advisories, 'the save names the key it did not carry forward').toEqual([
        expect.objectContaining({ rule: 'withheld-key-dropped', severity: 'warning', path: 'connectors[0].retryConfig.secret' }),
      ]);
      expect(text.includes(PLACEHOLDERS.nested), 'the answer names the key, never its value').toBe(false);
      const atRest = bodyOf((await stored(RETRY_EMPTY))[0]);
      expect(atRest.retryConfig).toEqual({});
      // CONTROL, the same save: a withheld position outside `retryConfig` is still carried forward.
      expect(atRest.providerConfig.defaultHeaders).toEqual(HEADERS_AT_REST());
    });

    it('a save of the served form replaces the stored `retryConfig` whole too', async () => {
      const served = authorable((await read(admin, RETRY_ROW)).item);
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY_ROW}`, { ...served, label: 'CUN retry (edited)' });
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(RETRY_ROW))[0]);
      expect(atRest.label).toBe('CUN retry (edited)');
      expect(atRest.retryConfig).toEqual({ maxAttempts: 2 });
      expect(atRest.providerConfig.defaultHeaders).toEqual(HEADERS_AT_REST());
    });

    it('CONTROL: a save that leaves `retryConfig` out removes it with its stored keys, as before', async () => {
      const { retryConfig: _removed, ...withoutRetry } = authorable((await read(admin, RETRY_OMIT)).item);
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY_OMIT}`, withoutRetry);
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(RETRY_OMIT))[0]);
      expect(atRest).not.toHaveProperty('retryConfig');
      expect(atRest.providerConfig.defaultHeaders).toEqual(HEADERS_AT_REST());
    });

    it('CONTROL: a `retryConfig` stored as a non-object is withheld whole and still carried forward by a save that leaves it out', async () => {
      const served = authorable((await read(admin, RETRY_MALFORMED)).item);
      expect(served).not.toHaveProperty('retryConfig');
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY_MALFORMED}`, { ...served, label: 'CUN retry malformed (edited)' });
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(RETRY_MALFORMED))[0]);
      expect(atRest.label).toBe('CUN retry malformed (edited)');
      expect(atRest.retryConfig).toBe(PLACEHOLDERS.nested);
    });
  });
});
