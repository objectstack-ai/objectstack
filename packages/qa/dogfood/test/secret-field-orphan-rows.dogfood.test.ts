// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27495] A `secret` field's `sys_secret` row exists only while a committed
// business row names it — pinned at the REST data door of a booted stack, on
// a provider-wired boot (`bootStack` wires one LocalCryptoProvider, as
// `objectstack dev` / `serve` do). `packages/objectql/src/secret-field-write-commit.test.ts`
// drives every refusal class at the engine; this file holds the same two
// halves through the door a client actually writes through:
//
//  - a write the door refuses (a required field missing, an option outside the
//    list, on create and on update) leaves the `sys_secret` row count as it was;
//  - a PATCH that clears the field with `null`, or replaces its value, removes
//    the row the field named before, and a committed write still stores and
//    reads back.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SECRET_MASK } from '@objectstack/objectql';

const VAULT = 'sfo_vault';

const sfoStack = defineStack({
  manifest: {
    id: 'com.dogfood.secret-field-orphan-rows', namespace: 'sfo', version: '0.0.0', type: 'app',
    name: 'Secret field orphan-row fixture', description: 'A secret field beside a required field and a picklist.',
  },
  objects: [
    ObjectSchema.create({
      name: VAULT, label: 'Vault', pluralLabel: 'Vaults', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        tier: Field.select({ label: 'Tier', options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }] }),
        token: Field.secret({ label: 'Token' }),
      },
    }),
  ],
} as never);

type Answer = { status: number; json: any; text: string };

describe('[#27495] secret field: a sys_secret row only while a committed row names it — over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  /** Every credential row the store holds, read at the driver (no engine read path between). */
  const secretRows = async (): Promise<Array<Record<string, unknown>>> =>
    (await ql.getDriver('sys_secret').find('sys_secret', {})) ?? [];
  /** The ref the business row holds, as the driver stores it. */
  const storedRef = async (id: string) => {
    const [row] = await ql.getDriver(VAULT).find(VAULT, { where: { id } });
    return row?.token as string | null | undefined;
  };
  const create = async (name: string, value: string) => {
    const res = await call('POST', `/data/${VAULT}`, { name, tier: 'gold', token: value });
    expect(res.status, res.text).toBe(201);
    const [row] = await stack.rows(VAULT, { name });
    return String(row.id);
  };

  beforeAll(async () => {
    stack = await bootStack(sfoStack);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a create refused for a missing required field or an option outside the list writes no credential row', async () => {
    const before = (await secretRows()).length;
    const missing = await call('POST', `/data/${VAULT}`, { tier: 'gold', token: 'sfo-refused-1' });
    expect(missing.status, missing.text).toBe(400);
    expect(missing.json.code, missing.text).toBe('VALIDATION_FAILED');
    const bogus = await call('POST', `/data/${VAULT}`, { name: 'sfo-bogus', tier: 'bogus', token: 'sfo-refused-2' });
    expect(bogus.status, bogus.text).toBe(400);
    expect(bogus.json.code, bogus.text).toBe('VALIDATION_FAILED');
    expect(await stack.rows(VAULT, { name: 'sfo-bogus' })).toHaveLength(0);
    expect((await secretRows()).length).toBe(before);
  });

  it('an update refused for an option outside the list keeps the stored secret and writes no credential row', async () => {
    const id = await create('sfo-keep', 'sfo-kept-value');
    const ref = await storedRef(id);
    const before = (await secretRows()).length;
    const refused = await call('PATCH', `/data/${VAULT}/${id}`, { tier: 'bogus', token: 'sfo-refused-3' });
    expect(refused.status, refused.text).toBe(400);
    expect(refused.json.code, refused.text).toBe('VALIDATION_FAILED');
    expect((await secretRows()).length).toBe(before);
    expect(await storedRef(id)).toBe(ref);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sfo-kept-value');
  });

  it('a committed create stores the secret, masks it on read and dereferences it', async () => {
    const before = (await secretRows()).length;
    const id = await create('sfo-ok', 'sfo-stored-value');
    expect(String(await storedRef(id))).toMatch(/^secret:/);
    expect((await secretRows()).length).toBe(before + 1);
    const read = await call('GET', `/data/${VAULT}/${id}`);
    expect(read.status, read.text).toBe(200);
    expect((read.json.record ?? read.json).token).toBe(SECRET_MASK);
    expect(read.text).not.toContain('sfo-stored-value');
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sfo-stored-value');
  });

  it('clearing the field with null removes the credential row it named', async () => {
    const id = await create('sfo-clear', 'sfo-cleared-value');
    const handle = String(await storedRef(id)).slice('secret:'.length);
    expect((await secretRows()).some((r) => r.id === handle)).toBe(true);
    const cleared = await call('PATCH', `/data/${VAULT}/${id}`, { token: null });
    expect(cleared.status, cleared.text).toBe(200);
    expect(await storedRef(id) ?? null).toBeNull();
    expect((await secretRows()).some((r) => r.id === handle)).toBe(false);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBeNull();
  });

  it('replacing the value removes the old credential row and keeps the new one', async () => {
    const id = await create('sfo-replace', 'sfo-old-value');
    const oldHandle = String(await storedRef(id)).slice('secret:'.length);
    const before = (await secretRows()).length;
    const replaced = await call('PATCH', `/data/${VAULT}/${id}`, { token: 'sfo-new-value' });
    expect(replaced.status, replaced.text).toBe(200);
    const newHandle = String(await storedRef(id)).slice('secret:'.length);
    expect(newHandle).not.toBe(oldHandle);
    const after = await secretRows();
    expect(after.length).toBe(before);
    expect(after.some((r) => r.id === oldHandle)).toBe(false);
    expect(after.some((r) => r.id === newHandle)).toBe(true);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sfo-new-value');
  });
});
