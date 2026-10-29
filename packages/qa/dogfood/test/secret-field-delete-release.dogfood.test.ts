// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27581] Deleting a record releases the `sys_secret` row its `secret` field
// named — pinned at the REST data door of a booted stack, on a provider-wired
// boot (`bootStack` wires one LocalCryptoProvider, as `objectstack dev` /
// `serve` do), counting the credential rows at the driver.
// `packages/objectql/src/secret-field-write-commit.test.ts` drives each delete
// path at the engine; this file holds the halves a client can reach:
//
//  - `DELETE /data/:object/:id` and the bulk `deleteMany` door remove the
//    credential row each deleted record named, and no other;
//  - a handle another record still names is kept until the last one goes;
//  - an atomic `deleteMany` that rolls back keeps the record and its row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const VAULT = 'sfd_vault';

const sfdStack = defineStack({
  manifest: {
    id: 'com.dogfood.secret-field-delete-release', namespace: 'sfd', version: '0.0.0', type: 'app',
    name: 'Secret field delete-release fixture', description: 'A secret field on a record that gets deleted.',
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

describe('[#27581] secret field: deleting a record releases its sys_secret row — over REST', () => {
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
  /** The ids of every credential row the store holds, read at the driver (no engine read path between). */
  const secretIds = async (): Promise<string[]> =>
    (((await ql.getDriver('sys_secret').find('sys_secret', {})) ?? []) as Array<{ id: string }>).map((r) => String(r.id));
  /** The handle the business row holds, as the driver stores it. */
  const handleOf = async (id: string): Promise<string> => {
    const [row] = await ql.getDriver(VAULT).find(VAULT, { where: { id } });
    return String(row?.token ?? '').slice('secret:'.length);
  };
  const create = async (name: string, value: string, tier = 'gold') => {
    const res = await call('POST', `/data/${VAULT}`, { name, tier, token: value });
    expect(res.status, res.text).toBe(201);
    const [row] = await stack.rows(VAULT, { name });
    return String(row.id);
  };

  beforeAll(async () => {
    stack = await bootStack(sfdStack);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('DELETE by id removes the credential row the record named, and no other', async () => {
    const gone = await create('sfd-gone', 'sfd-gone-value');
    const kept = await create('sfd-kept', 'sfd-kept-value');
    const goneHandle = await handleOf(gone);
    const keptHandle = await handleOf(kept);
    expect(await secretIds()).toEqual(expect.arrayContaining([goneHandle, keptHandle]));
    const before = (await secretIds()).length;

    const res = await call('DELETE', `/data/${VAULT}/${gone}`);
    expect(res.status, res.text).toBe(200);
    expect(await stack.rows(VAULT, { name: 'sfd-gone' })).toHaveLength(0);
    const after = await secretIds();
    expect(after).not.toContain(goneHandle);
    expect(after).toContain(keptHandle);
    expect(after.length).toBe(before - 1);
    expect(await ql.resolveSecretField(VAULT, kept, 'token')).toBe('sfd-kept-value');
  });

  it('the bulk deleteMany door removes the credential row of every record it deletes', async () => {
    const a = await create('sfd-many-a', 'sfd-many-a-value');
    const b = await create('sfd-many-b', 'sfd-many-b-value');
    const handles = [await handleOf(a), await handleOf(b)];
    const before = (await secretIds()).length;

    const res = await call('POST', `/data/${VAULT}/deleteMany`, { ids: [a, b] });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ succeeded: 2, failed: 0 });
    const after = await secretIds();
    for (const h of handles) expect(after).not.toContain(h);
    expect(after.length).toBe(before - 2);
  });

  it('a handle another record still names is kept until the last record that names it is deleted', async () => {
    const a = await create('sfd-shared-a', 'sfd-shared-a-value', 'silver');
    const b = await create('sfd-shared-b', 'sfd-shared-b-value', 'silver');
    // One predicate write seals ONE handle for every row it matches.
    await ql.update(VAULT, { token: 'sfd-shared-value' }, { where: { tier: 'silver' }, multi: true, context: { isSystem: true } });
    const shared = await handleOf(a);
    expect(await handleOf(b)).toBe(shared);
    expect(await secretIds()).toContain(shared);

    const first = await call('DELETE', `/data/${VAULT}/${a}`);
    expect(first.status, first.text).toBe(200);
    expect(await secretIds()).toContain(shared);
    expect(await ql.resolveSecretField(VAULT, b, 'token')).toBe('sfd-shared-value');

    const last = await call('DELETE', `/data/${VAULT}/${b}`);
    expect(last.status, last.text).toBe(200);
    expect(await secretIds()).not.toContain(shared);
  });

  it('an atomic deleteMany that rolls back keeps the record and its credential row', async () => {
    const id = await create('sfd-rollback', 'sfd-rollback-value');
    const handle = await handleOf(id);
    const before = await secretIds();

    // The second id names no record, so the batch rolls the first delete back.
    const res = await call('POST', `/data/${VAULT}/deleteMany`, { ids: [id, 'sfd-no-such-record'], options: { atomic: true } });
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ success: false, succeeded: 0 });
    expect(res.json.results.map((r: any) => [r.id, r.success, r.errors?.[0]?.code])).toEqual([
      [id, false, 'ROLLED_BACK'],
      ['sfd-no-such-record', false, 'RECORD_NOT_FOUND'],
    ]);
    expect(await stack.rows(VAULT, { name: 'sfd-rollback' })).toHaveLength(1);
    expect(await secretIds()).toEqual(before);
    expect(await secretIds()).toContain(handle);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sfd-rollback-value');
  });
});
