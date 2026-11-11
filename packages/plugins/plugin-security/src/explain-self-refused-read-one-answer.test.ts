// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A principal explaining its own access, whose read of the object is refused,
// gets the same explanation for every record id: the answer an id no row
// carries gets, with the refusal of the read named as the decider.
//
// ## The rule
//
// Ruling of record 6787890900. A caller whose read of an object is refused
// gets the same explanation for every record id. That explanation names the
// read refusal and the layer that refused, as its decider, and never tells a
// stored record from a missing one. A third-party asker keeps ruling A of the
// explain-asker decision unchanged: the missing-record answer, no decider.
//
// "Refused" is the caller's own by-id read answering a declared 4xx, the
// classification the write doors ask (`readUnlessRefused`). The decider is a
// read-operation pass's own: the layer the read stops at.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), and two `public_read_write` objects, each with
// one stored row:
//
//   - `create`: a principal whose grant on the board is create alone, so its
//     read stops at the object grant (`object_crud`);
//   - ADR-0066 ⑤: an object whose read asks a capability its update, delete
//     and transfer do not, and a principal holding every verb but not the
//     capability, so its read stops at `required_permissions`.
//
// Each principal is asked as a plain context, as a person (`human`, whose
// context the service copies to carry the resolver's split) and as an agent.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccessForAsker, explainRecordsForAsker, type ExplainEngineDeps } from './explain-engine.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const ORG = 'org_srr';

const BOARD = 'qa_srr_board';
const GATED = 'qa_srr_gated';
const READ_CAPABILITY = 'qa_srr_read_capability';
const STORED = 'r_stored';
const MISSING = 'r_missing';

/** Create alone: the read stops at the object grant. */
const CREATE_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_srr_create_only', objects: { [BOARD]: { allowCreate: true } } });
/** Every verb on the read-gated object, and not the capability its read asks (ADR-0066 ⑤). */
const GATED_WRITER_SET = PermissionSetSchema.parse({
  name: 'qa_srr_gated_writer',
  objects: { [GATED]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true } },
});
/** Control: reads and writes the board. */
const READER_SET = PermissionSetSchema.parse({
  name: 'qa_srr_reader',
  objects: { [BOARD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true } },
});
/** Control: a user administrator with no read grant on the board, so its own read is refused too. */
const USERS_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_srr_users_only', objects: {}, systemPermissions: ['manage_users'] });

const CREATE_ONLY_USER = 'usr_srr_create_only';
const GATED_USER = 'usr_srr_gated';
const READER_USER = 'usr_srr_reader';
const REFUSED_ADMIN_USER = 'usr_srr_refused_admin';

const EVERY_VERB: ExplainOperation[] = ['read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge', 'export'];
const KINDS = [undefined, 'human', 'agent'] as const;

interface Shape {
  label: string;
  userId: string;
  set: string;
  object: string;
  /** The layer the principal's read stops at. */
  readRefusedBy: 'object_crud' | 'required_permissions';
}
const REFUSED_READ_SHAPES: Shape[] = [
  { label: 'a create-only principal', userId: CREATE_ONLY_USER, set: CREATE_ONLY_SET.name, object: BOARD, readRefusedBy: 'object_crud' },
  {
    label: 'a principal the object\'s read capability refuses (ADR-0066 ⑤)',
    userId: GATED_USER, set: GATED_WRITER_SET.name, object: GATED, readRefusedBy: 'required_permissions',
  },
];

let engine: ObjectQL;
let plugin: SecurityPlugin;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  const object = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    sharingModel: 'public_read_write',
    tenancy: { enabled: false },
    ...extra,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      owner_id: { name: 'owner_id', type: 'text' },
    },
  });
  engine.registerApp({
    id: 'com.objectstack.qa.explain-self-refused-read',
    name: 'Explain: a refused read is one answer for every record id',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      object(BOARD),
      object(GATED, { requiredPermissions: { read: [READ_CAPABILITY] } }),
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less catalogue rows below exist only on a store built
  // before 18.x (ADR-0131 D1): this is that store.
  await relaxTenantColumns(engine, ['sys_permission_set']);

  const e = engine as unknown as { insert: (o: string, row: unknown, opts: never) => Promise<unknown> };
  for (const id of [CREATE_ONLY_USER, GATED_USER, READER_USER, REFUSED_ADMIN_USER]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
  }
  // The create-only principal's grant as the explainer resolves it for a
  // third-party asker: a grant row pointing at a catalogue row.
  const residue = (o: string, row: Record<string, unknown>) => (engine as any).getDriver(o).create(o, row);
  await residue('sys_permission_set', {
    id: 'ps_srr_create_only', name: CREATE_ONLY_SET.name, label: CREATE_ONLY_SET.name, organization_id: null, managed_by: 'admin',
    active: true, object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await residue('sys_user_permission_set', {
    id: 'ups_srr_create_only', user_id: CREATE_ONLY_USER, permission_set: CREATE_ONLY_SET.name, organization_id: ORG,
  });
  for (const o of [BOARD, GATED]) await e.insert(o, { id: STORED, name: 'stored', owner_id: 'usr_srr_owner' }, SYS);

  const sets = [MEMBER_DEFAULT, CREATE_ONLY_SET, GATED_WRITER_SET, READER_SET, USERS_ONLY_SET];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    // Lifecycle hooks are collected and never fired, so no bootstrap read runs into the teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

const contextOf = (userId: string, set: string, kind?: string) =>
  ({ userId, tenantId: ORG, positions: [] as string[], permissions: [set], ...(kind ? { principalKind: kind } : {}) });

/** The caller explains itself. */
const explainSelf = (caller: Record<string, unknown>, object: string, operation: ExplainOperation, recordId: string) =>
  plugin.explainAccessForCaller({ object, operation, recordId }, { ...caller });

/** The read door's whole answer: a row, no row, or a refusal with its status and code. */
const readAnswer = (caller: Record<string, unknown>, object: string, id: string): Promise<string> =>
  (engine.findOne(object, { where: { id }, context: { ...caller } } as never) as Promise<unknown>).then(
    (row) => (row != null ? 'row' : 'no row'),
    (e: any) => `refused ${e?.statusCode ?? e?.status} ${e?.code}`,
  );

/** The decision, serialised with its record id set aside: the only field two ids may differ in. */
const bytesApartFromId = (d: ExplainDecision): string =>
  JSON.stringify({ ...d, record: d.record ? { ...d.record, recordId: 'ID' } : d.record }).split(STORED).join('ID').split(MISSING).join('ID');

describe('a principal whose own read of the object is refused gets one explanation for every record id', () => {
  for (const shape of REFUSED_READ_SHAPES) {
    for (const kind of KINDS) {
      const who = `${shape.label} (${kind ?? 'plain'} context)`;

      it(`armed: ${who} is refused its read of the stored row and of a missing id alike`, async () => {
        const caller = contextOf(shape.userId, shape.set, kind);
        expect(await readAnswer(caller, shape.object, STORED)).toBe('refused 403 PERMISSION_DENIED');
        expect(await readAnswer(caller, shape.object, MISSING)).toBe('refused 403 PERMISSION_DENIED');
        expect(await readAnswer({ isSystem: true }, shape.object, STORED)).toBe('row');
      });

      for (const verb of EVERY_VERB) {
        it(`${who}, ${verb}: the stored id and a missing id get byte-identical explanations, decided by the read's refusal`, async () => {
          const caller = contextOf(shape.userId, shape.set, kind);
          const stored = await explainSelf(caller, shape.object, verb, STORED);
          const missing = await explainSelf(caller, shape.object, verb, MISSING);
          expect(stored.principal.userId).toBe(shape.userId);
          expect(stored.record).toEqual({ recordId: STORED, visible: false, decidedBy: shape.readRefusedBy });
          expect(missing.record).toEqual({ recordId: MISSING, visible: false, decidedBy: shape.readRefusedBy });
          expect(bytesApartFromId(stored)).toBe(bytesApartFromId(missing));
          const attributions = stored.layers.filter((l) => l.record);
          expect(attributions.length).toBeGreaterThan(0);
          for (const layer of attributions) {
            expect(layer.record?.detail, `${verb}, the ${layer.layer} layer`)
              .toMatch(new RegExp(`^The principal's own read of this object is refused \\(the ${shape.readRefusedBy} layer\\), so this explanation is the same for every record id: `));
          }
        });
      }

      it(`${who}, batch: each id's verdict is the refused read's, the stored id's and the missing id's alike`, async () => {
        const caller = contextOf(shape.userId, shape.set, kind);
        for (const verb of EVERY_VERB) {
          const batch = await plugin.explainAccessForCaller({ object: shape.object, operation: verb, recordIds: [STORED, MISSING] }, { ...caller });
          expect(batch.records, verb).toEqual([
            { recordId: STORED, visible: false, decidedBy: shape.readRefusedBy },
            { recordId: MISSING, visible: false, decidedBy: shape.readRefusedBy },
          ]);
        }
      });
    }
  }
});

describe('controls', () => {
  for (const kind of KINDS) {
    it(`a principal who reads the object keeps its record story (${kind ?? 'plain'} context): the stored row is explained, a missing id is not`, async () => {
      const caller = contextOf(READER_USER, READER_SET.name, kind);
      expect(await readAnswer(caller, BOARD, STORED)).toBe('row');
      for (const verb of ['read', 'update', 'delete', 'export'] as ExplainOperation[]) {
        const stored = await explainSelf(caller, BOARD, verb, STORED);
        const missing = await explainSelf(caller, BOARD, verb, MISSING);
        expect(stored.record, verb).toMatchObject({ recordId: STORED, visible: true });
        expect(missing.record, verb).toEqual({ recordId: MISSING, visible: false });
        expect(stored.layers.find((l) => l.layer === 'owd_baseline')?.record?.outcome, verb).toBe('admitted');
        for (const layer of stored.layers.filter((l) => l.record)) {
          expect(layer.record?.detail, `${verb}, the ${layer.layer} layer`).not.toMatch(/own read of this object is refused/);
        }
      }
    });
  }

  it('an asker explaining another user, whose own read is refused, keeps the missing-record answer with no decider', async () => {
    const admin = contextOf(REFUSED_ADMIN_USER, USERS_ONLY_SET.name, 'human');
    expect(await readAnswer(admin, BOARD, STORED)).toBe('refused 403 PERMISSION_DENIED');
    for (const verb of EVERY_VERB) {
      const stored = await plugin.explainAccessForCaller({ object: BOARD, operation: verb, recordId: STORED, userId: CREATE_ONLY_USER }, { ...admin });
      const missing = await plugin.explainAccessForCaller({ object: BOARD, operation: verb, recordId: MISSING, userId: CREATE_ONLY_USER }, { ...admin });
      expect(stored.principal.userId, verb).toBe(CREATE_ONLY_USER);
      // The verb the explained principal holds names no decider; the verbs its
      // grant refuses keep that object-level refusal, for every id alike.
      if (verb === 'create') expect(stored.record, verb).toEqual({ recordId: STORED, visible: false });
      else expect(stored.record, verb).toEqual({ recordId: STORED, visible: false, decidedBy: 'object_crud' });
      expect(bytesApartFromId(stored), verb).toBe(bytesApartFromId(missing));
      for (const layer of stored.layers.filter((l) => l.record)) {
        expect(layer.record?.detail, `${verb}, the ${layer.layer} layer`).not.toMatch(/own read of this object is refused/);
      }
    }
  });
});

describe('the refused read, engine level: what it is asked and how it fails', () => {
  const OBJECT = 'qa_srr_engine';
  const SET = PermissionSetSchema.parse({ name: 'qa_srr_engine_set', objects: { [OBJECT]: { allowCreate: true } } });
  const PRINCIPAL = { userId: 'usr_srr_engine', positions: [] as string[], permissions: [] as string[] };

  const deps = (sets = [SET]): ExplainEngineDeps => ({
    ql: { getSchema: () => ({ name: OBJECT, sharingModel: 'public_read_write' }) },
    resolveSets: async () => sets,
    evaluator: new PermissionEvaluator(),
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: () => [],
    computeRlsFilter: async () => null,
    getFieldMask: () => ({}),
    getPartialMaskRules: async () => ({}),
    baselinePermissionSets: [],
    tenancyPosture: 'single',
    computeLayeredRlsFilter: async () => ({ layer0: null, layer1: null }),
    fetchRecord: async (_o, id) => (id === STORED ? { id: STORED, owner_id: 'usr_srr_owner', name: 'stored' } : null),
    recordAbsentToCaller: async () => false,
  });
  const selfAsker = (readOf: (o: string, id: string) => Promise<'row' | 'no_row' | 'refused'>) => ({
    context: PRINCIPAL,
    cannotRead: async () => { throw new Error('a self-explanation is never asked the third-party classification'); },
    self: { readOf: vi.fn(readOf) },
  });

  it('the self read is asked once per record, for every verb, and its refusal is one answer for both ids', async () => {
    for (const verb of EVERY_VERB) {
      const asker = selfAsker(async () => 'refused');
      const stored = await explainAccessForAsker(deps(), { object: OBJECT, operation: verb, context: PRINCIPAL, recordId: STORED }, asker);
      expect(asker.self.readOf, verb).toHaveBeenCalledTimes(1);
      const missing = await explainAccessForAsker(deps(), { object: OBJECT, operation: verb, context: PRINCIPAL, recordId: MISSING }, asker);
      expect(stored.record, verb).toEqual({ recordId: STORED, visible: false, decidedBy: 'object_crud' });
      expect(bytesApartFromId(stored), verb).toBe(bytesApartFromId(missing));
    }
  });

  it('a refusal no read-operation layer names is one answer for both ids, with no decider', async () => {
    // The grant admits the read, and the door refuses it anyway (a refusal
    // this report does not model): no layer is credited, for either id.
    const readable = PermissionSetSchema.parse({ name: 'qa_srr_engine_readable', objects: { [OBJECT]: { allowRead: true, allowCreate: true } } });
    for (const verb of EVERY_VERB) {
      const asker = selfAsker(async () => 'refused');
      const stored = await explainAccessForAsker(deps([readable]), { object: OBJECT, operation: verb, context: PRINCIPAL, recordId: STORED }, asker);
      const missing = await explainAccessForAsker(deps([readable]), { object: OBJECT, operation: verb, context: PRINCIPAL, recordId: MISSING }, asker);
      expect(stored.record, verb).toEqual({ recordId: STORED, visible: false });
      expect(bytesApartFromId(stored), verb).toBe(bytesApartFromId(missing));
    }
  });

  it('a store fault in the self read fails the explanation, for a stored id and a missing id alike', async () => {
    const fault = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    for (const verb of EVERY_VERB) {
      for (const recordId of [STORED, MISSING]) {
        await expect(
          explainAccessForAsker(deps(), { object: OBJECT, operation: verb, context: PRINCIPAL, recordId }, selfAsker(async () => { throw fault; })),
          `${verb} ${recordId}`,
        ).rejects.toBe(fault);
      }
    }
  });

  it('batch: the refused read decides every id alike', async () => {
    for (const verb of EVERY_VERB) {
      const asker = selfAsker(async () => 'refused');
      const batch = await explainRecordsForAsker(deps(), () => deps(), { object: OBJECT, operation: verb, context: PRINCIPAL }, [STORED, MISSING], asker);
      expect(batch.records, verb).toEqual([
        { recordId: STORED, visible: false, decidedBy: 'object_crud' },
        { recordId: MISSING, visible: false, decidedBy: 'object_crud' },
      ]);
    }
  });
});
