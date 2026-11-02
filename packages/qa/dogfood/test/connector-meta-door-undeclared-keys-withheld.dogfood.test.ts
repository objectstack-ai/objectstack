// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The connector metadata doors, booted on the showcase with its own connector
// plugins — keys a connector does not declare are never served:
//
//  - READ: a stored row carrying top-level keys the connector does not declare
//    (seeded through the system context, the only way such a row is written
//    now), an instance whose `retryConfig` and a descriptor whose `actions`
//    element carry an undeclared key (both accepted by the save door), are
//    served with those keys withheld and every declared key as stored — to a
//    member and to an administrator, in the item, layered, published and list
//    reads, and on the published read of a package published twice (whose
//    second snapshot nests the first). The stored rows are never touched.
//  - CARRY-FORWARD: a save of the served form succeeds and keeps every stored
//    value; a `retryConfig` the author removes is removed.
//  - CONTROL: an instance that names its secret with `credentialRef` saves,
//    materializes and dispatches upstream with the reference resolved.
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
  topLevel: 'TEST_PLACEHOLDER_UNDECLARED_TOP_LEVEL',
  topLevelNested: 'TEST_PLACEHOLDER_UNDECLARED_TOP_LEVEL_NESTED',
  retry: 'TEST_PLACEHOLDER_UNDECLARED_RETRY',
  action: 'TEST_PLACEHOLDER_UNDECLARED_ACTION',
  resolvedRef: 'TEST_PLACEHOLDER_UNDECLARED_RESOLVED_REFERENCE',
} as const;
const WITHHELD = [PLACEHOLDERS.topLevel, PLACEHOLDERS.topLevelNested, PLACEHOLDERS.retry, PLACEHOLDERS.action];

/** The reference every instance here names; set in this process's environment before any save. */
const REF = 'CUK_CONTROL_CREDENTIAL_REF';
const LEGACY = 'cuk_legacy_row';
const RETRY = 'cuk_retry_instance';
const DESCRIPTOR = 'cuk_actions_descriptor';
const CONTROL = 'cuk_control';
const TWICE = 'cuk_published_twice';
const TWICE_PACKAGE = 'com.example.cuk-published-twice';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return WITHHELD.some((p) => text.includes(p));
};
/** A served item as a client sends it back: the read decorations dropped. */
const authorable = (served: Record<string, any>): Record<string, any> =>
  Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));

describe('connector metadata doors: keys a connector does not declare are withheld on read and kept on save', () => {
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
    label: `CUK ${name}`,
    type: 'api',
    description: 'A provider-bound instance for the undeclared-key pins.',
    provider: 'rest',
    providerConfig: { baseUrl: `${upstreamUrl}/v1` },
    auth: { type: 'bearer', credentialRef: REF },
    ...over,
  });

  const descriptor = {
    name: DESCRIPTOR,
    label: 'CUK descriptor',
    type: 'saas',
    description: 'A catalog-only descriptor for the undeclared-key pins.',
    actions: [
      { key: 'get_invoice', label: 'Get invoice', effect: 'read', token: PLACEHOLDERS.action },
      { key: 'list_invoices', label: 'List invoices' },
    ],
  };

  const read = async (token: string, name: string) => {
    const res = await stack.apiAs(token, 'GET', `/meta/connector/${name}`);
    const text = await res.text();
    expect(res.status, text.slice(0, 200)).toBe(200);
    return { text, item: itemOf(JSON.parse(text)) };
  };

  /** One door read: 200, names each connector (positive control), and serves no placeholder. */
  const expectWithheld = async (token: string, path: string, names: readonly string[]) => {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
    for (const name of names) expect(text.includes(name), `${path} names ${name}`).toBe(true);
    expect(holdsAPlaceholder(text), `${path} withholds every undeclared key`).toBe(false);
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
    member = await stack.signUp('cuk-member@connector-undeclared.test');

    // A clean save makes the legacy row; the system context then writes the
    // undeclared top-level keys over it.
    const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${LEGACY}`, instance(LEGACY));
    expect(put.status, await put.clone().text()).toBe(200);
    const [row] = await stored(LEGACY);
    await ql.update('sys_metadata', {
      id: row.id,
      metadata: JSON.stringify({
        ...instance(LEGACY, { label: 'CUK legacy (seeded)' }),
        apiKey: PLACEHOLDERS.topLevel,
        extraConfig: { secret: PLACEHOLDERS.topLevelNested },
      }),
    }, { context: SYSTEM });

    const retry = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY}`, instance(RETRY, {
      retryConfig: { strategy: 'exponential_backoff', maxAttempts: 2, secret: PLACEHOLDERS.retry },
    }));
    expect(retry.status, await retry.clone().text()).toBe(200);
    const desc = await stack.apiAs(admin, 'PUT', `/meta/connector/${DESCRIPTOR}`, descriptor);
    expect(desc.status, await desc.clone().text()).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
    if (previousRef === undefined) delete process.env[REF];
    else process.env[REF] = previousRef;
  });

  describe('READ: undeclared keys are withheld from every reader; declared keys are served', () => {
    it('guard the guard: the stored rows hold every undeclared key', async () => {
      const legacy = bodyOf((await stored(LEGACY))[0]);
      expect(legacy.apiKey).toBe(PLACEHOLDERS.topLevel);
      expect(legacy.extraConfig).toEqual({ secret: PLACEHOLDERS.topLevelNested });
      expect(bodyOf((await stored(RETRY))[0]).retryConfig.secret).toBe(PLACEHOLDERS.retry);
      expect(bodyOf((await stored(DESCRIPTOR))[0]).actions[0].token).toBe(PLACEHOLDERS.action);
    });

    it('the item read and the layered view, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        const legacy = await read(token, LEGACY);
        expect(holdsAPlaceholder(legacy.text)).toBe(false);
        expect(legacy.item).not.toHaveProperty('apiKey');
        expect(legacy.item).not.toHaveProperty('extraConfig');
        expect(legacy.item.label).toBe('CUK legacy (seeded)');
        expect(legacy.item.auth).toEqual({ type: 'bearer', credentialRef: REF });

        const retry = await read(token, RETRY);
        expect(holdsAPlaceholder(retry.text)).toBe(false);
        expect(retry.item.retryConfig).toEqual({ strategy: 'exponential_backoff', maxAttempts: 2 });

        const desc = await read(token, DESCRIPTOR);
        expect(holdsAPlaceholder(desc.text)).toBe(false);
        expect(desc.item.actions).toEqual([
          { key: 'get_invoice', label: 'Get invoice', effect: 'read' },
          { key: 'list_invoices', label: 'List invoices' },
        ]);

        for (const name of [LEGACY, RETRY, DESCRIPTOR]) {
          await expectWithheld(token, `/meta/connector/${name}/layers`, [name]);
          await expectWithheld(token, `/meta/connector/${name}/published`, [name]);
        }
      }
    });

    it('the list, both spellings, for a member and for an administrator', async () => {
      for (const token of [member, admin]) {
        await expectWithheld(token, '/meta/connector', [LEGACY, RETRY, DESCRIPTOR]);
        await expectWithheld(token, '/meta/connectors', [LEGACY, RETRY, DESCRIPTOR]);
      }
    });

    it('the published read of a package published twice (the second snapshot nests the first), for a member and for an administrator', async () => {
      const metadata = await stack.kernel.getServiceAsync<any>('metadata');
      await metadata.register('connector', TWICE, {
        ...instance(TWICE),
        apiKey: PLACEHOLDERS.topLevel,
        retryConfig: { maxAttempts: 2, secret: PLACEHOLDERS.retry },
        packageId: TWICE_PACKAGE,
      });
      await metadata.publishPackage(TWICE_PACKAGE, { publishedBy: 'cuk-admin' });
      await metadata.publishPackage(TWICE_PACKAGE, { publishedBy: 'cuk-admin' });
      // Guard the guard: the snapshot nests, and the nested one holds the keys.
      const row = await metadata.get('connector', TWICE);
      expect(row?.publishedDefinition?.publishedDefinition).toBeTruthy();
      expect(holdsAPlaceholder(row.publishedDefinition.publishedDefinition)).toBe(true);
      for (const token of [member, admin]) {
        await expectWithheld(token, `/meta/connector/${TWICE}/published`, [TWICE]);
      }
    });

    it('the stored rows are never redacted: redaction is a serving act', async () => {
      expect(bodyOf((await stored(LEGACY))[0]).apiKey).toBe(PLACEHOLDERS.topLevel);
      expect(bodyOf((await stored(RETRY))[0]).retryConfig.secret).toBe(PLACEHOLDERS.retry);
      expect(bodyOf((await stored(DESCRIPTOR))[0]).actions[0].token).toBe(PLACEHOLDERS.action);
    });
  });

  describe('CARRY-FORWARD: a save of the served form keeps the stored values', () => {
    it('the legacy row: the served form saves, and the row keeps its undeclared keys', async () => {
      const served = (await read(admin, LEGACY)).item;
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${LEGACY}`, { ...authorable(served), label: 'CUK legacy (edited)' });
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(LEGACY))[0]);
      expect(atRest.label).toBe('CUK legacy (edited)');
      expect(atRest.apiKey).toBe(PLACEHOLDERS.topLevel);
      expect(atRest.extraConfig).toEqual({ secret: PLACEHOLDERS.topLevelNested });
      expect(holdsAPlaceholder((await read(member, LEGACY)).text)).toBe(false);
    });

    it('a reordered `actions` list keeps each element\'s withheld key on that element', async () => {
      const served = (await read(admin, DESCRIPTOR)).item;
      const body = authorable(served);
      body.actions = [...body.actions].reverse();
      const res = await stack.apiAs(admin, 'PUT', `/meta/connector/${DESCRIPTOR}`, body);
      expect(res.status, await res.clone().text()).toBe(200);
      const atRest = bodyOf((await stored(DESCRIPTOR))[0]);
      expect(atRest.actions).toEqual([
        { key: 'list_invoices', label: 'List invoices' },
        { key: 'get_invoice', label: 'Get invoice', effect: 'read', token: PLACEHOLDERS.action },
      ]);
    });

    it('a `retryConfig` the author removes is removed; one sent back as served keeps its stored key', async () => {
      const served = authorable((await read(admin, RETRY)).item);
      const kept = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY}`, { ...served, label: 'CUK retry (edited)' });
      expect(kept.status, await kept.clone().text()).toBe(200);
      expect(bodyOf((await stored(RETRY))[0]).retryConfig.secret).toBe(PLACEHOLDERS.retry);

      const { retryConfig: _removed, ...withoutRetry } = served;
      const cleared = await stack.apiAs(admin, 'PUT', `/meta/connector/${RETRY}`, withoutRetry);
      expect(cleared.status, await cleared.clone().text()).toBe(200);
      expect(bodyOf((await stored(RETRY))[0])).not.toHaveProperty('retryConfig');
    });
  });

  describe('CONTROL: a declared-keys-only instance saves and works', () => {
    it('saves, materializes ready, and dispatches with the reference resolved', async () => {
      const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${CONTROL}`, instance(CONTROL));
      expect(put.status, await put.clone().text()).toBe(200);
      await waitReady(CONTROL);
      const handler = automation.resolveConnectorAction(CONTROL, 'request');
      expect(handler, `${CONTROL} is materialized with its request action`).toBeTypeOf('function');
      const before = received.length;
      const out = await handler({ method: 'GET', path: '/probe' }, {});
      expect(out?.status, JSON.stringify(out)).toBe(200);
      expect(received.length).toBe(before + 1);
      expect(received[received.length - 1]).toBe('/v1/probe');
    });
  });
});
