// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The batch form of `security/explain` (`recordIds`) answers exactly what N
// singular explanations answer, and settles what no record id reaches once.
//
// ## What is pinned
//
// 1. AGREEMENT. For every asker and every verb, the batch answer is the
//    object-level explanation (the one with no `recordId`) plus `records`, and
//    `records[i]` is the `record` verdict of the singular explanation of
//    `recordIds[i]`: same order, same length, a duplicated id answered at each
//    of its positions. The ids are a mixed set: a row the principal owns, one
//    shared to it, one it neither owns nor holds a share on, one an
//    app-authored read policy hides, one no row carries, and a duplicate, on a
//    `private` object behind the sharing service and on a
//    `public_read_write` object with row-level policies. The principal's grant
//    carries a `when`-conditioned field entry and a `unit` read depth with no
//    hierarchy resolver mounted. Askers: the member itself (a human, whose
//    grants the explainer resolves once more), a `manage_users` administrator
//    who reads every row, one held to the member's read policy, and the
//    system.
// 2. ONE OBJECT-LEVEL PASS. The explained principal's grant rows and its
//    person row are read once for a batch, as for one singular explanation,
//    never once per id: that per-id repetition is what made a 31-row list page
//    wait seconds for its row menus.
// 3. THE TYPED DOOR. `SecurityPlugin#explainAccessForCaller`, the method the
//    service's `explain` delegates to, declares the contract's
//    `ExplainAccessRequest` as its request, so a typed caller passes
//    `recordIds` without a cast and gets the service's answer. Compile-time
//    half: `expectTypeOf` plus a `@ts-expect-error` control, both live because
//    `tsconfig.test.json` compiles this file.
//
// The real `SecurityPlugin`, `SharingService` and sharing middleware over a
// real `ObjectQL` and SQL driver (better-sqlite3, in memory), asked through
// the registered `security` service, the member the REST door calls.

import { describe, it, expect, expectTypeOf, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SharingService, buildSharingMiddleware, SysRecordShare } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import type { ExplainAccessRequest } from '@objectstack/spec/contracts';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const BOARD = 'qa_bp_board';
const LINE = 'qa_bp_line';
const MEMBER = 'usr_bp_member';
const OTHER = 'usr_bp_other';
const ORG = 'org_bp';

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'qa_bp_member',
  objects: {
    [BOARD]: { allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true },
    [LINE]: {
      allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true,
      readScope: 'unit', writeScope: 'own',
    },
  },
  fields: { [`${LINE}.name`]: { readable: true, editable: false, when: "stage == 'locked'" } },
  rowLevelSecurity: [
    { name: 'qa_bp_reads_open_only', object: BOARD, operation: 'select', using: "name == 'open'" },
    { name: 'qa_bp_updates_any', object: BOARD, operation: 'update', using: "name != 'nothing'" },
    { name: 'qa_bp_deletes_any', object: BOARD, operation: 'delete', using: "name != 'nothing'" },
    { name: 'qa_bp_line_updates_unlocked', object: LINE, operation: 'update', using: "stage != 'locked'" },
  ],
});
const USER_ADMIN_SET = PermissionSetSchema.parse({
  name: 'qa_bp_user_admin',
  objects: { [BOARD]: { allowRead: true }, [LINE]: { allowRead: true, readScope: 'org' } },
  systemPermissions: ['manage_users', 'view_all_data'],
});
const USERS_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_bp_users_only', objects: {}, systemPermissions: ['manage_users'] });

const SELF = { userId: MEMBER, tenantId: ORG, positions: [] as string[], permissions: [MEMBER_SET.name], principalKind: 'human' };
const ADMIN = { userId: 'usr_bp_admin', tenantId: ORG, positions: [] as string[], permissions: [USER_ADMIN_SET.name] };
const BLIND_ADMIN = {
  userId: 'usr_bp_blind', tenantId: ORG, positions: [] as string[], permissions: [MEMBER_SET.name, USERS_ONLY_SET.name],
};
const SYSTEM = { isSystem: true, tenantId: ORG };
const ASKERS: Array<[string, Record<string, unknown>]> = [
  ['the member itself', SELF],
  ['an administrator who reads every row', ADMIN],
  ['an administrator held to the member read policy', BLIND_ADMIN],
  ['the system', SYSTEM],
];

const VERBS: ExplainOperation[] = ['read', 'export', 'update', 'delete', 'transfer'];
const IDS: Record<string, string[]> = {
  [BOARD]: ['b_hidden', 'b_open', 'b_nonexistent', 'b_open'],
  [LINE]: ['l_mine', 'l_shared', 'l_theirs', 'l_locked', 'l_nonexistent', 'l_mine', 'l_theirs'],
};

let engine: ObjectQL;
let plugin: SecurityPlugin;
let security: { explain: (request: Record<string, unknown>, ctx?: unknown) => Promise<ExplainDecision> };
/** Engine reads, by `<verb> <object>`, while counting is on. */
let reads: Map<string, number> | undefined;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-batch-parity',
    name: 'Explain: a batch answers what N singular explanations answer',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember, SysRecordShare,
      {
        name: BOARD,
        label: 'Board',
        sharingModel: 'public_read_write',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
      {
        name: LINE,
        label: 'Line',
        sharingModel: 'private',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          stage: { name: 'stage', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less catalogue row below exists only on a store built
  // before 18.x (ADR-0131 D1 makes a fresh tenant column NOT NULL).
  await relaxTenantColumns(engine, ['sys_permission_set']);

  const e = engine as unknown as { insert: (o: string, row: unknown, opts: never) => Promise<unknown> };
  for (const id of [MEMBER, OTHER, ADMIN.userId, BLIND_ADMIN.userId]) {
    await e.insert('sys_user', { id, name: `Person ${id}`, email: `${id}@example.test` }, SYS);
  }
  // The member's grant as the explainer resolves it: a grant row naming a
  // catalogue row; what the set confers is declared in metadata.
  const residue = (o: string, row: Record<string, unknown>) => (engine as any).getDriver(o).create(o, row);
  await residue('sys_permission_set', {
    id: 'ps_bp_member', name: MEMBER_SET.name, label: MEMBER_SET.name, organization_id: null, managed_by: 'admin',
    active: true, object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await residue('sys_user_permission_set', {
    id: 'ups_bp_member', user_id: MEMBER, permission_set: MEMBER_SET.name, organization_id: ORG,
  });
  await e.insert(BOARD, [
    { id: 'b_hidden', name: 'hidden', owner_id: OTHER },
    { id: 'b_open', name: 'open', owner_id: OTHER },
  ], SYS);
  await e.insert(LINE, [
    { id: 'l_mine', name: 'mine', stage: 'open', owner_id: MEMBER },
    { id: 'l_shared', name: 'shared', stage: 'open', owner_id: OTHER },
    { id: 'l_theirs', name: 'theirs', stage: 'open', owner_id: OTHER },
    { id: 'l_locked', name: 'locked', stage: 'locked', owner_id: MEMBER },
  ], SYS);
  await e.insert('sys_record_share', [{
    id: 'shr_bp_edit', object_name: LINE, record_id: 'l_shared', recipient_type: 'user', recipient_id: MEMBER,
    access_level: 'edit', source: 'manual', organization_id: ORG, created_at: new Date().toISOString(),
  }], SYS);

  const sets = [MEMBER_DEFAULT, MEMBER_SET, USER_ADMIN_SET, USERS_ONLY_SET];
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
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  security = services.security as typeof security;
  sharing = new SharingService({ engine: engine as never, securityService: () => security as never });
  engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });

  for (const verb of ['find', 'findOne'] as const) {
    const original = (engine as any)[verb].bind(engine);
    (engine as any)[verb] = (object: string, ...rest: unknown[]) => {
      if (reads) reads.set(`${verb} ${object}`, (reads.get(`${verb} ${object}`) ?? 0) + 1);
      return original(object, ...rest);
    };
  }
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** `asker` explains the member: a self-explanation for `SELF`, explaining another user for everyone else. */
const request = (asker: Record<string, unknown>, object: string, operation: ExplainOperation, extra: Record<string, unknown> = {}) =>
  ({ object, operation, ...(asker === SELF ? {} : { userId: MEMBER }), ...extra });

const outcome = (p: Promise<ExplainDecision>) =>
  p.then((decision) => ({ decision }), (e: any) => ({ refused: { name: e?.name, code: e?.code, message: String(e?.message) } }));

describe('[#29112] security/explain: a batch answers what N singular explanations answer', () => {
  for (const [who, asker] of ASKERS) {
    for (const object of [BOARD, LINE]) {
      for (const verb of VERBS) {
        it(`${who}, ${verb} on ${object}: the object-level decision plus each id's singular record verdict`, async () => {
          const ids = IDS[object]!;
          const batch = await outcome(security.explain(request(asker, object, verb, { recordIds: ids }), { ...asker }));
          const objectLevel = await outcome(security.explain(request(asker, object, verb), { ...asker }));
          const singular: unknown[] = [];
          for (const recordId of ids) {
            const one = await outcome(security.explain(request(asker, object, verb, { recordId }), { ...asker }));
            singular.push('decision' in one ? one.decision.record : one);
          }
          if (!('decision' in objectLevel)) {
            // A refusal of the object-level question refuses the batch the same way.
            expect(batch).toEqual(objectLevel);
            return;
          }
          expect('decision' in batch, JSON.stringify(batch)).toBe(true);
          const { records, ...decision } = (batch as { decision: ExplainDecision }).decision;
          expect(decision).toEqual(objectLevel.decision);
          expect(records).toEqual(singular);
          expect(records!.map((r) => r.recordId)).toEqual(ids);
        });
      }
    }
  }

  it('the mixed set is mixed: visible, shared, excluded, rls-locked and missing rows all occur', async () => {
    const batch = await security.explain(request(SELF, LINE, 'update', { recordIds: IDS[LINE] }), { ...SELF });
    expect(batch.records).toEqual([
      expect.objectContaining({ recordId: 'l_mine', visible: true }),
      expect.objectContaining({ recordId: 'l_shared', visible: true, decidedBy: 'sharing' }),
      expect.objectContaining({ recordId: 'l_theirs', visible: false }),
      expect.objectContaining({ recordId: 'l_locked', visible: false, decidedBy: 'rls' }),
      { recordId: 'l_nonexistent', visible: false },
      expect.objectContaining({ recordId: 'l_mine', visible: true }),
      expect.objectContaining({ recordId: 'l_theirs', visible: false }),
    ]);
    const fls = batch.layers.find((l) => l.layer === 'fls');
    expect(fls?.detail).toContain('row condition');
  });

  it('refuses recordId beside recordIds, as the wire schema does', async () => {
    await expect(
      security.explain(request(SELF, LINE, 'update', { recordId: 'l_mine', recordIds: ['l_mine'] }), { ...SELF }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe('SecurityPlugin#explainAccessForCaller: the request is typed as the contract declares it', () => {
  it('declares the contract request, so recordIds is a typed member and not an extra key', () => {
    expectTypeOf<Parameters<SecurityPlugin['explainAccessForCaller']>[0]>().toEqualTypeOf<ExplainAccessRequest>();
    // Control: the matcher can fail. The request without its batch member is a different type.
    // @ts-expect-error -- the declared request carries recordIds, so it is not the selector without it
    expectTypeOf<Parameters<SecurityPlugin['explainAccessForCaller']>[0]>().toEqualTypeOf<Omit<ExplainAccessRequest, 'recordIds'>>();
  });

  it('a typed caller passes recordIds with no cast and gets the answer the service gives', async () => {
    // An object literal, so the compiler checks every key against the declared request.
    const direct = await plugin.explainAccessForCaller({ object: LINE, operation: 'update', recordIds: IDS[LINE] }, { ...SELF });
    const viaService = await security.explain(request(SELF, LINE, 'update', { recordIds: IDS[LINE] }), { ...SELF });
    expect(direct.records?.map((r) => r.recordId)).toEqual(IDS[LINE]);
    expect(direct).toEqual(viaService);
  });
});

describe('[#29112] security/explain: a batch reads the explained principal once, not once per id', () => {
  const PRINCIPAL_READS = ['find sys_user_permission_set', 'find sys_user_position', 'findOne sys_user'];

  const countReads = async (run: () => Promise<unknown>): Promise<Record<string, number>> => {
    const counted = new Map<string, number>();
    reads = counted;
    try {
      await run();
    } finally {
      reads = undefined;
    }
    return Object.fromEntries(PRINCIPAL_READS.map((k) => [k, counted.get(k) ?? 0]));
  };

  // An administrator's explanation of a row the member cannot read runs the
  // member's READ story for that row (ruling A), a whole second explanation
  // per such row, in the batch as singularly; so the administrator's batch
  // here holds only ids the member reads, or that no row carries.
  const cases = [
    ['the member itself', SELF, IDS[LINE]!],
    ['an administrator', ADMIN, ['l_mine', 'l_shared', 'l_locked', 'l_nonexistent', 'l_mine']],
  ] as const;
  for (const [who, asker, ids] of cases) {
    it(`${who}: a ${ids.length}-id batch reads the principal's grants and person exactly as one singular explanation does`, async () => {
      const one = await countReads(() =>
        security.explain(request(asker, LINE, 'update', { recordId: 'l_mine' }), { ...asker }));
      const batch = await countReads(() =>
        security.explain(request(asker, LINE, 'update', { recordIds: ids }), { ...asker }));
      // The control: one singular explanation does read the principal.
      expect(Object.values(one).some((n) => n > 0), JSON.stringify(one)).toBe(true);
      expect(batch).toEqual(one);
    });
  }
});
