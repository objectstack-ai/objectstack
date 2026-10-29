// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.encrypted-field-behavior` (#26573): the api
// clauses the field-zoo round-trip does not reach, pinned at the REST data
// door of a booted stack. `packages/objectql/src/secret-fields.test.ts` drives
// a real engine over a stub driver with no HTTP, so it is evidence of its own
// layer and never these clauses' pass (RUNNER rule 6).
//
//   acceptance[2], negative[2] — PATCHing `f_secret` back as SECRET_MASK is a
//     no-op: the stored ref is the same and it still decrypts to the original.
//   acceptance[4], negative[3] — a group-by or MIN/MAX over `f_secret` or
//     `f_password` through `POST /data/:object/query` is refused
//     (400 INVALID_FIELD), never a value distribution.
//   acceptance[3], negative[1] — with NO crypto provider, a non-empty secret
//     write is refused and nothing is persisted; a `password` write needs no
//     provider.
//   (ADR-0100, beside acceptance[4]) — the same credential columns as filter
//     and sort keys: refused 400 INVALID_FIELD for a signed-in caller, a
//     has-a-value check served; an `internal: true` column likewise at the
//     door. The seeded admin's sign-in in each `beforeAll` is the login leg.
//
// ## Two boots
//
// The showcase, as shipped, for the field zoo's `f_secret` (Field.secret) and
// `f_password` (Field.password, ackPlaintextMasking). `bootStack` wires one
// LocalCryptoProvider, as `objectstack dev` / `serve` do.
//
// A scratch object for the fail-closed half, on a stack whose engine is left
// with no provider. No stock composition boots that way (the item's
// fixtures.knownGaps[1]) and `bootStack` always wires one, so this boot unsets
// it once after bootstrap — `engine.setCryptoProvider(undefined)`, the same
// field the host's own wiring writes — before any request is made. That is the
// engine state of a boot that never wired one; the door it is driven through
// is the real REST data door.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SECRET_MASK } from '@objectstack/objectql';
import { bootShowcase } from './showcase-boot.js';

const ZOO = 'showcase_field_zoo';
const SECRET = 'topsecret-value';
const PASSWORD = 'p@ssw0rd!';

type Answer = { status: number; json: any; text: string };

describe('records-forms.encrypted-field-behavior — the showcase field zoo over REST', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';
  let projectId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  /** The business row as the driver holds it — the ref, never the plaintext (an engine read masks it). */
  const storedRef = async (id: string) => {
    const [row] = await ql.getDriver(ZOO).find(ZOO, { where: { id } });
    return row?.f_secret;
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const [project] = await stack.rows('showcase_project', {});
    projectId = String(project.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[2], negative[2]: an echoed mask leaves the stored secret unchanged', async () => {
    const created = await call('POST', `/data/${ZOO}`, { name: 'efb-mask', f_master_detail: projectId, f_secret: SECRET });
    expect(created.status, created.text).toBe(201);
    expect(created.text).not.toContain(SECRET);
    const [row] = await stack.rows(ZOO, { name: 'efb-mask' });
    const id = String(row.id);
    const before = await storedRef(id);
    expect(String(before)).toMatch(/^secret:/);
    expect(await ql.resolveSecretField(ZOO, id, 'f_secret')).toBe(SECRET);

    const patched = await call('PATCH', `/data/${ZOO}/${id}`, { name: 'efb-mask-renamed', f_secret: SECRET_MASK });
    expect(patched.status, patched.text).toBe(200);
    const read = await call('GET', `/data/${ZOO}/${id}`);
    expect(read.status, read.text).toBe(200);
    expect((read.json.record ?? read.json).f_secret).toBe(SECRET_MASK);
    expect(read.text).not.toContain(SECRET);

    expect(await storedRef(id)).toBe(before);
    expect(await ql.resolveSecretField(ZOO, id, 'f_secret')).toBe(SECRET);
    const [renamed] = await stack.rows(ZOO, { id });
    expect(renamed.name).toBe('efb-mask-renamed');
  });

  it('acceptance[4], negative[3]: a group-by or MIN/MAX over a credential column is refused, not answered', async () => {
    const created = await call('POST', `/data/${ZOO}`, {
      name: 'efb-agg', f_master_detail: projectId, f_secret: SECRET, f_password: PASSWORD,
    });
    expect(created.status, created.text).toBe(201);
    const queries: Array<[string, unknown]> = [
      ['group by f_secret', { groupBy: ['f_secret'], aggregations: [{ function: 'count', alias: 'n' }] }],
      ['group by f_password', { groupBy: ['f_password'], aggregations: [{ function: 'count', alias: 'n' }] }],
      ['max(f_secret)', { aggregations: [{ function: 'max', field: 'f_secret', alias: 'm' }] }],
      ['min(f_password)', { aggregations: [{ function: 'min', field: 'f_password', alias: 'm' }] }],
    ];
    for (const [label, body] of queries) {
      const res = await call('POST', `/data/${ZOO}/query`, body);
      expect(res.status, `${label}: ${res.text}`).toBe(400);
      expect(res.json.code, `${label}: ${res.text}`).toBe('INVALID_FIELD');
      expect(res.text, label).not.toContain(SECRET);
      expect(res.text, label).not.toContain(PASSWORD);
    }
    // Control: the same door answers a group-by that names no credential column.
    const control = await call('POST', `/data/${ZOO}/query`, { groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] });
    expect(control.status, control.text).toBe(200);
  });

  // ADR-0100, the filter / sort half of the credential-column guard: the
  // aggregate refusal above extended to filter and sort keys. A signed-in admin
  // is not a system context, so every one of these is refused before the
  // driver; a has-a-value check and every other column are served.
  it('a filter or sort key on a credential column is refused; a has-a-value check is served', async () => {
    const created = await call('POST', `/data/${ZOO}`, {
      name: 'efb-pred', f_master_detail: projectId, f_secret: SECRET, f_password: PASSWORD,
    });
    expect(created.status, created.text).toBe(201);

    const refused: Array<[string, string, string, unknown?]> = [
      ['where equality', 'POST', `/data/${ZOO}/query`, { where: { f_password: PASSWORD } }],
      ['where range', 'POST', `/data/${ZOO}/query`, { where: { f_password: { $gt: 'a' } } }],
      ['where $startsWith', 'POST', `/data/${ZOO}/query`, { where: { f_password: { $startsWith: 'p' } } }],
      ['where $contains', 'POST', `/data/${ZOO}/query`, { where: { f_password: { $contains: 's' } } }],
      ['where on the secret column', 'POST', `/data/${ZOO}/query`, { where: { f_secret: { $startsWith: 'secret:' } } }],
      ['orderBy the password column', 'POST', `/data/${ZOO}/query`, { orderBy: [{ field: 'f_password', order: 'asc' }] }],
      ['list filter param', 'GET', `/data/${ZOO}?filter=${encodeURIComponent(JSON.stringify(['f_password', '=', PASSWORD]))}`],
    ];
    for (const [label, method, path, body] of refused) {
      const res = await call(method, path, body);
      expect(res.status, `${label}: ${res.text}`).toBe(400);
      expect(res.json.code, `${label}: ${res.text}`).toBe('INVALID_FIELD');
      expect(res.text, label).not.toContain(PASSWORD);
      expect(res.text, label).not.toContain(SECRET);
    }

    const presence = await call('POST', `/data/${ZOO}/query`, { where: { name: 'efb-pred', f_password: { $null: false } } });
    expect(presence.status, presence.text).toBe(200);
    expect(presence.json.records.map((r: any) => r.name)).toEqual(['efb-pred']);
    expect(presence.text).not.toContain(PASSWORD);
    const unset = await call('POST', `/data/${ZOO}/query`, { where: { name: 'efb-pred', f_password: null } });
    expect(unset.status, unset.text).toBe(200);
    expect(unset.json.records).toHaveLength(0);

    const control = await call('POST', `/data/${ZOO}/query`, { where: { name: 'efb-pred' }, orderBy: [{ field: 'name', order: 'asc' }] });
    expect(control.status, control.text).toBe(200);
    expect(control.json.records).toHaveLength(1);
  });
});

// ── fail-closed: no crypto provider ──────────────────────────────────────

const VAULT = 'efb_vault';

const efbStack = defineStack({
  manifest: {
    id: 'com.dogfood.encrypted-field-behavior', namespace: 'efb', version: '0.0.0', type: 'app',
    name: 'Encrypted field fail-closed fixture', description: 'A secret and a password field on one object.',
  },
  objects: [
    ObjectSchema.create({
      name: VAULT, label: 'Vault', pluralLabel: 'Vaults', sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        token: Field.secret({ label: 'Token' }),
        pin: Field.password({ label: 'PIN', ackPlaintextMasking: true }),
        digest: Field.text({ label: 'Digest', internal: true }),
      },
    }),
  ],
} as never);

describe('records-forms.encrypted-field-behavior — fail-closed with no crypto provider', () => {
  let stack: VerifyStack;
  let token = '';

  beforeAll(async () => {
    stack = await bootStack(efbStack);
    const engine = (await stack.kernel.getServiceAsync('objectql')) as { setCryptoProvider(p: unknown): void };
    engine.setCryptoProvider(undefined);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[3], negative[1]: a non-empty secret write is refused and nothing is persisted', async () => {
    const res = await stack.apiAs(token, 'POST', `/data/${VAULT}`, { name: 'efb-closed', token: 'x-cleartext' });
    const text = await res.text();
    // The engine's fail-closed throw is a plain Error, so REST answers its sanitised
    // terminal branch: a refusal, with the message kept server-side.
    expect(res.status, text).toBe(500);
    expect(JSON.parse(text).code).toBe('INTERNAL_ERROR');
    expect(text).not.toContain('x-cleartext');
    expect(await stack.rows(VAULT, { name: 'efb-closed' })).toHaveLength(0);
    const list = await stack.apiAs(token, 'GET', `/data/${VAULT}`);
    expect(await list.text()).not.toContain('x-cleartext');
  });

  it('acceptance[3]: a password write needs no provider — stored, and masked on read', async () => {
    const res = await stack.apiAs(token, 'POST', `/data/${VAULT}`, { name: 'efb-pin', pin: '4242-pin' });
    expect(res.status, await res.clone().text()).toBe(201);
    const [row] = await stack.rows(VAULT, { name: 'efb-pin' });
    expect(row, 'the password write is stored').toBeTruthy();
    const read = await stack.apiAs(token, 'GET', `/data/${VAULT}/${row.id}`);
    const body: any = await read.json();
    expect((body.record ?? body).pin).toBe(SECRET_MASK);
  });

  it('a sort or filter key on a password or an `internal: true` column is refused at the REST door', async () => {
    const res = await stack.apiAs(token, 'POST', `/data/${VAULT}`, { name: 'efb-keys', pin: '7777-pin', digest: 'd-7777' });
    expect(res.status, await res.clone().text()).toBe(201);
    const bodies: Array<[string, unknown]> = [
      ['orderBy pin', { orderBy: [{ field: 'pin', order: 'desc' }] }],
      ['where pin', { where: { pin: { $startsWith: '7' } } }],
      ['orderBy digest', { orderBy: [{ field: 'digest', order: 'desc' }] }],
      ['where digest', { where: { digest: 'd-7777' } }],
    ];
    for (const [label, body] of bodies) {
      const answer = await stack.apiAs(token, 'POST', `/data/${VAULT}/query`, body);
      const text = await answer.text();
      expect(answer.status, `${label}: ${text}`).toBe(400);
      expect(JSON.parse(text).code, `${label}: ${text}`).toBe('INVALID_FIELD');
      expect(text, label).not.toContain('7777-pin');
      expect(text, label).not.toContain('d-7777');
    }
    // Control: the same door sorts and filters by a plain column.
    const control = await stack.apiAs(token, 'POST', `/data/${VAULT}/query`, {
      where: { name: 'efb-keys' }, orderBy: [{ field: 'name', order: 'asc' }],
    });
    expect(control.status, await control.clone().text()).toBe(200);
  });
});
