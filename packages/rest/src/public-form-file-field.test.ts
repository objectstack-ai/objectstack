// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25572, ruling C] An anonymous public-form submission carries no file.
 *
 * `POST /forms/:slug/submit` refuses a value in a field whose declared type is
 * a file type (`FILE_REFERENCE_TYPES`), naming the field, before anything is
 * written. An empty or absent file field submits as before. A file is provided
 * by a signed-in caller through the authenticated upload doors; a guest-facing
 * form that declares a file field is refused at publish (the protocol half),
 * and this door judges the forms published before that refusal existed.
 *
 * Through the real route — `RestServer` → `ObjectStackProtocolImplementation`
 * → `ObjectQL` → `SqlDriver` (sqlite in memory). Only the metadata read is
 * stubbed, to serve the form and the object the route resolves.
 *
 * Pinned, by class:
 *   - a value in a declared file field, in any shape, is refused: `400`, the
 *     flat `VALIDATION_FAILED` envelope naming the field with the ADR-0114
 *     field code `invalid_value`, the write never attempted and no row stored;
 *   - a multi-valued file field, and two file fields at once (one refusal, the
 *     form's order);
 *   - one envelope with the form's `required` judgement: both are told at once;
 *   - control: an empty or absent file field submits, `201`, the row stored;
 *   - the boundary: a file field the form does not declare is judged by the
 *     door's allow-list as before (dropped, never refused), so the refusal
 *     names nothing the form does not publish.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'pf_file_supplier_25572';
const SLUG = 'pf-file-25572';
const SYS = { context: { isSystem: true } };

const SUPPLIER = {
  name: OBJECT,
  label: 'Supplier',
  fields: {
    name: { name: 'name', type: 'text' as const, label: 'Supplier Name', required: true },
    email: { name: 'email', type: 'email' as const, label: 'Email' },
    licence: { name: 'licence', type: 'file' as const, label: 'Business Licence' },
    photos: { name: 'photos', type: 'image' as const, label: 'Site Photos', multiple: true },
    note: { name: 'note', type: 'text' as const, label: 'Note' },
    // Declared on the object, NOT on the form.
    internal_scan: { name: 'internal_scan', type: 'file' as const, label: 'Internal Scan' },
  },
};

const FORM = {
  name: 'pf_file_supplier_form',
  object: OBJECT,
  viewKind: 'form',
  config: {
    type: 'simple',
    data: { provider: 'object', object: OBJECT },
    sections: [
      {
        name: 'supplier',
        fields: [
          { field: 'name' },
          { field: 'email', required: true },
          { field: 'licence' },
          { field: 'photos' },
          { field: 'note' },
        ],
      },
    ],
    sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
  },
};

const COMPLETE = { name: 'Acme Parts', email: 'ops@acme.test', note: 'first contact' };

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    header: () => res,
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: unknown) => { res._json = body; return res; },
  };
  return res;
}

interface Answer { status: number; body: any }

describe('[#25572] POST /forms/:slug/submit: an anonymous submission carries no file', () => {
  let engine: ObjectQL;
  let createData: ReturnType<typeof vi.fn>;
  let post: (body: Record<string, unknown>) => Promise<Answer>;
  const rows = async (): Promise<Array<Record<string, any>>> => (await engine.find(OBJECT, {}, SYS)) as any;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SUPPLIER as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);
    const realGetMetaItems = protocol.getMetaItems.bind(protocol);
    protocol.getMetaItems = async (request: any) => {
      if (request?.type === 'view') return [FORM];
      if (request?.type === 'object') return [SUPPLIER];
      return realGetMetaItems(request);
    };
    const realCreateData = protocol.createData.bind(protocol);
    createData = vi.fn(realCreateData);
    protocol.createData = createData;
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const submit = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/forms/:slug/submit');
    expect(submit, 'the submit route is registered').toBeDefined();
    post = async (body) => {
      const res = makeRes();
      await submit!.handler({ params: { slug: SLUG }, body: JSON.parse(JSON.stringify(body)) } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  }, 60_000);

  afterAll(async () => {
    await engine?.destroy().catch(() => {});
  });

  /** A refusal naming exactly `expected` (field, code) in order, the write never attempted, no row stored. */
  const expectRefused = async (body: Record<string, unknown>, expected: Array<[string, string, string]>) => {
    const before = (await rows()).length;
    const calls = createData.mock.calls.length;
    const answer = await post(body);
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect(answer.body.fields.map((f: any) => [f.field, f.code, f.label])).toEqual(expected);
    for (const f of answer.body.fields) expect(f.message).toContain(f.label);
    expect(createData.mock.calls.length, 'the write is never attempted').toBe(calls);
    expect((await rows()).length, 'a refused submit stores no row').toBe(before);
    return answer;
  };

  it.each([
    ['a file id', '3f2a9c1e-7b4d-4e1a-9c2f-0d1e2f3a4b5c'],
    ['an external URL', 'https://files.example.test/licence.pdf'],
    ['an inline file value', { url: 'https://files.example.test/licence.pdf', name: 'licence.pdf' }],
  ])('an anonymous submission refuses a value in a file field (%s), naming the field', async (_shape, value) => {
    await expectRefused({ ...COMPLETE, licence: value }, [['licence', 'invalid_value', 'Business Licence']]);
  }, 60_000);

  it('a multi-valued file field carrying a value is refused, naming it', async () => {
    await expectRefused({ ...COMPLETE, photos: ['8d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'] }, [['photos', 'invalid_value', 'Site Photos']]);
  }, 60_000);

  it('two file fields carrying values → one refusal naming both, in the form\'s order', async () => {
    await expectRefused(
      { ...COMPLETE, photos: ['8d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'], licence: '3f2a9c1e-7b4d-4e1a-9c2f-0d1e2f3a4b5c' },
      [['licence', 'invalid_value', 'Business Licence'], ['photos', 'invalid_value', 'Site Photos']],
    );
  }, 60_000);

  it('one envelope with the form\'s `required`: a missing required field and a file value are told at once', async () => {
    const { email: _omitted, ...withoutEmail } = COMPLETE;
    await expectRefused(
      { ...withoutEmail, licence: '3f2a9c1e-7b4d-4e1a-9c2f-0d1e2f3a4b5c' },
      [['email', 'required', 'Email'], ['licence', 'invalid_value', 'Business Licence']],
    );
  }, 60_000);

  it.each([
    ['absent', {}],
    ['null', { licence: null, photos: null }],
    ["''", { licence: '', photos: '' }],
    ['[] on the multi-valued field', { photos: [] }],
  ])('CONTROL — an empty or absent file field submits (%s) → 201, the row stored', async (_cell, extra) => {
    const before = (await rows()).length;
    const answer = await post({ ...COMPLETE, ...extra });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    expect(typeof answer.body.id).toBe('string');
    const all = await rows();
    expect(all.length).toBe(before + 1);
    const stored = all.find((r) => r.id === answer.body.id);
    expect(stored?.name).toBe(COMPLETE.name);
    expect([null, undefined, '']).toContain(stored?.licence);
  }, 60_000);

  it('BOUNDARY — a file field the form does not declare is dropped by the allow-list as before, never refused', async () => {
    const answer = await post({ ...COMPLETE, internal_scan: '3f2a9c1e-7b4d-4e1a-9c2f-0d1e2f3a4b5c' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    const stored = (await rows()).find((r) => r.id === answer.body.id);
    expect(stored?.internal_scan ?? null).toBeNull();
  }, 60_000);
});
