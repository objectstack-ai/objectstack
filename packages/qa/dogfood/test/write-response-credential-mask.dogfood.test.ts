// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every write door that answers with a record answers what a read of the same
// row would for its credential-class fields, on a real boot: a `password`
// field's stored value and a `secret` field's stored handle ref never appear
// in a write response — the value a set credential reads back as is the mask.
//
// ## The composition
//
// `bootStack` with its real engine, crypto provider, SQL driver, protocol and
// REST layers. One synthetic object holds one `password` field and one
// `secret` field; the writer is the seeded admin, writing through REST.
//
// ## Arming
//
// The scene is real before anything is believed: a privileged engine read of
// the stored row (an engine write result, which keeps the row whole by design)
// shows the plaintext password and a `secret:` handle ref at rest. Without it
// every "absent" below could be true because nothing was ever stored.
//
// Falsifiability: each door's response must carry the record's own `name`, so
// an empty or refused response cannot read as a pass.
//
// Fixtures are synthetic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, SECRET_MASK } from '@objectstack/spec/data';

const OBJ = 'wrcm_item';
const PW = 'wrcm_password';
const TOKEN = 'wrcm_token';
const PW_VALUE = 'wrcm-plain-credential-81';
const TOKEN_VALUE = 'wrcm-token-credential-82';
const SYS = { context: { isSystem: true } } as const;

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'WRCM Item',
  pluralLabel: 'WRCM Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [PW]: Field.password({ label: 'Password', ackPlaintextMasking: true }),
    [TOKEN]: Field.secret({ label: 'Token' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.write-response-credential-mask',
    namespace: 'wrcm',
    version: '0.0.0',
    type: 'app',
    name: 'Write Response Credential Mask Fixture',
    description: 'One object holding one password field and one secret field.',
  },
  objects: [Item],
});

type Row = Record<string, any>;

/** Every stored credential spelling no write response may carry. */
const leaksIn = (body: unknown): string[] => {
  const wire = JSON.stringify(body ?? null);
  return [PW_VALUE, TOKEN_VALUE, 'secret:'].filter((v) => wire.includes(v));
};

describe('write responses mask credential-class fields as reads do', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;

  const write = async (method: string, path: string, body: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json();
    return { status: res.status, json };
  };

  /** Create one row with both credentials set, through the engine (no response under test). */
  const seed = async (name: string): Promise<string> => {
    const row: Row = await ql.insert(OBJ, { name, [PW]: PW_VALUE, [TOKEN]: TOKEN_VALUE }, SYS);
    return String(row.id);
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {});
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('the scene is armed: the stored row holds the plaintext password and a secret handle ref', async () => {
    const id = await seed('wrcm-armed');
    const whole: Row = await ql.update(OBJ, { name: 'wrcm-armed' }, { where: { id }, ...SYS });
    expect(whole[PW]).toBe(PW_VALUE);
    expect(String(whole[TOKEN])).toMatch(/^secret:/);
    // …and the read path masks both, which is what every write door must match.
    const read = await stack.apiAs(token, 'GET', `/data/${OBJ}/${id}`);
    expect(read.status).toBe(200);
    const rec: Row = ((await read.json()) as any).record;
    expect(rec[PW]).toBe(SECRET_MASK);
    expect(rec[TOKEN]).toBe(SECRET_MASK);
  });

  it('single create', async () => {
    const res = await write('POST', `/data/${OBJ}`, { name: 'wrcm-create', [PW]: PW_VALUE, [TOKEN]: TOKEN_VALUE });
    expect(res.status).toBe(201);
    expect(leaksIn(res.json)).toEqual([]);
    expect(res.json.record.name).toBe('wrcm-create');
    expect(res.json.record[PW]).toBe(SECRET_MASK);
    expect(res.json.record[TOKEN]).toBe(SECRET_MASK);
  });

  it('single update', async () => {
    const id = await seed('wrcm-update');
    const res = await write('PATCH', `/data/${OBJ}/${id}`, { name: 'wrcm-update-2' });
    expect(res.status).toBe(200);
    expect(leaksIn(res.json)).toEqual([]);
    expect(JSON.stringify(res.json)).toContain('wrcm-update-2');
  });

  it('createMany', async () => {
    const res = await write('POST', `/data/${OBJ}/createMany`, [
      { name: 'wrcm-many-1', [PW]: PW_VALUE, [TOKEN]: TOKEN_VALUE },
      { name: 'wrcm-many-2', [PW]: PW_VALUE },
    ]);
    expect(res.status).toBeLessThan(300);
    expect(leaksIn(res.json)).toEqual([]);
    expect(JSON.stringify(res.json)).toContain('wrcm-many-1');
  });

  it('updateMany', async () => {
    const id = await seed('wrcm-umany');
    const res = await write('POST', `/data/${OBJ}/updateMany`, { records: [{ id, data: { name: 'wrcm-umany-2' } }] });
    expect(res.status).toBeLessThan(300);
    expect(leaksIn(res.json)).toEqual([]);
    expect(JSON.stringify(res.json)).toContain('wrcm-umany-2');
  });

  it('per-object batch, create and update arms', async () => {
    const id = await seed('wrcm-batch');
    const created = await write('POST', `/data/${OBJ}/batch`, {
      operation: 'create', records: [{ data: { name: 'wrcm-batch-c', [PW]: PW_VALUE } }], options: {},
    });
    expect(created.status).toBeLessThan(300);
    expect(leaksIn(created.json)).toEqual([]);
    expect(JSON.stringify(created.json)).toContain('wrcm-batch-c');
    const updated = await write('POST', `/data/${OBJ}/batch`, {
      operation: 'update', records: [{ id, data: { name: 'wrcm-batch-u' } }], options: {},
    });
    expect(updated.status).toBeLessThan(300);
    expect(leaksIn(updated.json)).toEqual([]);
    expect(JSON.stringify(updated.json)).toContain('wrcm-batch-u');
  });

  it('cross-object batch, create and update arms', async () => {
    const id = await seed('wrcm-xbatch');
    const res = await write('POST', '/batch', {
      operations: [
        { object: OBJ, action: 'create', data: { name: 'wrcm-xbatch-c', [PW]: PW_VALUE, [TOKEN]: TOKEN_VALUE } },
        { object: OBJ, action: 'update', id, data: { name: 'wrcm-xbatch-u' } },
      ],
    });
    expect(res.status).toBeLessThan(300);
    expect(leaksIn(res.json)).toEqual([]);
    expect(JSON.stringify(res.json)).toContain('wrcm-xbatch-c');
    expect(JSON.stringify(res.json)).toContain('wrcm-xbatch-u');
  });

  it('a masked echo round-trips without overwriting the stored credentials', async () => {
    const id = await seed('wrcm-echo');
    const res = await write('PATCH', `/data/${OBJ}/${id}`, { name: 'wrcm-echo-2', [PW]: SECRET_MASK, [TOKEN]: SECRET_MASK });
    expect(res.status).toBe(200);
    expect(leaksIn(res.json)).toEqual([]);
    const whole: Row = await ql.update(OBJ, { name: 'wrcm-echo-2' }, { where: { id }, ...SYS });
    expect(whole[PW]).toBe(PW_VALUE);
    expect(String(whole[TOKEN])).toMatch(/^secret:/);
  });
});
