// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] A write of a `controlled_by_parent` detail is decided by the
 * master its STORED reference names, whatever the writer may read. What the
 * writer's field-level security on that reference decides is the refusal's
 * wording:
 *
 * - a writer who cannot read the master reference is refused with the same
 *   `403 PERMISSION_DENIED`, for the same leg, and a sentence that names no
 *   master object, no master record and no leg of the check;
 * - a writer who can read it keeps the specific refusal, unchanged.
 *
 * Measured with the real security layer on a real `ObjectQL` over a real
 * `SqlDriver`, through the engine's own writes, on every leg the gate refuses
 * with: the master's object permission, its row-level security, its record
 * sharing, a chain leg above the master, and the owner rule of a row whose
 * optional master is empty (asked of the gate itself: no engine write of a
 * writer who cannot read that reference reaches it). Each case runs the same write for two writers whose
 * sets differ ONLY in `readable` on the reference, so the admit/refuse answer is
 * held equal across them. The REST door's wire body is pinned in
 * `packages/rest/src/data-controlled-by-parent-master-refusal-wording.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import type { ControlledByParentWriteOutcome } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID } } as never;
const WRITER = 'usr_writer';
const OTHER = 'usr_other';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const GRANTS = {
  '*': CRUD,
  // The master object leg: read, never edit.
  mrr_vault: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  // Read every campaign, a middle master whose rows are otherwise their
  // owner's, so the writer can address the steps under it, with no Modify All
  // to write it. (Not on a detail whose reference a case hides: View All votes
  // every field of its object readable, which would unmask the reference.)
  mrr_campaign: { ...CRUD, viewAllRecords: true },
};
// The master's row-level security leg: an account in region LOCKED is not
// editable. (The record sharing leg is asked of a master with no authored
// update policy, the ledger: an authored policy that admits the row retracts
// that leg's refusal.)
const RLS = [{ name: 'mrr_account_update', object: 'mrr_account', operation: 'update', using: "record.region != 'LOCKED'" }];
/** Every master reference the writer of the `hidden` set may write and not read. */
const HIDDEN_REFERENCES = {
  'mrr_line.account': { readable: false, editable: true },
  'mrr_entry.ledger': { readable: false, editable: true },
  'mrr_note.vault': { readable: false, editable: true },
  'mrr_step.campaign': { readable: false, editable: true },
  'mrr_contact.account': { readable: false, editable: true },
};
const HIDDEN_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'mrr_hidden', label: 'Reference hidden', objects: GRANTS, rowLevelSecurity: RLS, fields: HIDDEN_REFERENCES,
});
/** The same set, the references readable: the CONTROL. */
const READABLE_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'mrr_readable', label: 'Reference readable', objects: GRANTS, rowLevelSecurity: RLS,
});
const SETS = [HIDDEN_SET, READABLE_SET];

const callerOf = (set: PermissionSet) => ({
  userId: WRITER, positions: [], permissions: [set.name], posture: 'MEMBER', tenantId: DEFAULT_ORGANIZATION_ID,
});
const HIDDEN = callerOf(HIDDEN_SET);
const READABLE = callerOf(READABLE_SET);

const text = (name: string) => ({ name, type: 'text' });
const OBJECTS = [
  SysUser,
  { name: 'mrr_account', label: 'Account', sharingModel: 'public_read_write', fields: { name: text('name'), region: text('region') } },
  { name: 'mrr_vault', label: 'Vault', sharingModel: 'public_read_write', fields: { name: text('name') } },
  { name: 'mrr_ledger', label: 'Ledger', sharingModel: 'public_read_write', fields: { name: text('name') } },
  { name: 'mrr_program', label: 'Program', sharingModel: 'public_read_write', fields: { name: text('name') } },
  {
    name: 'mrr_line', label: 'Line', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), account: { name: 'account', type: 'master_detail', reference: 'mrr_account', required: true } },
  },
  {
    name: 'mrr_entry', label: 'Entry', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), ledger: { name: 'ledger', type: 'master_detail', reference: 'mrr_ledger', required: true } },
  },
  {
    name: 'mrr_note', label: 'Note', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), vault: { name: 'vault', type: 'master_detail', reference: 'mrr_vault', required: true } },
  },
  {
    // A middle master whose OWN master is optional: a campaign with no program
    // is its owner's, so the chain leg above a step asks the owner rule of it.
    name: 'mrr_campaign', label: 'Campaign', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), program: { name: 'program', type: 'master_detail', reference: 'mrr_program', required: false } },
  },
  {
    name: 'mrr_step', label: 'Step', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), campaign: { name: 'campaign', type: 'master_detail', reference: 'mrr_campaign', required: true } },
  },
  {
    name: 'mrr_contact', label: 'Contact', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), account: { name: 'account', type: 'master_detail', reference: 'mrr_account', required: false } },
  },
];

let engine: ObjectQL;
let plugin: SecurityPlugin;
let security: {
  checkControlledByParentWrite(object: string, recordId: string, context?: unknown): Promise<ControlledByParentWriteOutcome>;
  getReadableFields(object: string, context?: unknown): Promise<string[] | undefined>;
};

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.master-reference-unreadable-refusal',
    name: 'A refusal names no master to a writer who cannot read the master reference',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine as never);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? SETS.find((s) => s.name === name) : engine.getSchema(name)) ?? null,
      list: async () => SETS,
    },
    // Record sharing on the master: ledger `ledger_shared` is not editable by anyone.
    sharing: { canEdit: async (object: string, id: string) => !(object === 'mrr_ledger' && id === 'ledger_shared') },
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
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'mrr_readable' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  security = services.security as typeof security;
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert('sys_user', [WRITER, OTHER].map((id) => ({ id, name: id, email: `${id}@mrr.test` })), SYS);
  await engine.insert('mrr_account', [
    { id: 'acc_open', name: 'open', region: 'NA' },
    { id: 'acc_locked', name: 'locked', region: 'LOCKED' },
  ], SYS);
  await engine.insert('mrr_ledger', [{ id: 'ledger_shared', name: 'ledger' }], SYS);
  await engine.insert('mrr_vault', [{ id: 'vault_1', name: 'vault' }], SYS);
  await engine.insert('mrr_line', [
    { id: 'line_open', name: 'line', account: 'acc_open' },
    { id: 'line_locked', name: 'line', account: 'acc_locked' },
  ], SYS);
  await engine.insert('mrr_entry', [{ id: 'entry_shared', name: 'entry', ledger: 'ledger_shared' }], SYS);
  await engine.insert('mrr_note', [{ id: 'note_1', name: 'note', vault: 'vault_1' }], SYS);
  await engine.insert('mrr_campaign', [{ id: 'cmp_orphan', name: 'campaign', program: null, owner_id: OTHER }], SYS);
  await engine.insert('mrr_step', [{ id: 'step_1', name: 'step', campaign: 'cmp_orphan' }], SYS);
  await engine.insert('mrr_contact', [{ id: 'ct_orphan', name: 'contact', account: null, owner_id: OTHER }], SYS);
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** What a write answered: `ok`, or the refusal's code, status, message and details. */
async function answer(write: Promise<unknown>) {
  try {
    await write;
    return { ok: true as const };
  } catch (e) {
    const err = e as { code?: unknown; statusCode?: unknown; status?: unknown; message?: string; details?: unknown };
    return { ok: false as const, code: err.code, status: err.statusCode ?? err.status, message: String(err.message), details: err.details };
  }
}
const update = (object: string, id: string, data: Record<string, unknown>, caller: unknown) =>
  answer(engine.update(object, data, { where: { id }, context: { ...(caller as object) } } as never));
const insert = (object: string, data: Record<string, unknown>, caller: unknown) =>
  answer(engine.insert(object, data, { context: { ...(caller as object) } } as never));
/**
 * The gate itself, asked of a by-id update for `caller` with the caller's own
 * resolved set, as the write path's step 2.8 asks it. Used for the one refusal
 * no engine write of a writer who cannot read the reference reaches: a contact
 * whose optional master is empty is read only by its owner and by View All,
 * and View All on the contact votes the reference readable; the owner may
 * write it.
 */
const gateUpdate = (object: string, id: string, data: Record<string, unknown>, caller: typeof HIDDEN) =>
  answer((plugin as unknown as {
    assertControlledByParentWrite(sets: PermissionSet[], o: string, op: string, opCtx: unknown, ctx: unknown): Promise<void>;
  }).assertControlledByParentWrite(
    [caller === HIDDEN ? HIDDEN_SET : READABLE_SET], object, 'update',
    { object, operation: 'update', options: { where: { id } }, data, context: { ...caller } }, { ...caller },
  ));

const GENERIC = 'requires edit access to its master record (no edit permission on the parent record of this detail)';

/** Each refusal the gate gives, the write that reaches it, and the words only the readable writer may see. */
const REFUSALS: Array<{ leg: string; write: (caller: typeof HIDDEN) => Promise<Awaited<ReturnType<typeof answer>>>; specific: string[] }> = [
  {
    leg: 'object_permission (update)',
    write: (caller) => update('mrr_note', 'note_1', { name: 'edited' }, caller),
    specific: ["no edit permission on master 'mrr_vault'"],
  },
  {
    leg: 'row_level_security (update)',
    write: (caller) => update('mrr_line', 'line_locked', { name: 'edited' }, caller),
    specific: ["master 'mrr_account' not editable by this user (row-level security)"],
  },
  {
    leg: 'record_sharing (update)',
    write: (caller) => update('mrr_entry', 'entry_shared', { name: 'edited' }, caller),
    specific: ["master 'mrr_ledger' not editable by this user (record sharing)"],
  },
  {
    leg: 'master_chain (update)',
    write: (caller) => update('mrr_step', 'step_1', { name: 'edited' }, caller),
    specific: ["master 'mrr_campaign' record 'cmp_orphan' names no master of its own"],
  },
  {
    leg: 'the owner rule of a row whose optional master is empty (update, asked of the gate)',
    write: (caller) => gateUpdate('mrr_contact', 'ct_orphan', { name: 'edited' }, caller),
    specific: ["the record names no master record ('account' is empty)"],
  },
  {
    leg: 'row_level_security (create naming the master)',
    write: (caller) => insert('mrr_line', { name: 'new', account: 'acc_locked' }, caller),
    specific: ["master 'mrr_account' not editable by this user (row-level security)"],
  },
];

describe('[ADR-0055 §3] a writer who cannot read the master reference is refused without the master named', () => {
  it('the readings the cases start from: the hidden writer cannot read the reference, the control writer can', async () => {
    for (const ref of Object.keys(HIDDEN_REFERENCES)) {
      const [object, field] = ref.split('.');
      expect(await security.getReadableFields(object, { ...HIDDEN }), ref).not.toContain(field);
      expect(await security.getReadableFields(object, { ...READABLE }), ref).toContain(field);
    }
  });

  it.each(REFUSALS)('$leg: same code and status, a sentence that names no master, no leg and no master id', async ({ write, specific }) => {
    const refused = await write(HIDDEN);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect({ code: refused.code, status: refused.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toContain(GENERIC);
    for (const words of specific) expect(refused.message).not.toContain(words);
    expect(refused.message).not.toMatch(/mrr_account|mrr_vault|mrr_ledger|mrr_campaign|acc_|vault_1|ledger_shared|cmp_orphan|row-level security|record sharing|'account'|'vault'|'ledger'|'campaign'|is empty/);
    expect(JSON.stringify(refused.details ?? {})).not.toMatch(/acc_|vault_1|ledger_shared|cmp_orphan|mrr_account|mrr_vault|mrr_ledger|mrr_campaign/);
  });

  it.each(REFUSALS)('$leg: CONTROL — a writer who can read the reference keeps the specific refusal', async ({ write, specific }) => {
    const refused = await write(READABLE);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect({ code: refused.code, status: refused.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    for (const words of specific) expect(refused.message).toContain(words);
    expect(refused.message).not.toContain('no edit permission on the parent record of this detail');
  });

  it('the decision follows the stored master for both writers: the same writes are admitted and refused', async () => {
    const admitted = [
      () => update('mrr_line', 'line_open', { name: 'edited' }, HIDDEN),
      () => update('mrr_line', 'line_open', { name: 'edited again' }, READABLE),
      () => insert('mrr_line', { name: 'new', account: 'acc_open' }, HIDDEN),
      () => insert('mrr_line', { name: 'new', account: 'acc_open' }, READABLE),
    ];
    for (const write of admitted) expect(await write()).toEqual({ ok: true });
    for (const { write } of REFUSALS) {
      const [hidden, readable] = [await write(HIDDEN), await write(READABLE)];
      expect([hidden.ok, readable.ok]).toEqual([false, false]);
    }
  });

  it('the served check names the same leg for both writers', async () => {
    for (const [object, id] of [['mrr_note', 'note_1'], ['mrr_line', 'line_locked'], ['mrr_entry', 'entry_shared'], ['mrr_step', 'step_1'], ['mrr_contact', 'ct_orphan'], ['mrr_line', 'line_open']]) {
      const hidden = await security.checkControlledByParentWrite(object, id, { ...HIDDEN });
      const readable = await security.checkControlledByParentWrite(object, id, { ...READABLE });
      expect(hidden, `${object} ${id}`).toEqual(readable);
    }
    expect(await security.checkControlledByParentWrite('mrr_note', 'note_1', { ...HIDDEN })).toEqual({ outcome: 'deny', leg: 'object_permission' });
    expect(await security.checkControlledByParentWrite('mrr_line', 'line_open', { ...HIDDEN })).toEqual({ outcome: 'allow' });
  });

  it('fails closed to the rule-level sentence when the writer\'s field-level security cannot be resolved', async () => {
    // The plugin's own projection, which the gate asks through the plugin.
    const spy = vi.spyOn(plugin, 'getReadableFields');
    try {
      spy.mockRejectedValueOnce(new Error('posture store unavailable'));
      const threw = await update('mrr_line', 'line_locked', { name: 'edited' }, READABLE);
      spy.mockResolvedValueOnce(undefined);
      const unresolved = await update('mrr_line', 'line_locked', { name: 'edited' }, READABLE);
      for (const refused of [threw, unresolved]) {
        expect(refused.ok).toBe(false);
        if (refused.ok) continue;
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
        expect(refused.message).toContain(GENERIC);
        expect(refused.message).not.toContain('mrr_account');
      }
    } finally {
      spy.mockRestore();
    }
  });
});
