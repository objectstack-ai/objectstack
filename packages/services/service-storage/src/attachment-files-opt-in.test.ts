// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from '@objectstack/plugin-audit';
import type { EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import { installAttachmentFilesOptInGate } from './attachment-files-opt-in.js';

type Handler = (ctx: unknown) => unknown;

function engineWith(definitions: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const hooks: Array<{ event: string; fn: Handler; opts: any }> = [];
  const engine = {
    registerHook: (event: string, fn: Handler, opts: any) => {
      hooks.push({ event, fn, opts });
    },
    getSchema: (name: string) => definitions[name],
    ...extra,
  };
  return { engine, hooks };
}

const write = (data: Record<string, unknown>, session?: Record<string, unknown>) => ({ input: { data }, session });

describe('installAttachmentFilesOptInGate: the per-object attachment opt-in, enforced by the storage service', () => {
  it('installs on sys_attachment insert and update, under the storage package, and says so', () => {
    const { engine, hooks } = engineWith({});
    expect(installAttachmentFilesOptInGate(engine)).toBe(true);
    expect(hooks.map((h) => [h.event, h.opts])).toEqual([
      ['beforeInsert', { object: 'sys_attachment', packageId: 'com.objectstack.service.storage' }],
      ['beforeUpdate', { object: 'sys_attachment', packageId: 'com.objectstack.service.storage' }],
    ]);
  });

  it('an engine without the hook seam: not installed, and says so', () => {
    expect(installAttachmentFilesOptInGate({} as never)).toBe(false);
  });

  it('an engine that refuses the registration: not installed, and says so', () => {
    const engine = {
      registerHook: () => {
        throw new Error('no hooks today');
      },
    };
    expect(installAttachmentFilesOptInGate(engine)).toBe(false);
  });

  const DEFINITIONS = {
    opted: { name: 'opted', enable: { files: true } },
    off: { name: 'off', enable: { files: false } },
    silent: { name: 'silent', enable: {} },
    bare: { name: 'bare' },
  };

  it.each([
    ['declares files: false', 'off'],
    ['declares an enable block without files', 'silent'],
    ['declares no enable block', 'bare'],
    ['is not registered', 'nowhere'],
  ])('refuses an attachment onto an object that %s (403 FILES_DISABLED), on insert and on re-point alike', async (_why, parent) => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ parent_object: parent, parent_id: 'r1' }))).rejects.toMatchObject({
        code: 'FILES_DISABLED',
        status: 403,
        object: parent,
      });
    }
  });

  it('admits an attachment onto an object that declares files: true', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ parent_object: 'opted', parent_id: 'r1' }))).resolves.toBeUndefined();
    }
  });

  it('the system context is not exempt: the opt-in is a statement about the object, not the caller', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    await expect(hooks[0].fn(write({ parent_object: 'bare', parent_id: 'r1' }, { isSystem: true }))).rejects.toMatchObject({
      code: 'FILES_DISABLED',
    });
  });

  it('a write naming no parent object has nothing to ask: left to validation on insert, not a re-point on update', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ title: 'renamed' }))).resolves.toBeUndefined();
      await expect(fn(write({ parent_object: '' }))).resolves.toBeUndefined();
      await expect(fn({})).resolves.toBeUndefined();
    }
  });

  it('a definition that cannot be read refuses: no schema lookup, or one that throws', async () => {
    const hooks: Handler[] = [];
    installAttachmentFilesOptInGate({
      registerHook: (_event: string, fn: Handler) => {
        hooks.push(fn);
      },
    });
    await expect(hooks[0](write({ parent_object: 'opted' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });

    const throwing = engineWith({}, {
      getSchema: () => {
        throw new Error('registry offline');
      },
    });
    installAttachmentFilesOptInGate(throwing.engine);
    await expect(throwing.hooks[0].fn(write({ parent_object: 'opted' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });
  });

  it('reads the live definition on every write: an object switched to files: true is attachable on the next write', async () => {
    const definitions: Record<string, unknown> = { later: { name: 'later', enable: { files: false } } };
    const { engine, hooks } = engineWith(definitions);
    installAttachmentFilesOptInGate(engine);
    await expect(hooks[0].fn(write({ parent_object: 'later' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });
    definitions.later = { name: 'later', enable: { files: true } };
    await expect(hooks[0].fn(write({ parent_object: 'later' }))).resolves.toBeUndefined();
  });
});

/*
 * The one enforcer, on a REAL engine, with and without the audit capability.
 *
 * The storage service is the only package that enforces `enable.files` (ruling
 * on #32754, route A). These run the gate on a real `ObjectQL` (a stub driver
 * underneath), so the engine's own dispatch decides which hooks a write
 * crosses: the insert, the by-id update (`dispatch.mode` "record"), the
 * predicate update and the unscoped multi update (the per-row fan-out, which
 * hands every matched row the same payload). Each case runs in two
 * compositions: the storage gate alone, and the storage gate beside the audit
 * capability's writers as `AuditPlugin` installs them. The answer is the same
 * in both, because the audit capability judges nothing here; with the storage
 * gate's body removed, both compositions admit every refused write below (the
 * ablation the PR records).
 *
 * Every refusal asserts the ADR-0112 pair, `code` and `status`, and re-reads
 * the stored rows; every refusal is paired with the same write onto an object
 * that has opted in, which succeeds.
 */

const textField = (name: string) => ({ name, label: name, type: 'text' as const, ...(name === 'id' ? { primaryKey: true } : {}) });
const fieldsOf = (...names: string[]) => Object.fromEntries(names.map((n) => [n, textField(n)]));

/** Just enough storage for the write paths under test; `updateMany` takes the compiled AST, as the engine calls it. */
function stubDriver(): any {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string): Map<string, Record<string, unknown>> => {
    let s = stores.get(o);
    if (!s) stores.set(o, (s = new Map()));
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean =>
    !where || typeof where !== 'object'
      ? true
      : Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) return true;
          const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
          return (row[k] ?? null) === (expected ?? null);
        });
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      return Array.from(storeFor(o).values()).find((r) => matches(r, ast?.where)) ?? null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const cur = storeFor(o).get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      storeFor(o).set(id, next);
      return next;
    },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      let n = 0;
      for (const [id, row] of storeFor(o)) {
        if (!matches(row, ast?.where)) continue;
        storeFor(o).set(id, { ...row, ...data, id });
        n += 1;
      }
      return n;
    },
    async delete() {
      return true;
    },
    async count(o: string, ast: any) {
      return (await driver.find(o, ast)).length;
    },
    async aggregate() {
      return [];
    },
  };
  return driver;
}

const REFUSED = { code: 'FILES_DISABLED', status: 403 };

async function realEngine(withAuditCapability: boolean): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(stubDriver(), true);
  await engine.init();
  const reg = engine.registry;
  reg.registerObject({ name: 'lead_open', label: 'Opted in', fields: fieldsOf('id', 'name'), enable: { files: true } } as any, 'test.opt-in');
  reg.registerObject({ name: 'lead_off', label: 'Opted out', fields: fieldsOf('id', 'name'), enable: { files: false } } as any, 'test.opt-in');
  reg.registerObject({ name: 'lead_bare', label: 'Silent', fields: fieldsOf('id', 'name') } as any, 'test.opt-in');
  // A stand-in under the real name: the gate reads `parent_object` only.
  reg.registerObject(
    { name: 'sys_attachment', label: 'Attachment', fields: fieldsOf('id', 'parent_object', 'parent_id', 'file_id', 'file_name') } as any,
    'test.opt-in',
  );
  expect(installAttachmentFilesOptInGate(engine as any)).toBe(true);
  if (withAuditCapability) {
    // The audit sinks, registered so the writers' own writes land somewhere
    // real rather than being swallowed, then the writers as AuditPlugin installs them.
    reg.registerObject(
      {
        name: 'sys_audit_log',
        label: 'Audit Log',
        fields: fieldsOf('id', 'action', 'user_id', 'actor', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id'),
      } as any,
      'test.opt-in',
    );
    reg.registerObject(
      {
        name: 'sys_activity',
        label: 'Activity',
        fields: fieldsOf('id', 'type', 'timestamp', 'summary', 'actor_id', 'object_name', 'record_id', 'record_label', 'metadata'),
      } as any,
      'test.opt-in',
    );
    expect(installAuditWriters(engine as any, 'test.audit')).toBeDefined();
  }
  return engine;
}

const refusalOf = async (write: Promise<unknown>): Promise<unknown> => {
  try {
    await write;
  } catch (err: any) {
    return { code: err?.code, status: err?.status, object: err?.object };
  }
  return 'admitted';
};

const attachments = async (engine: ObjectQL) =>
  (await engine.find('sys_attachment', { where: {} } satisfies EngineQueryOptions)) as Array<Record<string, any>>;

const seed = async (engine: ObjectQL) =>
  (await engine.insert('sys_attachment', { parent_object: 'lead_open', parent_id: 'rec-1', file_id: 'file-1' } as any)) as any;

describe.each([
  ['the storage service alone, no audit capability', false],
  ['the storage service beside the audit capability', true],
])('the opt-in has one enforcer on a real engine: %s', (_composition, withAuditCapability) => {
  it('an insert onto an object that has not opted in is refused and keeps nothing; onto one that has, it lands', async () => {
    const engine = await realEngine(withAuditCapability);
    for (const parent of ['lead_off', 'lead_bare', 'lead_unregistered']) {
      expect(
        await refusalOf(engine.insert('sys_attachment', { parent_object: parent, parent_id: 'rec-1', file_id: 'file-1' } as any)),
      ).toEqual({ ...REFUSED, object: parent });
    }
    expect(await attachments(engine)).toEqual([]);
    expect(await refusalOf(seed(engine))).toBe('admitted');
    expect((await attachments(engine)).map((r) => r.parent_object)).toEqual(['lead_open']);
  });

  it('a by-id re-point onto an object that has not opted in is refused and the row keeps its parent; onto one that has, it lands', async () => {
    const engine = await realEngine(withAuditCapability);
    const row = await seed(engine);
    const byId = { where: { id: String(row.id) } } satisfies EngineUpdateOptions;
    expect(await refusalOf(engine.update('sys_attachment', { parent_object: 'lead_off' } as any, byId))).toEqual({
      ...REFUSED,
      object: 'lead_off',
    });
    expect((await attachments(engine)).map((r) => r.parent_object)).toEqual(['lead_open']);
    expect(
      await refusalOf(engine.update('sys_attachment', { parent_object: 'lead_open', parent_id: 'rec-2' } as any, byId)),
    ).toBe('admitted');
    expect((await attachments(engine)).map((r) => r.parent_id)).toEqual(['rec-2']);
  });

  it('a predicate re-point and an unscoped multi re-point are refused on the first matched row, and no row moves', async () => {
    const engine = await realEngine(withAuditCapability);
    await seed(engine);
    await seed(engine);
    const shapes: EngineUpdateOptions[] = [{ multi: true, where: { file_id: 'file-1' } }, { multi: true }];
    for (const options of shapes) {
      expect(await refusalOf(engine.update('sys_attachment', { parent_object: 'lead_bare' } as any, options))).toEqual({
        ...REFUSED,
        object: 'lead_bare',
      });
    }
    expect((await attachments(engine)).map((r) => r.parent_object)).toEqual(['lead_open', 'lead_open']);
  });

  it('an update that names no parent object is not a re-point and is not asked', async () => {
    const engine = await realEngine(withAuditCapability);
    const row = await seed(engine);
    expect(
      await refusalOf(engine.update('sys_attachment', { file_name: 'renamed.pdf' } as any, { where: { id: String(row.id) } })),
    ).toBe('admitted');
    expect(
      await refusalOf(engine.update('sys_attachment', { file_name: 'bulk.pdf' } as any, { multi: true, where: { file_id: 'file-1' } })),
    ).toBe('admitted');
  });
});
