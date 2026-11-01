// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The connector metadata read doors, booted on the showcase: a stored row
// holding a top-level key the connector entry does not declare is served
// without that key, and a save of the served form keeps it at rest.
//
//  - READ: the row is seeded through the system context (the save door refuses
//    such a key, so that is the only way the row is written). The item read,
//    the layered view, the list (both spellings) and the history diff serve
//    neither the key's value nor the key, to a member and to an administrator.
//  - CARRY-FORWARD: a save of the served form succeeds, keeps both keys at rest,
//    and the next read still withholds them.
//
// Every value below is an obviously-fake placeholder, and every assertion on
// one is its absence from what a door served, or its presence at rest.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const PLACEHOLDERS = {
  credentialShaped: 'TEST_PLACEHOLDER_ROOT_CREDENTIAL_SHAPED',
  plain: 'TEST_PLACEHOLDER_ROOT_PLAIN',
} as const;
const ALL_PLACEHOLDERS = Object.values(PLACEHOLDERS);

const ROW = 'crk_root_keys_stored';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return ALL_PLACEHOLDERS.some((p) => text.includes(p));
};

describe('connector metadata read doors: root keys the entry does not declare are withheld', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let ql: any;

  const stored = async (name: string) =>
    rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name }, context: SYSTEM }));

  const instance = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    label: `CRK ${name}`,
    type: 'api',
    description: 'A provider-bound instance for the root-key read pins.',
    provider: 'rest',
    providerConfig: { baseUrl: 'http://127.0.0.1:9/v1' },
    auth: { type: 'bearer', credentialRef: 'CRK_CREDENTIAL_REF' },
    ...over,
  });

  /** One door read: 200, names the connector (positive control), and serves no placeholder. */
  const expectWithheld = async (token: string, path: string, names: readonly string[]) => {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    expect(res.status, `${path}: ${text.slice(0, 200)}`).toBe(200);
    for (const name of names) expect(text.includes(name), `${path} names ${name}`).toBe(true);
    expect(holdsAPlaceholder(text), `${path} withholds every undeclared root key`).toBe(false);
    return text;
  };

  const expectRootKeysAbsent = (served: Record<string, any>, at: string) => {
    expect(served, at).not.toHaveProperty('apiKey');
    expect(served, at).not.toHaveProperty('region');
    expect(served.provider, at).toBe('rest');
  };

  beforeAll(async () => {
    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    admin = await stack.signIn();
    member = await stack.signUp('crk-member@connector-root-keys.test');

    // A clean save makes the row; the system context then writes the legacy body over it.
    const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${ROW}`, instance(ROW));
    expect(put.status, await put.clone().text()).toBe(200);
    const [row] = await stored(ROW);
    await ql.update('sys_metadata', {
      id: row.id,
      metadata: JSON.stringify({
        ...instance(ROW, { label: 'CRK root keys (seeded)' }),
        apiKey: PLACEHOLDERS.credentialShaped,
        region: PLACEHOLDERS.plain,
      }),
    }, { context: SYSTEM });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: the stored row holds both undeclared root keys', async () => {
    const body = bodyOf((await stored(ROW))[0]);
    expect(body.label).toBe('CRK root keys (seeded)');
    expect(body.apiKey).toBe(PLACEHOLDERS.credentialShaped);
    expect(body.region).toBe(PLACEHOLDERS.plain);
  });

  it('withholds undeclared root keys on read: the item read and the layered view, for a member and an administrator', async () => {
    for (const token of [member, admin]) {
      const text = await expectWithheld(token, `/meta/connector/${ROW}`, [ROW, 'CRK root keys (seeded)']);
      const served = itemOf(JSON.parse(text));
      expectRootKeysAbsent(served, 'item');
      expect(served.providerConfig).toEqual({ baseUrl: 'http://127.0.0.1:9/v1' });

      const layered = JSON.parse(await expectWithheld(token, `/meta/connector/${ROW}/layers`, [ROW]));
      const layers = layered?.data ?? layered;
      expectRootKeysAbsent(layers.effective, 'layers.effective');
      if (layers.overlay) expectRootKeysAbsent(layers.overlay, 'layers.overlay');
    }
  });

  it('withholds undeclared root keys on read: the list, both spellings, for a member and an administrator', async () => {
    for (const token of [member, admin]) {
      await expectWithheld(token, '/meta/connector', [ROW]);
      await expectWithheld(token, '/meta/connectors', [ROW]);
    }
  });

  it('a save of the served form keeps the keys at rest; the next read and the history diff still withhold them', async () => {
    const read = await stack.apiAs(admin, 'GET', `/meta/connector/${ROW}`);
    const served = itemOf(await read.json());
    expectRootKeysAbsent(served, 'served');

    const body = Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));
    const resave = await stack.apiAs(admin, 'PUT', `/meta/connector/${ROW}`, { ...body, label: 'CRK root keys (edited)' });
    expect(resave.status, await resave.clone().text()).toBe(200);

    const atRest = bodyOf((await stored(ROW))[0]);
    expect(atRest.label).toBe('CRK root keys (edited)');
    expect(atRest.apiKey).toBe(PLACEHOLDERS.credentialShaped);
    expect(atRest.region).toBe(PLACEHOLDERS.plain);

    const reread = itemOf(JSON.parse(await expectWithheld(admin, `/meta/connector/${ROW}`, ['CRK root keys (edited)'])));
    expectRootKeysAbsent(reread, 'reread');

    // The history now holds the clean first save and the re-save that kept the keys.
    const diffText = await expectWithheld(admin, `/meta/connector/${ROW}/diff`, ['CRK root keys (edited)']);
    const diff = JSON.parse(diffText);
    const answer = diff?.data ?? diff;
    const added = (answer.added ?? []) as Array<{ path: string; value?: unknown }>;
    const apiKey = added.find((e) => e.path === 'apiKey');
    expect(apiKey, diffText.slice(0, 400)).toBeDefined();
    expect(apiKey!.value).toBeUndefined();
  });

  it('the stored row is never redacted: redaction is a serving act', async () => {
    const body = bodyOf((await stored(ROW))[0]);
    expect(body.apiKey).toBe(PLACEHOLDERS.credentialShaped);
    expect(body.region).toBe(PLACEHOLDERS.plain);
  });
});
