// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27582] A non-system write may only seal a new value or keep its own
// record's ref — pinned at the REST data door of a booted stack with a crypto
// provider wired (`bootStack` wires one LocalCryptoProvider, as
// `objectstack dev` / `serve` do). Every HTTP request is assembled as a
// non-system caller. `packages/objectql/src/secret-field-own-ref-write.test.ts`
// drives each engine write door; this file holds the same rule through the
// doors a client writes through:
//
//  - a create whose `secret` field holds a ref is refused (`VALIDATION_ERROR` /
//    400), on the single-record door, the bulk door and the import door;
//  - an update that keeps the record's own value is accepted and changes
//    nothing — the read mask the form echoes, and the record's own ref;
//  - an update naming any other ref is refused with one answer, whatever that
//    ref names, and the stored value stays;
//  - the system principal keeps the pass-through.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SECRET_MASK } from '@objectstack/objectql';

const VAULT = 'sor_vault';

const sorStack = defineStack({
  manifest: {
    id: 'com.dogfood.secret-field-own-ref-write', namespace: 'sor', version: '0.0.0', type: 'app',
    name: 'Secret field own-ref fixture', description: 'A secret field beside a name.',
  },
  objects: [
    ObjectSchema.create({
      name: VAULT, label: 'Vault', pluralLabel: 'Vaults', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        token: Field.secret({ label: 'Token' }),
      },
    }),
  ],
} as never);

type Answer = { status: number; json: any; text: string };

describe('[#27582] secret field: a non-system write may only seal a new value or keep its own record\'s ref — over REST', () => {
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
  /** The value the business row holds, as the driver stores it. */
  const storedRef = async (id: string) => {
    const [row] = await ql.getDriver(VAULT).find(VAULT, { where: { id } });
    return row?.token as string | null | undefined;
  };
  const secretRowCount = async () => ((await ql.getDriver('sys_secret').find('sys_secret', {})) ?? []).length;
  const create = async (name: string, value: string) => {
    const res = await call('POST', `/data/${VAULT}`, { name, token: value });
    expect(res.status, res.text).toBe(201);
    const [row] = await stack.rows(VAULT, { name });
    return String(row.id);
  };
  /** The parts of a refusal a client can branch on or read. */
  const answerOf = (a: Answer) => ({ status: a.status, code: a.json.code, error: a.json.error, message: a.json.message });

  let otherId = '';
  let otherRef = '';
  const unknownRef = 'secret:sor_handle_names_no_row';

  beforeAll(async () => {
    stack = await bootStack(sorStack);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    otherId = await create('sor-other', 'sor-other-value');
    otherRef = String(await storedRef(otherId));
    expect(otherRef).toMatch(/^secret:/);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a create whose secret field holds a ref is refused before anything is written', async () => {
    const before = await secretRowCount();
    const refused = await call('POST', `/data/${VAULT}`, { name: 'sor-create', token: otherRef });
    expect(refused.status, refused.text).toBe(400);
    expect(refused.json.code, refused.text).toBe('VALIDATION_ERROR');
    expect(refused.text).not.toContain(otherRef);
    expect(await stack.rows(VAULT, { name: 'sor-create' })).toHaveLength(0);
    expect(await secretRowCount()).toBe(before);
  });

  it('the bulk create door and the import door refuse that row too', async () => {
    const bulk = await call('POST', `/data/${VAULT}/createMany`, [{ name: 'sor-bulk', token: otherRef }]);
    expect(bulk.status, bulk.text).toBe(400);
    expect(bulk.json.code, bulk.text).toBe('VALIDATION_ERROR');
    expect(await stack.rows(VAULT, { name: 'sor-bulk' })).toHaveLength(0);

    const imported = await call('POST', `/data/${VAULT}/import`, { format: 'json', rows: [{ name: 'sor-import', token: otherRef }] });
    expect(imported.status, imported.text).toBe(200);
    expect(imported.json.created, imported.text).toBe(0);
    expect(imported.json.errors, imported.text).toBe(1);
    expect(await stack.rows(VAULT, { name: 'sor-import' })).toHaveLength(0);
  });

  it('an update that echoes the read mask, or the record\'s own ref, is accepted and changes nothing', async () => {
    const id = await create('sor-own', 'sor-own-value');
    const own = String(await storedRef(id));
    const before = await secretRowCount();

    const read = await call('GET', `/data/${VAULT}/${id}`);
    const echoed = (read.json.record ?? read.json).token;
    expect(echoed).toBe(SECRET_MASK);
    const masked = await call('PATCH', `/data/${VAULT}/${id}`, { name: 'sor-own-renamed', token: echoed });
    expect(masked.status, masked.text).toBe(200);

    const kept = await call('PATCH', `/data/${VAULT}/${id}`, { name: 'sor-own-again', token: own });
    expect(kept.status, kept.text).toBe(200);

    expect(await storedRef(id)).toBe(own);
    expect(await secretRowCount()).toBe(before);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sor-own-value');
    expect((await stack.rows(VAULT, { id }))[0].name).toBe('sor-own-again');
  });

  it('an update naming any other ref is refused with one answer, and the stored value stays', async () => {
    const id = await create('sor-keep', 'sor-keep-value');
    const own = String(await storedRef(id));
    const before = await secretRowCount();

    const named = await call('PATCH', `/data/${VAULT}/${id}`, { name: 'sor-keep-renamed', token: otherRef });
    expect(named.status, named.text).toBe(400);
    expect(named.json.code, named.text).toBe('VALIDATION_ERROR');
    expect(named.text).not.toContain(otherRef);

    const unknown = await call('PATCH', `/data/${VAULT}/${id}`, { name: 'sor-keep-renamed', token: unknownRef });
    expect(answerOf(unknown)).toEqual(answerOf(named));

    expect(await storedRef(id)).toBe(own);
    expect(await secretRowCount()).toBe(before);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sor-keep-value');
    expect((await stack.rows(VAULT, { id }))[0].name).toBe('sor-keep');
  });

  it('a new value still seals, and the system principal keeps the pass-through', async () => {
    const id = await create('sor-new', 'sor-first');
    const replaced = await call('PATCH', `/data/${VAULT}/${id}`, { token: 'sor-second' });
    expect(replaced.status, replaced.text).toBe(200);
    expect(await ql.resolveSecretField(VAULT, id, 'token')).toBe('sor-second');

    const copy = await ql.insert(VAULT, { name: 'sor-system-copy', token: otherRef }, { context: { isSystem: true } });
    expect(await storedRef(String(copy.id))).toBe(otherRef);
    await ql.update(VAULT, { id: String(copy.id), token: null }, { context: { isSystem: true } });
    expect(await ql.resolveSecretField(VAULT, otherId, 'token')).toBe('sor-other-value');
  });
});
