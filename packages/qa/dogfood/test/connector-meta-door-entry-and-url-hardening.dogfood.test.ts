// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The connector metadata doors, booted on the showcase with its own connector
// plugins — the authored-entry close and two read-path withholdings:
//
//  - WRITE: the save door refuses a connector entry carrying a top-level key the
//    entry does not declare — a scalar or a nested container — with the
//    `422 INVALID_METADATA` envelope, naming the key, and stores nothing.
//  - CONTROL: an instance that names its secret with `credentialRef` and keeps
//    its provider settings under `providerConfig` saves, materializes, and
//    dispatches upstream with the reference resolved.
//  - READ: a stored row whose provider URLs carry credential parts, and one
//    whose `auth` / `authentication` is not an object (both seeded through the
//    system context, the only way such a row is written), is served with those
//    parts withheld, to a member and to an administrator, in the item, list and
//    layered reads; the stored row itself is never touched.
//  - CARRY-FORWARD: a save of the served form keeps the stored URL whole, and
//    the instance still dispatches with it.
//
// Every credential below is an obviously-fake placeholder, and every assertion
// on one is its absence from what a door served, or its presence at rest.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const PLACEHOLDERS = {
  topLevel: 'TEST_PLACEHOLDER_TOP_LEVEL_VALUE',
  nested: 'TEST_PLACEHOLDER_NESTED_VALUE',
  urlPassword: 'TEST_PLACEHOLDER_URL_PASSWORD',
  urlQuery: 'TEST_PLACEHOLDER_URL_QUERY',
  carried: 'TEST_PLACEHOLDER_CARRIED_QUERY',
  stringAuth: 'TEST_PLACEHOLDER_STRING_AUTH',
  stringAuthentication: 'TEST_PLACEHOLDER_STRING_AUTHENTICATION',
  resolvedRef: 'TEST_PLACEHOLDER_RESOLVED_REFERENCE',
} as const;
const ALL_PLACEHOLDERS = Object.values(PLACEHOLDERS).filter((p) => p !== PLACEHOLDERS.resolvedRef);

/** The reference every instance here names; set in this process's environment before any save. */
const REF = 'CEU_CONTROL_CREDENTIAL_REF';
const CONTROL = 'ceu_control';
const URL_ROW = 'ceu_url_stored';
const CARRIED = 'ceu_url_carried';
const NON_OBJECT = 'ceu_non_object_auth';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return ALL_PLACEHOLDERS.some((p) => text.includes(p));
};

describe('connector metadata doors: undeclared entry keys refused; URL credentials and non-object auth withheld on read', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let ql: any;
  let automation: any;
  let upstream: Server;
  let upstreamUrl: string;
  let upstreamHostPort: string;
  const received: string[] = [];
  let previousRef: string | undefined;

  const stored = async (name: string) =>
    rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name }, context: SYSTEM }));

  const instance = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    label: `CEU ${name}`,
    type: 'api',
    description: 'A provider-bound instance for the connector entry and URL pins.',
    provider: 'rest',
    providerConfig: { baseUrl: upstreamUrl },
    auth: { type: 'bearer', credentialRef: REF },
    ...over,
  });

  /** One door read: 200, names the connector (positive control), and serves no placeholder. */
  const expectWithheld = async (token: string, path: string, names: readonly string[]) => {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
    for (const name of names) expect(text.includes(name), `${path} names ${name}`).toBe(true);
    expect(holdsAPlaceholder(text), `${path} withholds every credential part`).toBe(false);
    return text;
  };

  /** Dispatch the instance's generic `request` action once; the URL the upstream received. */
  const dispatch = async (name: string, path: string): Promise<string> => {
    const handler = automation.resolveConnectorAction(name, 'request');
    expect(handler, `${name} is materialized with its request action`).toBeTypeOf('function');
    const before = received.length;
    const out = await handler({ method: 'GET', path }, {});
    expect(out?.status, JSON.stringify(out)).toBe(200);
    expect(received.length).toBe(before + 1);
    return received[received.length - 1]!;
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

  /** A clean save makes the row; the system context then writes `body` over it. */
  const seed = async (name: string, body: Record<string, unknown>) => {
    const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${name}`, instance(name));
    expect(put.status, await put.clone().text()).toBe(200);
    const [row] = await stored(name);
    await ql.update('sys_metadata', { id: row.id, metadata: JSON.stringify(body) }, { context: SYSTEM });
  };

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      received.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamHostPort = `127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    upstreamUrl = `http://${upstreamHostPort}`;
    previousRef = process.env[REF];
    process.env[REF] = PLACEHOLDERS.resolvedRef;

    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    automation = await stack.kernel.getServiceAsync<any>('automation');
    admin = await stack.signIn();
    member = await stack.signUp('ceu-member@connector-entry.test');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
    if (previousRef === undefined) delete process.env[REF];
    else process.env[REF] = previousRef;
  });

  describe('WRITE: the save door refuses a top-level key the connector entry does not declare', () => {
    it.each([
      ['a credential-shaped scalar', 'ceu_refused_scalar', { apiKey: PLACEHOLDERS.topLevel }, 'apiKey', 'credentialRef'],
      ['a nested container', 'ceu_refused_nested', { extraConfig: { secret: PLACEHOLDERS.nested } }, 'extraConfig', 'Unrecognized'],
      ['a misplaced provider setting', 'ceu_refused_provider', { baseUrl: 'http://127.0.0.1:9/v1' }, 'baseUrl', 'providerConfig'],
    ] as const)('%s: 422 INVALID_METADATA naming the key, and nothing is stored', async (_label, name, extra, key, prescription) => {
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${name}`, { ...instance(name), ...extra });
      const json = (await res.json()) as any;
      expect(res.status, JSON.stringify(json).slice(0, 400)).toBe(422);
      expect(json.code, JSON.stringify(json).slice(0, 400)).toBe('INVALID_METADATA');
      const issues = (json.issues ?? json.error?.issues ?? json.details?.issues ?? []) as Array<{ path?: unknown; code?: string; message?: string }>;
      const located = issues.find((i) => i.code === 'unrecognized_keys' && (i.path === '' || i.path === undefined));
      expect(located, JSON.stringify(issues).slice(0, 400)).toBeDefined();
      expect(located!.message).toContain(`\`${key}\``);
      expect(located!.message).toContain(prescription);
      expect(holdsAPlaceholder(json), 'the refusal never echoes the value').toBe(false);
      expect(await stored(name)).toHaveLength(0);
      const read = await stack.apiAs(member, 'GET', `/meta/connector/${name}`);
      expect(read.status, 'a refused entry is not served to anyone').toBe(404);
    });
  });

  describe('CONTROL: a declared-keys-only instance saves and works', () => {
    it('saves, materializes ready, and dispatches with the reference resolved', async () => {
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CONTROL}`, instance(CONTROL, {
        providerConfig: { baseUrl: `${upstreamUrl}/v1` },
      }));
      expect(put.status, await put.clone().text()).toBe(200);
      await waitReady(CONTROL);
      expect(await dispatch(CONTROL, '/probe')).toBe('/v1/probe');
    });
  });

  describe('READ: credential parts of a stored URL, and a non-object auth, are withheld from every reader', () => {
    beforeAll(async () => {
      await seed(URL_ROW, {
        ...instance(URL_ROW, { label: 'CEU url (seeded)' }),
        providerConfig: {
          baseUrl: `http://svc:${PLACEHOLDERS.urlPassword}@${upstreamHostPort}/v1?api_key=${PLACEHOLDERS.urlQuery}&region=eu`,
          spec: `https://svc:${PLACEHOLDERS.urlPassword}@spec.invalid/openapi.json?token=${PLACEHOLDERS.urlQuery}`,
          transport: { kind: 'http', url: `https://mcp.invalid/mcp?access_token=${PLACEHOLDERS.urlQuery}` },
        },
      });
      await seed(NON_OBJECT, {
        ...instance(NON_OBJECT, { label: 'CEU non-object (seeded)' }),
        auth: PLACEHOLDERS.stringAuth,
        authentication: PLACEHOLDERS.stringAuthentication,
      });
    });

    it('guard the guard: the stored rows hold every seeded credential part', async () => {
      const url = bodyOf((await stored(URL_ROW))[0]);
      expect(url.label).toBe('CEU url (seeded)');
      expect(url.providerConfig.baseUrl).toContain(PLACEHOLDERS.urlPassword);
      expect(url.providerConfig.baseUrl).toContain(PLACEHOLDERS.urlQuery);
      expect(url.providerConfig.spec).toContain(PLACEHOLDERS.urlPassword);
      expect(url.providerConfig.transport.url).toContain(PLACEHOLDERS.urlQuery);
      const nonObject = bodyOf((await stored(NON_OBJECT))[0]);
      expect(nonObject.auth).toBe(PLACEHOLDERS.stringAuth);
      expect(nonObject.authentication).toBe(PLACEHOLDERS.stringAuthentication);
    });

    it('the item read and the layered view withhold every part, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        const urlText = await expectWithheld(token, `/meta/connector/${URL_ROW}`, [URL_ROW, 'CEU url (seeded)']);
        expect(itemOf(JSON.parse(urlText)).providerConfig).toEqual({
          baseUrl: `http://${upstreamHostPort}/v1?region=eu`,
          spec: 'https://spec.invalid/openapi.json',
          transport: { kind: 'http', url: 'https://mcp.invalid/mcp' },
        });
        await expectWithheld(token, `/meta/connector/${URL_ROW}/layers`, [URL_ROW]);

        const nonObjectText = await expectWithheld(token, `/meta/connector/${NON_OBJECT}`, [NON_OBJECT, 'CEU non-object (seeded)']);
        const served = itemOf(JSON.parse(nonObjectText));
        expect(served).not.toHaveProperty('auth');
        expect(served).not.toHaveProperty('authentication');
        expect(served.provider).toBe('rest');
        await expectWithheld(token, `/meta/connector/${NON_OBJECT}/layers`, [NON_OBJECT]);
      }
    });

    it('the list, both spellings, withholds every part, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        await expectWithheld(token, '/meta/connector', [URL_ROW, NON_OBJECT, CONTROL]);
        await expectWithheld(token, '/meta/connectors', [URL_ROW, NON_OBJECT, CONTROL]);
      }
    });

    it('the stored rows are never redacted: redaction is a serving act', async () => {
      expect(bodyOf((await stored(URL_ROW))[0]).providerConfig.baseUrl).toContain(PLACEHOLDERS.urlPassword);
      expect(bodyOf((await stored(NON_OBJECT))[0]).auth).toBe(PLACEHOLDERS.stringAuth);
    });
  });

  describe('CARRY-FORWARD: a save of the served form keeps the stored URL, and dispatch still uses it', () => {
    it('the served URL drops the credential parameter; the re-saved row keeps it; the upstream receives it', async () => {
      const carriedUrl = `${upstreamUrl}/v1?api_key=${PLACEHOLDERS.carried}&region=eu`;
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CARRIED}`, instance(CARRIED, {
        providerConfig: { baseUrl: carriedUrl },
      }));
      expect(put.status, await put.clone().text()).toBe(200);
      await waitReady(CARRIED);

      const read = await stack.apiAs(admin, 'GET', `/meta/connector/${CARRIED}`);
      const served = itemOf(await read.json());
      expect(served.providerConfig).toEqual({ baseUrl: `${upstreamUrl}/v1?region=eu` });
      expect(holdsAPlaceholder(served)).toBe(false);

      const body = Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));
      const resave = await stack.apiAs(admin, 'PUT', `/meta/connector/${CARRIED}`, { ...body, label: 'CEU carried (edited)' });
      expect(resave.status, await resave.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(CARRIED))[0]);
      expect(atRest.label).toBe('CEU carried (edited)');
      expect(atRest.providerConfig.baseUrl).toBe(carriedUrl);

      await waitReady(CARRIED);
      // The base URL's own query stays the query with and without a request path.
      expect(await dispatch(CARRIED, '')).toBe(`/v1?api_key=${PLACEHOLDERS.carried}&region=eu`);
      expect(await dispatch(CARRIED, '/probe')).toBe(`/v1/probe?api_key=${PLACEHOLDERS.carried}&region=eu`);
    });
  });
});
