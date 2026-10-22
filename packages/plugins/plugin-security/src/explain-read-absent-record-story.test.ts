// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` answers a by-id write of a row the caller cannot READ
// with the WHOLE answer it gives for an id no row carries — the record verdict
// and every layer — beside the door's 404, for each verb whose door is a by-id
// update or delete.
//
// ## The rule
//
// Ruling A on the write doors (#21771): a row the caller cannot read is a row
// that does not exist, so its update, delete or transfer answers what a
// nonexistent id answers, `404 RECORD_NOT_FOUND`. An explanation of that
// write is the same answer in explain's vocabulary, and that vocabulary is
// more than the record verdict: each row-scoped layer carries a `record` block
// of its own. So the pins compare the two explanations whole, and check that
// every status any layer names is the status the door gives.
//
// ## The cases, on one `controlled_by_parent` detail object
//
//   - the subject: a detail row under a master the caller cannot read, so the
//     caller cannot read the detail either;
//   - CONTROL, the nonexistent id: the answer the subject must equal;
//   - CONTROL, a readable row whose master the caller may read but not edit:
//     the master-detail write check refuses it, the door answers 403, and the
//     sharing layer keeps naming that refusal.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), and the real `SharingService` as the kernel's
// `sharing` service with its middleware on the engine. The caller holds no
// `org_member` position, so the platform's ownership floor is out of play and
// the master check decides the control. `@objectstack/plugin-sharing`
// resolves through its built `dist/`, as this package's other suites read it.
//
// The tenant layer's own verdict is the one layer field the detail objects
// above cannot reach (they are not tenant-scoped), so the last block asks the
// engine directly, with a deps bag whose stored row sits behind the tenant
// wall, and holds that answer equal to the nonexistent id's too.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { explainAccess, type ExplainEngineDeps } from './explain-engine.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const MASTER = 'qa_ras_master';
const DETAIL = 'qa_ras_detail';
const OWNER = 'usr_ras_owner';
const CALLER_ID = 'usr_ras_caller';

/** The verbs whose door is a by-id update or delete and whose grant the object gate admits. */
const VERBS = ['update', 'delete', 'transfer'] as const;
type Verb = (typeof VERBS)[number];

const WRITER_SET = PermissionSetSchema.parse({
  name: 'qa_ras_writer',
  objects: {
    [MASTER]: { allowRead: true, allowCreate: true, allowEdit: true },
    [DETAIL]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true },
  },
});

const CALLER = { userId: CALLER_ID, positions: ['qa_pos'], permissions: [WRITER_SET.name], posture: 'MEMBER' };

type Answer = { kind: 'admitted' } | { kind: 'refused'; code?: string; status?: number };

const landed = (p: Promise<unknown>): Promise<Answer> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code == null ? undefined : String(e.code), status: e?.statusCode ?? e?.status }),
  );

/** One row per (case, verb), so a write that lands never changes another case's row. */
const unreadableId = (verb: Verb) => `d_unreadable_${verb}`;
const nonexistentId = (verb: Verb) => `d_nonexistent_${verb}`;
const controlId = (verb: Verb) => `d_control_${verb}`;

let engine: ObjectQL;
let plugin: SecurityPlugin;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-read-absent-record-story',
    name: 'Explain read-absent: the whole record story',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysRecordShare,
      {
        name: MASTER,
        label: 'Master',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
      {
        name: DETAIL,
        label: 'Detail',
        sharingModel: 'controlled_by_parent',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          master: { name: 'master', type: 'master_detail', reference: MASTER, required: true },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  // Both masters belong to another user; only the second is shared to the
  // caller, at `read`, which lets the caller read it and edit neither.
  await engine.insert(MASTER, [
    { id: 'm_unshared', name: 'unshared', owner_id: OWNER },
    { id: 'm_shared_read', name: 'shared at read', owner_id: OWNER },
  ], SYS);
  for (const verb of VERBS) {
    await engine.insert(DETAIL, [
      { id: unreadableId(verb), name: 'detail', master: 'm_unshared', owner_id: OWNER },
      { id: controlId(verb), name: 'detail', master: 'm_shared_read', owner_id: OWNER },
    ], SYS);
  }
  await engine.insert('sys_record_share', [{
    id: 'shr_ras_read',
    object_name: MASTER,
    record_id: 'm_shared_read',
    recipient_type: 'user',
    recipient_id: CALLER_ID,
    access_level: 'read',
    source: 'manual',
    created_at: new Date().toISOString(),
  }], SYS);

  const sets = [MEMBER_DEFAULT, WRITER_SET];
  let security: unknown;
  let sharing: SharingService | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
    },
    get sharing() { return sharing; },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { if (name === 'security') security = svc; },
    // The lifecycle hooks are collected and never fired, so no bootstrap read
    // is left running into the engine teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The engine's security source, as `ObjectQLPlugin.init` wires it on a kernel (ADR-0139 D2).
  wireEngineSecuritySource(engine, () => plugin);
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

const explain = (verb: Verb, recordId: string): Promise<ExplainDecision> =>
  plugin.explainAccessForCaller({ object: DETAIL, operation: verb, recordId }, { ...CALLER });

/** The verb's door, addressed by id: a transfer is the update that writes `owner_id`. */
const door = (verb: Verb, id: string): Promise<Answer> =>
  verb === 'delete'
    ? landed(engine.delete(DETAIL, { where: { id }, context: { ...CALLER } } as never))
    : landed(engine.update(DETAIL, verb === 'transfer' ? { owner_id: 'usr_ras_successor' } : { name: 'edited' },
        { where: { id }, context: { ...CALLER } } as never));

/** The decision with its record id set aside: the one field two different ids must differ in. */
const withoutRecordId = (d: ExplainDecision) => ({ ...d, record: d.record ? { ...d.record, recordId: 'ID' } : d.record });

/** Every HTTP status, with its code, that any layer's prose names. */
const statusesNamed = (d: ExplainDecision): string[] => {
  const prose = d.layers.flatMap((l) => [l.detail, l.record?.detail ?? '']).join('\n');
  return [...new Set([...prose.matchAll(/\b([1-5]\d\d) ([A-Z][A-Z_]+)\b/g)].map((m) => `${m[1]} ${m[2]}`))];
};

const doorStatus = (a: Answer): string => (a.kind === 'refused' ? `${a.status} ${a.code}` : 'admitted');

describe('explain answers a by-id write of a row the caller cannot read as the id no row carries, layers included', () => {
  it('armed: the subject rows exist, the caller reads none of them, and the caller reads every control row', async () => {
    for (const verb of VERBS) {
      const stored = await engine.findOne(DETAIL, { where: { id: unreadableId(verb) }, context: { isSystem: true } } as never);
      expect(stored, `${unreadableId(verb)} under a system read`).not.toBeNull();
      const asCaller = await engine.findOne(DETAIL, { where: { id: unreadableId(verb) }, context: { ...CALLER } } as never);
      expect(asCaller ?? null, `${unreadableId(verb)} under the caller's read`).toBeNull();
      const control = await engine.findOne(DETAIL, { where: { id: controlId(verb) }, context: { ...CALLER } } as never);
      expect(control, `${controlId(verb)} under the caller's read`).not.toBeNull();
    }
  });

  for (const verb of VERBS) {
    it(`${verb}: the unreadable row's whole explanation equals the nonexistent id's, beside the same 404`, async () => {
      const unreadable = await explain(verb, unreadableId(verb));
      const nonexistent = await explain(verb, nonexistentId(verb));
      const unreadableDoor = await door(verb, unreadableId(verb));
      const nonexistentDoor = await door(verb, nonexistentId(verb));

      expect(unreadableDoor, `${verb} door, the unreadable row`).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      expect(nonexistentDoor, `${verb} door, the nonexistent id`).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      // The record verdict is the missing-record shape, as before this suite.
      expect(unreadable.record).toEqual({ recordId: unreadableId(verb), visible: false });
      // ...and so is everything else: every layer, its `record` block included.
      expect(withoutRecordId(unreadable)).toEqual(withoutRecordId(nonexistent));
    });

    it(`${verb}: no layer of the unreadable row's explanation names a status the door does not give`, async () => {
      const explained = await explain(verb, unreadableId(verb));
      const answered = await door(verb, unreadableId(verb));
      expect(doorStatus(answered)).toBe('404 RECORD_NOT_FOUND');
      for (const named of statusesNamed(explained)) {
        expect(named, `a status named in explain ${verb}'s layers`).toBe(doorStatus(answered));
      }
    });

    it(`${verb}: control, a readable row whose master the caller may not edit keeps the master check's 403 on both faces`, async () => {
      const explained = await explain(verb, controlId(verb));
      const answered = await door(verb, controlId(verb));
      expect(answered, `${verb} door, the control row`).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect(explained.record).toEqual({ recordId: controlId(verb), visible: false, decidedBy: 'sharing' });
      const sharing = explained.layers.find((l) => l.layer === 'sharing')?.record;
      expect(sharing?.outcome).toBe('excluded');
      expect(sharing?.detail).toMatch(new RegExp(`refuses this ${verb} on its '[a-z_]+' leg`));
      expect(statusesNamed(explained)).toEqual([doorStatus(answered)]);
    });
  }
});

describe('the tenant layer of a by-id write explanation of a row the caller cannot read, engine level', () => {
  const OBJECT = 'qa_ras_walled';
  const SET = PermissionSetSchema.parse({
    name: 'qa_ras_walled_writer',
    objects: { [OBJECT]: { allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true } },
  });
  const CONTEXT = { userId: 'usr_ras_walled', tenantId: 'org_home', positions: ['qa_pos'], permissions: [] };
  const WALL = { organization_id: 'org_home' };
  const STORED = { id: 'r_walled', organization_id: 'org_other', owner_id: 'usr_ras_other' };

  /** One deps bag; only the stored row and the read question vary. */
  const deps = (stored: Record<string, unknown> | null, read?: { absent: boolean }): ExplainEngineDeps => ({
    ql: { getSchema: () => ({ name: OBJECT, sharingModel: 'public_read_write' }) },
    resolveSets: async () => [SET],
    evaluator: new PermissionEvaluator(),
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: () => [],
    computeRlsFilter: async () => WALL,
    getFieldMask: () => ({}),
    getPartialMaskRules: async () => ({}),
    baselinePermissionSets: [],
    tenancyPosture: 'single',
    computeLayeredRlsFilter: async () => ({ layer0: WALL, layer1: null }),
    fetchRecord: async () => stored,
    ...(read ? { recordAbsentToCaller: async () => read.absent } : {}),
  });

  const explainWith = (d: ExplainEngineDeps, verb: Verb) =>
    explainAccess(d, { object: OBJECT, operation: verb, context: { ...CONTEXT }, recordId: STORED.id });
  const tenantLayerOf = (d: ExplainDecision) => d.layers.find((l) => l.layer === 'tenant_isolation');

  for (const verb of VERBS) {
    it(`${verb}: a row behind the tenant wall that the read does not return is explained as the id no row carries`, async () => {
      const walled = await explainWith(deps(STORED, { absent: true }), verb);
      const missing = await explainWith(deps(null, { absent: true }), verb);
      expect(walled).toEqual(missing);
      expect(tenantLayerOf(walled)?.verdict).toBe('narrows');
      expect(walled.record).toEqual({ recordId: STORED.id, visible: false });
    });

    it(`${verb}: control, the same stored row with no read question wired reaches the wall's own refusal`, async () => {
      const unasked = await explainWith(deps(STORED), verb);
      expect(tenantLayerOf(unasked)?.verdict).toBe('denies');
      expect(tenantLayerOf(unasked)?.record?.outcome).toBe('excluded');
      expect(unasked.record).toEqual({ recordId: STORED.id, visible: false, decidedBy: 'tenant_isolation' });
    });
  }
});
