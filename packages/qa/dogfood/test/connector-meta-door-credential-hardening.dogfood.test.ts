// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Connector credentials at the metadata doors, booted on the showcase with its
// own connector plugins:
//
//  - WRITE: the connector save door refuses an inline secret on an instance's
//    `auth` — every static kind (`bearer`, `api-key`, `basic`, `none`) — with
//    the same `422 INVALID_METADATA` envelope the publish door gives an inline
//    `authentication`, located at `auth`, and stores nothing.
//  - CONTROL: an instance that names its secret with `credentialRef` saves,
//    materializes, and dispatches upstream with the reference resolved and its
//    default headers sent — including after a save of its served form.
//  - READ: a stored row holding inline credential positions (seeded through
//    the system context, the shape a row stored before the write refusal can
//    have) is served with those positions withheld, to a member and to an
//    administrator, by name, in the list and in the layered view, and through
//    the metadata protocol's reads; every other field is served as stored, and
//    the stored row itself is never redacted.
//
// Every credential below is an obviously-fake placeholder, and every assertion
// on one is its absence from what a door served.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const PLACEHOLDERS = {
  inlineToken: 'TEST_PLACEHOLDER_INLINE_TOKEN',
  inlineKey: 'TEST_PLACEHOLDER_INLINE_KEY',
  inlinePassword: 'TEST_PLACEHOLDER_INLINE_PASSWORD',
  headerValue: 'TEST_PLACEHOLDER_HEADER_VALUE',
  defaultHeaderValue: 'TEST_PLACEHOLDER_DEFAULT_HEADER_VALUE',
  runtimeToken: 'TEST_PLACEHOLDER_RUNTIME_TOKEN',
  resolvedRef: 'TEST_PLACEHOLDER_RESOLVED_REFERENCE',
} as const;
const ALL_PLACEHOLDERS = Object.values(PLACEHOLDERS);

/** The reference the CONTROL instance names; set in this process's environment before it is saved. */
const CONTROL_REF = 'CCH_CONTROL_CREDENTIAL_REF';
const CONTROL = 'cch_control';
const STORED = 'cch_stored';
/** One name per refused kind, so each case's "nothing is stored" reads only its own write. */
const refusedName = (kind: string) => `cch_refused_${kind.replace(/-/g, '_')}`;

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return ALL_PLACEHOLDERS.some((p) => text.includes(p));
};

describe('connector metadata doors: inline credentials are refused on write and withheld on read', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let ql: any;
  let protocol: any;
  let automation: any;
  let upstream: Server;
  let upstreamUrl: string;
  const received: IncomingHttpHeaders[] = [];
  let previousRef: string | undefined;

  const stored = async (name: string) =>
    rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name }, context: SYSTEM }));

  const instance = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    label: `CCH ${name}`,
    type: 'api',
    description: 'A provider-bound instance for the connector credential pins.',
    provider: 'rest',
    providerConfig: { baseUrl: upstreamUrl },
    auth: { type: 'bearer', credentialRef: CONTROL_REF },
    ...over,
  });

  /** One door read: 200, names the connector (positive control), and serves no placeholder. */
  const expectWithheld = async (token: string, path: string, names: readonly string[]) => {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
    for (const name of names) expect(text.includes(name), `${path} names ${name}`).toBe(true);
    expect(holdsAPlaceholder(text), `${path} withholds every credential position`).toBe(false);
    return text;
  };

  const dispatch = async (name: string): Promise<IncomingHttpHeaders> => {
    const handler = automation.resolveConnectorAction(name, 'request');
    expect(handler, `${name} is materialized with its request action`).toBeTypeOf('function');
    const before = received.length;
    const out = await handler({ method: 'GET', path: '/probe' }, {});
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

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      received.push(req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    previousRef = process.env[CONTROL_REF];
    process.env[CONTROL_REF] = PLACEHOLDERS.resolvedRef;

    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    protocol = await stack.kernel.getServiceAsync<any>('protocol');
    automation = await stack.kernel.getServiceAsync<any>('automation');
    admin = await stack.signIn();
    member = await stack.signUp('cch-member@connector-credentials.test');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
    if (previousRef === undefined) delete process.env[CONTROL_REF];
    else process.env[CONTROL_REF] = previousRef;
  });

  describe('WRITE: the save door refuses an inline secret on an instance\'s auth', () => {
    it.each([
      ['bearer', { type: 'bearer', credentialRef: CONTROL_REF, token: PLACEHOLDERS.inlineToken }, 'token'],
      ['api-key', { type: 'api-key', credentialRef: CONTROL_REF, key: PLACEHOLDERS.inlineKey }, 'key'],
      ['basic', { type: 'basic', username: 'svc', credentialRef: CONTROL_REF, password: PLACEHOLDERS.inlinePassword }, 'password'],
      ['none', { type: 'none', token: PLACEHOLDERS.inlineToken }, 'token'],
    ] as const)('%s: 422 INVALID_METADATA located at `auth`, naming the key, and nothing is stored', async (kind, auth, key) => {
      const name = refusedName(kind);
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${name}`, instance(name, { auth }));
      const json = (await res.json()) as any;
      expect(res.status, JSON.stringify(json).slice(0, 400)).toBe(422);
      expect(json.code, JSON.stringify(json).slice(0, 400)).toBe('INVALID_METADATA');
      const issues = (json.issues ?? json.error?.issues ?? json.details?.issues ?? []) as Array<{ path?: unknown; message?: string }>;
      const located = issues.find((i) => i.path === 'auth' || (Array.isArray(i.path) && i.path.join('.') === 'auth'));
      expect(located, JSON.stringify(issues).slice(0, 400)).toBeDefined();
      expect(located!.message).toContain(`\`${key}\``);
      expect(holdsAPlaceholder(json), 'the refusal never echoes the value').toBe(false);
      expect(await stored(name)).toHaveLength(0);
    });
  });

  describe('CONTROL: a credentialRef-only instance saves and works', () => {
    it('saves, materializes ready, and dispatches with the reference resolved and its default headers sent', async () => {
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CONTROL}`, instance(CONTROL, {
        providerConfig: { baseUrl: upstreamUrl, defaultHeaders: { 'X-Placeholder-Header': PLACEHOLDERS.defaultHeaderValue } },
      }));
      expect(put.status, await put.clone().text()).toBe(200);
      await waitReady(CONTROL);
      const headers = await dispatch(CONTROL);
      expect(headers.authorization).toBe(`Bearer ${PLACEHOLDERS.resolvedRef}`);
      expect(headers['x-placeholder-header']).toBe(PLACEHOLDERS.defaultHeaderValue);
    });

    it('its read withholds the header map; a save of the served form keeps it, and dispatch still sends it', async () => {
      const read = await stack.apiAs(admin, 'GET', `/meta/connector/${CONTROL}`);
      expect(read.status).toBe(200);
      const served = itemOf(await read.json());
      expect(served.name).toBe(CONTROL);
      expect(served.providerConfig).toEqual({ baseUrl: upstreamUrl });
      expect(served.auth).toEqual({ type: 'bearer', credentialRef: CONTROL_REF });

      const body = Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CONTROL}`, { ...body, label: 'CCH control (edited)' });
      expect(put.status, await put.clone().text()).toBe(200);
      const [row] = await stored(CONTROL);
      expect(bodyOf(row).label).toBe('CCH control (edited)');
      expect(bodyOf(row).providerConfig.defaultHeaders).toEqual({ 'X-Placeholder-Header': PLACEHOLDERS.defaultHeaderValue });

      await waitReady(CONTROL);
      expect((await dispatch(CONTROL))['x-placeholder-header']).toBe(PLACEHOLDERS.defaultHeaderValue);
    });
  });

  describe('READ: a stored row\'s inline credential positions are withheld from every reader', () => {
    const seeded = () => ({
      ...instance(STORED, { label: 'CCH stored (seeded)' }),
      providerConfig: {
        baseUrl: upstreamUrl,
        headers: { Authorization: `Bearer ${PLACEHOLDERS.headerValue}` },
        defaultHeaders: { Authorization: `Bearer ${PLACEHOLDERS.defaultHeaderValue}` },
      },
      auth: { type: 'bearer', credentialRef: 'CCH_STORED_REF', token: PLACEHOLDERS.inlineToken },
      authentication: { type: 'bearer', token: PLACEHOLDERS.runtimeToken },
    });

    beforeAll(async () => {
      // A clean save makes the row; the system context then writes the body a
      // row stored before the write refusal can hold.
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${STORED}`, instance(STORED, {
        auth: { type: 'bearer', credentialRef: 'CCH_STORED_REF' },
      }));
      expect(put.status, await put.clone().text()).toBe(200);
      const [row] = await stored(STORED);
      await ql.update('sys_metadata', { id: row.id, metadata: JSON.stringify(seeded()) }, { context: SYSTEM });
    });

    it('guard the guard: the stored row holds every seeded credential position', async () => {
      const [row] = await stored(STORED);
      const body = bodyOf(row);
      expect(body.label).toBe('CCH stored (seeded)');
      expect(body.auth.token).toBe(PLACEHOLDERS.inlineToken);
      expect(body.authentication.token).toBe(PLACEHOLDERS.runtimeToken);
      expect(body.providerConfig.headers.Authorization).toContain(PLACEHOLDERS.headerValue);
      expect(body.providerConfig.defaultHeaders.Authorization).toContain(PLACEHOLDERS.defaultHeaderValue);
    });

    it('the item read and the layered view withhold every position, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        const text = await expectWithheld(token, `/meta/connector/${STORED}`, [STORED, 'CCH stored (seeded)']);
        const served = itemOf(JSON.parse(text));
        expect(served.auth).toEqual({ type: 'bearer', credentialRef: 'CCH_STORED_REF' });
        expect(served.authentication).toEqual({ type: 'bearer' });
        expect(served.providerConfig).toEqual({ baseUrl: upstreamUrl });
        expect(served.description).toBe('A provider-bound instance for the connector credential pins.');
        expect(served.provider).toBe('rest');
        expect(served.type).toBe('api');
        await expectWithheld(token, `/meta/connector/${STORED}/layers`, [STORED]);
      }
    });

    it('the list, both spellings, withholds every position, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        await expectWithheld(token, '/meta/connector', [STORED, CONTROL]);
        await expectWithheld(token, '/meta/connectors', [STORED, CONTROL]);
      }
    });

    it('the metadata protocol\'s list and item reads withhold every position', async () => {
      const listed = await protocol.getMetaItems({ type: 'connector' });
      expect(JSON.stringify(listed).includes(STORED)).toBe(true);
      expect(holdsAPlaceholder(listed)).toBe(false);
      const item = await protocol.getMetaItem({ type: 'connector', name: STORED });
      expect(JSON.stringify(item).includes('CCH stored (seeded)')).toBe(true);
      expect(holdsAPlaceholder(item)).toBe(false);
    });

    it('the stored row is never redacted: redaction is a serving act', async () => {
      const [row] = await stored(STORED);
      expect(bodyOf(row).auth.token).toBe(PLACEHOLDERS.inlineToken);
      expect(bodyOf(row).providerConfig.defaultHeaders.Authorization).toContain(PLACEHOLDERS.defaultHeaderValue);
    });
  });
});
