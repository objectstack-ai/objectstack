// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` decides whether an explanation may say a record exists by
// the read access of whoever ASKED for it, never by the explained principal's.
//
// ## The rule
//
// Ruling A of the explain-asker decision. An asker the read door does not
// return the record to gets, for every operation, exactly what an id no row
// carries gets: the record verdict and every layer's per-record attribution.
// An asker who can read the record learns nothing new about its existence, so
// it gets the explained principal's full record story:
//
//   - for a read, the principal's own verdict, decider included;
//   - for a by-id write (update, delete, transfer) of a row the principal
//     cannot read, `visible: false`, the outcome that principal's write gets,
//     with the decider of the principal's READ, and each row-scoped layer
//     carrying that read's attribution.
//
// "Can read" is the read door's own by-id read asked with the asker's context
// (the question the write doors ask). A system asker is asked too, and the
// read door returns it every row (the system asker's cells below).
//
// Ruling C (#22851) settles how a REFUSED read (a declared 4xx, such as no
// read grant on the object) is classified, on that same read: for an asker
// explaining another user it is "cannot read", the nonexistent id's answer;
// for a principal explaining itself it is not, because that principal's own
// by-id write doors do not treat it as absence, so its explanation shows what
// those doors do (the edit-only principal's cells).
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory), the platform's grant tables, and one
// `public_read_write` board. The explained member reads only the board named
// `open`, through an app-authored READ row-level policy, and its write-class
// policies admit every board. So the member's update, delete or transfer of
// the hidden board stops at the read alone (the door answers what a
// nonexistent id answers), and the write composition by itself would admit
// it: the read's decider is the only right one.
//
// Askers: the member itself; a `manage_users` administrator who reads every
// board; a `manage_users` administrator held to the member's read policy; a
// delegated administrator (ADR-0090 D12) held to it too; and the system. The
// delegated administrator's boundary check is answered by a stub, because the
// boundary is not what is measured: what that asker can READ is.
//
// The last block asks the engine directly over a deps bag, for the facts the
// served rig cannot isolate: which contexts the read question is asked with,
// how often, and that a write's decider is its principal's READ even where
// the write's own composition would admit the row.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccess, explainAccessForAsker, type ExplainEngineDeps, type ExplainInput } from './explain-engine.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const BOARD = 'qa_ag_board';
const MEMBER = 'usr_ag_member';
/**
 * The organization the rig runs in. A grant applies only in its own
 * organization, so the member's grant rows are this organization's and every
 * asker acts in it: the explained member is resolved in the asker's
 * organization (#20515), and under `single` the claim stands without a
 * membership row.
 */
const ORG = 'org_ag';

/**
 * The member's grant: every verb on the board; a READ policy that admits only
 * the board named `open`; and write-class policies that admit every board, so
 * the write composition alone narrows nothing the read does.
 */
const MEMBER_SET = PermissionSetSchema.parse({
  name: 'qa_ag_member',
  objects: {
    [BOARD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true },
  },
  rowLevelSecurity: [
    { name: 'qa_ag_reads_open_only', object: BOARD, operation: 'select', using: "name == 'open'" },
    { name: 'qa_ag_updates_any', object: BOARD, operation: 'update', using: "name != 'nothing'" },
    { name: 'qa_ag_deletes_any', object: BOARD, operation: 'delete', using: "name != 'nothing'" },
  ],
});
/** A user administrator who reads every board. */
const USER_ADMIN_SET = PermissionSetSchema.parse({
  name: 'qa_ag_user_admin',
  objects: { [BOARD]: { allowRead: true } },
  systemPermissions: ['manage_users'],
});
/** `manage_users` alone: no data grant at all (it is not a data-read grant). */
const USERS_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_ag_users_only', objects: {}, systemPermissions: ['manage_users'] });

const SELF = { userId: MEMBER, tenantId: ORG, positions: [] as string[], permissions: [MEMBER_SET.name] };
const ADMIN = { userId: 'usr_ag_admin', tenantId: ORG, positions: [] as string[], permissions: [USER_ADMIN_SET.name] };
/** A user administrator held to the member's read policy. */
const BLIND_ADMIN = { userId: 'usr_ag_blind', tenantId: ORG, positions: [] as string[], permissions: [MEMBER_SET.name, USERS_ONLY_SET.name] };
/** A delegated administrator (D12, no `manage_users`) held to the member's read policy. */
const DELEGATE = { userId: 'usr_ag_delegate', tenantId: ORG, positions: [] as string[], permissions: [MEMBER_SET.name] };
const SYSTEM = { isSystem: true, tenantId: ORG };
/** [#22851] A user administrator with no read grant on the object: its own read of every row is REFUSED. */
const REFUSED_ADMIN = { userId: 'usr_ag_refused_admin', tenantId: ORG, positions: [] as string[], permissions: [USERS_ONLY_SET.name] };
/** [#22851] A delegated administrator (D12) with no read grant on the object: its own read is refused too. */
const REFUSED_DELEGATE = { userId: 'usr_ag_refused_delegate', tenantId: ORG, positions: [] as string[], permissions: [] as string[] };
/**
 * [#22851] Edits, deletes and transfers boards, and may not read them: the
 * principal whose self-explanation keeps the write path's notion under ruling
 * C, because its by-id write doors do not treat its refused read as absence.
 */
const EDIT_ONLY_SET = PermissionSetSchema.parse({
  name: 'qa_ag_edit_only',
  objects: { [BOARD]: { allowEdit: true, allowDelete: true, allowTransfer: true } },
});
const EDIT_ONLY_USER = 'usr_ag_edit_only';
const EDIT_ONLY = { userId: EDIT_ONLY_USER, tenantId: ORG, positions: [] as string[], permissions: [EDIT_ONLY_SET.name] };
/** Per write verb, a board the edit-only principal's own door writes, so a door that lands changes no other case's row. */
const editOnlyRowOf = (verb: ExplainOperation) => `b_edit_only_${verb}`;

const HIDDEN = 'b_hidden';
const OPEN = 'b_open';
const NONEXISTENT = 'b_nonexistent';

/** Every verb the member's grant lets through the object gate, read-class and by-id write alike. */
const VERBS: ExplainOperation[] = ['read', 'export', 'update', 'delete', 'transfer'];
const WRITE_VERBS: ExplainOperation[] = ['update', 'delete', 'transfer'];

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
    id: 'com.objectstack.qa.explain-asker-gate',
    name: 'Explain: the asker decides what the record story may disclose',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
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
    ],
  } as never);
  await engine.syncSchemas();

  const e = engine as unknown as { insert: (o: string, row: unknown, opts: never) => Promise<unknown> };
  for (const id of [MEMBER, ADMIN.userId, BLIND_ADMIN.userId, DELEGATE.userId, REFUSED_ADMIN.userId, REFUSED_DELEGATE.userId, EDIT_ONLY_USER]) {
    await e.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYS);
  }
  // [C8 stage 8b] The catalogue rows below carry no organization: under `single`
  // the engine stamps or refuses such a platform insert (ADR-0131 D9), so the
  // grant-side rows are landed straight through the driver. The user grants are
  // owned by the rig's organization: an organization-less grant applies nowhere.
  const residue = (o: string, row: Record<string, unknown>) => (engine as any).getDriver(o).create(o, row);
  // The explained member's grant, as the explainer resolves it: a grant row
  // pointing at a catalogue row; what the set confers is declared in metadata.
  await residue('sys_permission_set', {
    id: 'ps_ag_member', name: MEMBER_SET.name, label: MEMBER_SET.name, organization_id: null, managed_by: 'admin',
    active: true, object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await residue('sys_user_permission_set', {
    id: 'ups_ag_member', user_id: MEMBER, permission_set: MEMBER_SET.name, organization_id: ORG,
  });
  await residue('sys_permission_set', {
    id: 'ps_ag_edit_only', name: EDIT_ONLY_SET.name, label: EDIT_ONLY_SET.name, organization_id: null, managed_by: 'admin',
    active: true, object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await residue('sys_user_permission_set', {
    id: 'ups_ag_edit_only', user_id: EDIT_ONLY_USER, permission_set: EDIT_ONLY_SET.name, organization_id: ORG,
  });
  await e.insert(BOARD, [
    { id: HIDDEN, name: 'hidden', owner_id: 'usr_ag_owner' },
    { id: OPEN, name: 'open', owner_id: 'usr_ag_owner' },
    ...WRITE_VERBS.map((verb) => ({ id: editOnlyRowOf(verb), name: 'hidden', owner_id: 'usr_ag_owner' })),
  ], SYS);

  const sets = [MEMBER_DEFAULT, MEMBER_SET, USER_ADMIN_SET, USERS_ONLY_SET, EDIT_ONLY_SET];
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
  // The D12 boundary: these delegates' adminScope covers the member, and
  // nobody else's does. Answered by a stub on the real gate's boundary
  // question, as the file header says; the gate's write-path checks stay its own.
  const gate = (plugin as unknown as { delegatedAdminGate: { scopesCoverUser: (...a: any[]) => Promise<boolean> } })
    .delegatedAdminGate;
  vi.spyOn(gate, 'scopesCoverUser').mockImplementation(
    async (_sets: unknown, target: string, caller: { userId?: string }) =>
      (caller?.userId === DELEGATE.userId || caller?.userId === REFUSED_DELEGATE.userId) && target === MEMBER,
  );
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** `asker` explains the member: a self-explanation for `SELF`, explaining another user for everyone else. */
const explain = (asker: Record<string, unknown>, operation: ExplainOperation, recordId: string): Promise<ExplainDecision> =>
  plugin.explainAccessForCaller(
    { object: BOARD, operation, recordId, ...(asker === SELF ? {} : { userId: MEMBER }) },
    { ...asker },
  );

/** The read door: the asker's own by-id read. */
const reads = async (asker: Record<string, unknown>, id: string): Promise<boolean> =>
  (await engine.findOne(BOARD, { where: { id }, context: { ...asker } } as never)) != null;

/** The read door's whole answer: a row, no row, or a refusal with its status and code. */
const readAnswer = (asker: Record<string, unknown>, id: string): Promise<string> =>
  (engine.findOne(BOARD, { where: { id }, context: { ...asker } } as never) as Promise<unknown>).then(
    (row) => (row != null ? 'row' : 'no row'),
    (e: any) => `refused ${e?.statusCode ?? e?.status} ${e?.code}`,
  );

/** `asker` explains `userId` (another user), or itself when `userId` is omitted. */
const explainAs = (
  asker: Record<string, unknown>, operation: ExplainOperation, recordId: string, userId?: string,
): Promise<ExplainDecision> =>
  plugin.explainAccessForCaller({ object: BOARD, operation, recordId, ...(userId ? { userId } : {}) }, { ...asker });

type Answer = { kind: 'admitted' } | { kind: 'refused'; code?: string; status?: number };
const landed = (p: Promise<unknown>): Promise<Answer> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code == null ? undefined : String(e.code), status: e?.statusCode ?? e?.status }),
  );
/** The member's own by-id write door: a transfer is the update that writes `owner_id`. */
const memberDoor = (verb: ExplainOperation, id: string): Promise<Answer> =>
  verb === 'delete'
    ? landed(engine.delete(BOARD, { where: { id }, context: { ...SELF } } as never))
    : landed(engine.update(BOARD, verb === 'transfer' ? { owner_id: 'usr_ag_successor' } : { name: 'edited' },
        { where: { id }, context: { ...SELF } } as never));

/** The decision with its record id set aside: the one field two different ids must differ in. */
const withoutRecordId = (d: ExplainDecision) => ({ ...d, record: d.record ? { ...d.record, recordId: 'ID' } : d.record });
/**
 * [#23157] The decision with the principal's person set aside. The principal
 * layer names the explained user as far as the ASKER's own read returns them
 * (`explain-principal-person.test.ts`), so two askers' explanations of one
 * principal may differ in that name; the record story compared below may not.
 */
const apartFromPrincipalPerson = (d: ExplainDecision) => ({
  ...d,
  layers: d.layers.map((l) => (l.layer === 'principal'
    ? { ...l, detail: l.detail.replace(/^Principal .*? holds position\(s\) /, 'Principal PERSON holds position(s) ') }
    : l)),
});
const layerRecord = (d: ExplainDecision, layer: string) => d.layers.find((l) => l.layer === layer)?.record;
/** Every HTTP status, with its code, that any layer's prose names. */
const statusesNamed = (d: ExplainDecision): string[] => {
  const prose = d.layers.flatMap((l) => [l.detail, l.record?.detail ?? '']).join('\n');
  return [...new Set([...prose.matchAll(/\b([1-5]\d\d) ([A-Z][A-Z_]+)\b/g)].map((m) => `${m[1]} ${m[2]}`))];
};

describe('armed: who reads which board', () => {
  it('the hidden board exists; the member, the held administrator and the delegate cannot read it; the administrator can', async () => {
    expect(await reads(SYSTEM, HIDDEN), 'a system read of the hidden board').toBe(true);
    for (const [who, asker] of [['the member', SELF], ['the held administrator', BLIND_ADMIN], ['the delegate', DELEGATE]] as const) {
      expect(await reads(asker, HIDDEN), `${who}'s read of the hidden board`).toBe(false);
      expect(await reads(asker, OPEN), `${who}'s read of the open board`).toBe(true);
    }
    expect(await reads(ADMIN, HIDDEN), "the administrator's read of the hidden board").toBe(true);
    expect(await reads(ADMIN, OPEN), "the administrator's read of the open board").toBe(true);
  });

  it('the member\'s write of the hidden board answers what a nonexistent id answers, for every by-id write verb', async () => {
    for (const verb of WRITE_VERBS) {
      expect(await memberDoor(verb, HIDDEN), `${verb} door, the hidden board`).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      expect(await memberDoor(verb, NONEXISTENT), `${verb} door, a nonexistent id`).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    }
  });
});

describe('an asker who cannot read the row gets, for every operation, the answer an id no row carries gets', () => {
  for (const [who, asker] of [
    ['the member explaining itself', SELF],
    ['a manage_users administrator held to the member\'s read', BLIND_ADMIN],
    ['a delegated administrator (D12) held to the member\'s read', DELEGATE],
  ] as const) {
    for (const verb of VERBS) {
      it(`${who}, ${verb}: the hidden board's whole explanation equals the nonexistent id's, layers included`, async () => {
        const hidden = await explain(asker, verb, HIDDEN);
        const nonexistent = await explain(asker, verb, NONEXISTENT);
        expect(hidden.principal.userId).toBe(MEMBER);
        expect(hidden.record).toEqual({ recordId: HIDDEN, visible: false });
        expect(withoutRecordId(hidden)).toEqual(withoutRecordId(nonexistent));
      });
    }
  }

  it('the delegate holds no manage_users: it reached the record story through the D12 boundary alone', async () => {
    const sets = await (plugin as unknown as { resolvePermissionSetsForContext: (c: unknown) => Promise<Array<{ systemPermissions?: string[] }>> })
      .resolvePermissionSetsForContext({ ...DELEGATE });
    expect(sets.some((s) => (s.systemPermissions ?? []).includes('manage_users'))).toBe(false);
  });
});

describe('an asker who can read the row gets the explained principal\'s full record story', () => {
  it('read: the member\'s own verdict, decider included, as the system asker gets it', async () => {
    const byAdmin = await explain(ADMIN, 'read', HIDDEN);
    const bySystem = await explain(SYSTEM, 'read', HIDDEN);
    expect(byAdmin.record).toEqual({ recordId: HIDDEN, visible: false, decidedBy: 'rls' });
    expect(layerRecord(byAdmin, 'rls')?.outcome).toBe('excluded');
    expect(apartFromPrincipalPerson(byAdmin)).toEqual(apartFromPrincipalPerson(bySystem));
  });

  for (const verb of WRITE_VERBS) {
    it(`${verb}: not visible, the member's write's answer, decided by the member's READ, as the system asker gets it`, async () => {
      const byAdmin = await explain(ADMIN, verb, HIDDEN);
      const bySystem = await explain(SYSTEM, verb, HIDDEN);
      expect(byAdmin.record).toEqual({ recordId: HIDDEN, visible: false, decidedBy: 'rls' });
      expect(apartFromPrincipalPerson(byAdmin)).toEqual(apartFromPrincipalPerson(bySystem));
    });

    it(`${verb}: each row-scoped layer carries the member's read attribution, and names only the door's 404`, async () => {
      const explained = await explain(ADMIN, verb, HIDDEN);
      const rls = layerRecord(explained, 'rls');
      expect(rls?.outcome).toBe('excluded');
      expect(rls?.matchesRecord).toBe(false);
      // The READ policy's predicate, never the write composition's (which admits every board).
      expect(rls?.rowFilter).toEqual({ name: 'open' });
      expect(rls?.detail).toContain(`The principal cannot read this record, so its by-id ${verb} answers 404 RECORD_NOT_FOUND`);
      expect(rls?.detail).toContain('The record does not satisfy the business row-level predicate.');
      for (const layer of ['tenant_isolation', 'owd_baseline', 'depth', 'sharing', 'vama_bypass', 'rls']) {
        expect(layerRecord(explained, layer)?.detail, `${verb}, the ${layer} layer`).toMatch(/^The principal cannot read this record/);
      }
      expect(statusesNamed(explained)).toEqual(['404 RECORD_NOT_FOUND']);
      expect(await memberDoor(verb, HIDDEN)).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    });
  }
});

describe('controls', () => {
  for (const verb of VERBS) {
    it(`${verb}: a nonexistent id is the missing-record answer for every asker`, async () => {
      for (const asker of [SELF, ADMIN, BLIND_ADMIN, DELEGATE, SYSTEM]) {
        expect((await explain(asker, verb, NONEXISTENT)).record).toEqual({ recordId: NONEXISTENT, visible: false });
      }
    });

    it(`${verb}: a row every asker reads gets one answer, whoever asks, and its record story is the stored row's`, async () => {
      const bySystem = await explain(SYSTEM, verb, OPEN);
      expect(bySystem.record).toMatchObject({ recordId: OPEN, visible: true });
      expect(layerRecord(bySystem, 'rls')).toMatchObject({ outcome: 'admitted', matchesRecord: true });
      for (const asker of [ADMIN, BLIND_ADMIN, DELEGATE]) {
        expect(apartFromPrincipalPerson(await explain(asker, verb, OPEN))).toEqual(apartFromPrincipalPerson(bySystem));
      }
      const self = await explain(SELF, verb, OPEN);
      expect(self.record).toEqual(bySystem.record);
      expect(self.layers.map((l) => l.record)).toEqual(bySystem.layers.map((l) => l.record));
    });
  }
});

/** `ctx`'s own by-id write door: a transfer is the update that writes `owner_id`. */
const doorAs = (ctx: Record<string, unknown>, verb: ExplainOperation, id: string): Promise<Answer> =>
  verb === 'delete'
    ? landed(engine.delete(BOARD, { where: { id }, context: { ...ctx } } as never))
    : landed(engine.update(BOARD, verb === 'transfer' ? { owner_id: 'usr_ag_successor' } : { name: 'edited' },
        { where: { id }, context: { ...ctx } } as never));

describe('[#22851] ruling C: a refused read is "cannot read" only for an asker explaining another user', () => {
  it('armed: the refused askers\' and the edit-only principal\'s own reads are REFUSED, for a stored row and a nonexistent id alike', async () => {
    for (const [who, asker] of [
      ['the refused administrator', REFUSED_ADMIN],
      ['the refused delegate', REFUSED_DELEGATE],
      ['the edit-only principal', EDIT_ONLY],
    ] as const) {
      for (const id of [HIDDEN, OPEN, NONEXISTENT]) {
        expect(await readAnswer(asker, id), `${who}'s read of ${id}`).toBe('refused 403 PERMISSION_DENIED');
      }
    }
  });

  for (const [who, asker] of [
    ['a manage_users administrator with no read grant on the object', REFUSED_ADMIN],
    ['a delegated administrator (D12) with no read grant on the object', REFUSED_DELEGATE],
  ] as const) {
    for (const verb of VERBS) {
      it(`${who}, ${verb}: a stored row's whole explanation equals the nonexistent id's, layers included`, async () => {
        const nonexistent = await explainAs(asker, verb, NONEXISTENT, MEMBER);
        expect(nonexistent.record).toEqual({ recordId: NONEXISTENT, visible: false });
        for (const id of [HIDDEN, OPEN]) {
          const stored = await explainAs(asker, verb, id, MEMBER);
          expect(stored.principal.userId).toBe(MEMBER);
          expect(stored.record, `${verb} ${id}`).toEqual({ recordId: id, visible: false });
          expect(withoutRecordId(stored), `${verb} ${id}, whole`).toEqual(withoutRecordId(nonexistent));
        }
      });
    }
  }

  for (const verb of VERBS) {
    it(`control, ${verb}: a principal explaining itself keeps the write path's notion, so a refused read is not the missing record`, async () => {
      const id = WRITE_VERBS.includes(verb) ? editOnlyRowOf(verb) : HIDDEN;
      const self = await explainAs(EDIT_ONLY, verb, id);
      const nonexistent = await explainAs(EDIT_ONLY, verb, NONEXISTENT);
      // Today's answer: the stored row's own story, the one a system asker is told about this principal.
      const bySystem = await explainAs(SYSTEM, verb, id, EDIT_ONLY_USER);
      expect(self.record, verb).toEqual(bySystem.record);
      expect(self.layers.map((l) => l.record), verb).toEqual(bySystem.layers.map((l) => l.record));
      expect(withoutRecordId(self), verb).not.toEqual(withoutRecordId(nonexistent));
      expect(layerRecord(self, 'owd_baseline')?.outcome, verb).toBe('admitted');
      expect(layerRecord(nonexistent, 'owd_baseline')?.outcome, verb).toBe('not_evaluated');
      if (WRITE_VERBS.includes(verb)) {
        // ...which is what that principal's own door does with the row.
        expect(self.record, verb).toMatchObject({ visible: true });
        expect(await doorAs(EDIT_ONLY, verb, id), `${verb} door`).toEqual({ kind: 'admitted' });
      } else {
        expect(self.record, verb).toEqual({ recordId: id, visible: false, decidedBy: 'object_crud' });
      }
    });
  }

  it('control: a reading administrator and a nonexistent id are unchanged by the refused-asker rule', async () => {
    expect((await explainAs(ADMIN, 'read', HIDDEN, MEMBER)).record).toEqual({ recordId: HIDDEN, visible: false, decidedBy: 'rls' });
    expect((await explainAs(ADMIN, 'update', HIDDEN, MEMBER)).record).toEqual({ recordId: HIDDEN, visible: false, decidedBy: 'rls' });
    for (const asker of [REFUSED_ADMIN, REFUSED_DELEGATE, ADMIN, SYSTEM]) {
      expect((await explainAs(asker, 'read', NONEXISTENT, MEMBER)).record).toEqual({ recordId: NONEXISTENT, visible: false });
    }
  });
});

describe('the read question, engine level: who it is asked of, and how often', () => {
  const OBJECT = 'qa_ag_engine';
  const SET = PermissionSetSchema.parse({
    name: 'qa_ag_engine_writer',
    objects: { [OBJECT]: { allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true, allowExport: true } },
  });
  const EXPLAINED = { userId: 'usr_ag_explained', positions: [] as string[], permissions: [] as string[] };
  const ASKER = { userId: 'usr_ag_asker', positions: [] as string[], permissions: [] as string[] };
  const STORED = { id: 'r1', owner_id: 'usr_ag_other', name: 'stored' };

  /** One deps bag; the read question answers per context, from `absentTo`. */
  const deps = (question: ExplainEngineDeps['recordAbsentToCaller']): ExplainEngineDeps => ({
    ql: { getSchema: () => ({ name: OBJECT, sharingModel: 'public_read_write' }) },
    resolveSets: async () => [SET],
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
    computeLayeredRlsFilter: async () => ({ layer0: null, layer1: null }),
    fetchRecord: async (_o, id) => (id === STORED.id ? { ...STORED } : null),
    recordAbsentToCaller: question,
  });
  /** The read door: `absent` lists the contexts it does not return the record to. */
  const door = (...absent: unknown[]) => vi.fn(async (_o: string, _id: string, c: unknown) => absent.includes(c));
  /**
   * The internal entry, asked by `askerContext`, whose own read is the deps
   * bag's door asked with its context: a door that never refuses, so the
   * third-party classification (ruling C) answers what the door answers.
   */
  const explainFor = (d: ExplainEngineDeps, input: ExplainInput, askerContext: unknown) =>
    explainAccessForAsker(d, input, {
      context: askerContext,
      cannotRead: (o, id) => (d.recordAbsentToCaller ? d.recordAbsentToCaller(o, id, askerContext) : Promise.resolve(false)),
    });

  it('a self-explanation asks the explained context, once, whatever the verb', async () => {
    for (const verb of VERBS) {
      const question = door();
      await explainAccess(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id });
      expect(question, verb).toHaveBeenCalledTimes(1);
      expect(question.mock.calls[0][2], verb).toBe(EXPLAINED);
    }
  });

  it('another asker is asked with its own context, and the explained principal only for a by-id write', async () => {
    for (const verb of VERBS) {
      const question = door();
      await explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, ASKER);
      const asked = question.mock.calls.map((c) => c[2]);
      expect(asked[0], `${verb}: the asker first`).toBe(ASKER);
      expect(asked.filter((c) => c === ASKER), `${verb}: the asker, once`).toHaveLength(1);
      expect(asked.filter((c) => c === EXPLAINED), `${verb}: the explained principal`).toHaveLength(WRITE_VERBS.includes(verb) ? 1 : 0);
    }
  });

  it('a write of a row the explained principal cannot read asks each context once, its read pass included', async () => {
    for (const verb of WRITE_VERBS) {
      const question = door(EXPLAINED);
      const d = await explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, ASKER);
      expect(d.record, verb).toMatchObject({ recordId: STORED.id, visible: false });
      expect(question.mock.calls.map((c) => c[2]), verb).toEqual([ASKER, EXPLAINED]);
    }
  });

  it('a write the principal cannot read is decided by the principal\'s READ, where the write\'s own composition admits the row', async () => {
    // Business RLS that narrows the read and not the write: a row the write
    // composition alone admits, and the read excludes.
    const readOnlyRls = (question: ExplainEngineDeps['recordAbsentToCaller']): ExplainEngineDeps => ({
      ...deps(question),
      computeLayeredRlsFilter: async (_s, _o, op) => ({ layer0: null, layer1: op === 'find' ? { name: 'open' } : null }),
    });
    for (const verb of WRITE_VERBS) {
      const input = { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id };
      const writeAlone = await explainFor(readOnlyRls(door()), input, ASKER);
      expect(writeAlone.record, `${verb}, a principal who reads the row`).toMatchObject({ visible: true });
      const unreadable = await explainFor(readOnlyRls(door(EXPLAINED)), input, ASKER);
      expect(unreadable.record, `${verb}, a principal who cannot read the row`).toEqual({ recordId: STORED.id, visible: false, decidedBy: 'rls' });
      const rls = layerRecord(unreadable, 'rls');
      expect(rls?.outcome, verb).toBe('excluded');
      expect(rls?.rowFilter, verb).toEqual({ name: 'open' });
      expect(rls?.detail, verb).toMatch(/^The principal cannot read this record, so its by-id \w+ answers 404 RECORD_NOT_FOUND/);
    }
  });

  it('[#22851] an asker explaining another principal is answered by its own read\'s classification: a refusal is "cannot read"', async () => {
    for (const verb of VERBS) {
      // The door never answers absent, for anyone: only the asker's classified read can say "cannot read".
      const question = door();
      const refused = { context: ASKER, cannotRead: vi.fn(async () => true) };
      const stored = await explainAccessForAsker(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, refused);
      const missing = await explainAccessForAsker(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: 'r_missing' }, refused);
      expect(stored.record, verb).toEqual({ recordId: STORED.id, visible: false });
      expect(withoutRecordId(stored), verb).toEqual(withoutRecordId(missing));
      expect(question.mock.calls.map((c) => c[2]), verb).not.toContain(ASKER);
    }
  });

  it('[#22851] a principal explaining itself is asked the write path\'s question, never the third-party classification', async () => {
    for (const verb of VERBS) {
      const question = door();
      const classified = vi.fn(async () => true);
      const d = await explainAccessForAsker(
        deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, { context: EXPLAINED, cannotRead: classified },
      );
      expect(classified, verb).not.toHaveBeenCalled();
      expect(question.mock.calls.map((c) => c[2]), verb).toEqual([EXPLAINED]);
      expect(d.record, verb).toMatchObject({ recordId: STORED.id, visible: true });
    }
  });

  it('[#22851] a store fault in a third-party asker\'s read fails the explanation', async () => {
    const fault = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    for (const verb of VERBS) {
      await expect(
        explainAccessForAsker(deps(door()), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, {
          context: ASKER, cannotRead: async () => { throw fault; },
        }),
        verb,
      ).rejects.toBe(fault);
    }
  });

  it('a system asker is asked like any other asker: there is no exemption beside the read door\'s own answer', async () => {
    for (const verb of VERBS) {
      const question = door();
      const bySystem = await explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, SYSTEM_CONTEXT);
      expect(question.mock.calls[0][2], verb).toBe(SYSTEM_CONTEXT);
      expect(bySystem.record, verb).toMatchObject({ recordId: STORED.id, visible: true });
    }
  });

  it('a rejection of the asker\'s question fails the explanation: an outage is neither absence nor a row', async () => {
    const fault = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    for (const verb of VERBS) {
      const question = vi.fn(async () => { throw fault; });
      await expect(
        explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, ASKER),
        verb,
      ).rejects.toBe(fault);
    }
  });

  it('an asker the door does not return the row to gets the stored row\'s explanation as the nonexistent id\'s', async () => {
    for (const verb of VERBS) {
      const question = door(ASKER);
      const stored = await explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: STORED.id }, ASKER);
      const missing = await explainFor(deps(question), { object: OBJECT, operation: verb, context: EXPLAINED, recordId: 'r_missing' }, ASKER);
      expect(stored.record, verb).toEqual({ recordId: STORED.id, visible: false });
      expect(withoutRecordId(stored), verb).toEqual(withoutRecordId(missing));
    }
  });
});

/** A system context, held as one object so a call can be told apart by identity. */
const SYSTEM_CONTEXT = { isSystem: true };
