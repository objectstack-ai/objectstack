// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] A write of a `controlled_by_parent` detail refused for want of
 * access on its MASTER record carries the end user's half as `userMessage`:
 * the operation-message catalog's `master_record_edit_denied` (or
 * `master_record_read_denied`, on a detail that asks read), naming the master
 * object's LABEL in the caller's language — the request locale, else the
 * workspace default — beside a `code`, status and `message` that do not move.
 *
 * The console replaces a `403 PERMISSION_DENIED` that carries no `userMessage`
 * with its generic "You don't have permission to save this record.", so before
 * this a user creating a detail under a master they read but cannot edit never
 * learned that the missing access was on the master.
 *
 * Two forms name nothing (`_opaque`): a writer who cannot read the master
 * reference (the refusal's own sentence names no master to them), and a
 * master object with no label (an API name never reaches a user). The CONTROL
 * is the gate's other refusal, the owner rule of a row whose optional master
 * is empty: its sentence is its own and it carries no `userMessage`.
 *
 * Measured with the real security layer on a real `ObjectQL` over a real
 * `SqlDriver`, through the engine's own writes. The console half is pinned in
 * `ui/packages/plugin-form/src/ModalForm.markedRefusal-33524.test.tsx`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES, objectLabelKey, renderOperationMessage } from '@objectstack/spec/system';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID } } as never;
const WRITER = 'usr_writer';
const OTHER = 'usr_other';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const READ_ONLY = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
const GRANTS = {
  '*': CRUD,
  // Masters the writer reads and does not edit: the object-permission leg.
  mue_contract: READ_ONLY,
  mue_vault: READ_ONLY,
  // A master the writer does not read: the read question of an opted-in detail.
  mue_ledger: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
  // Every contact readable, none of them the writer's, no Modify All: the owner rule refuses.
  mue_contact: { ...CRUD, viewAllRecords: true },
};
const READABLE_SET: PermissionSet = PermissionSetSchema.parse({ name: 'mue_readable', label: 'Readable', objects: GRANTS });
/** The same set with the milestone's master reference hidden from its holder. */
const HIDDEN_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'mue_hidden', label: 'Hidden', objects: GRANTS,
  fields: { 'mue_milestone.contract': { readable: false, editable: true } },
});
const SETS = [READABLE_SET, HIDDEN_SET];

const callerOf = (set: PermissionSet, locale?: string, workspaceLocale?: string) => ({
  userId: WRITER, positions: [], permissions: [set.name], posture: 'MEMBER', tenantId: DEFAULT_ORGANIZATION_ID,
  ...(locale ? { locale } : {}),
  ...(workspaceLocale ? { workspaceLocale } : {}),
});

/** The deployment's translations: the contract's label in zh-CN only. */
const TRANSLATIONS: Record<string, Record<string, string>> = {
  'zh-CN': { [objectLabelKey('mue_contract')]: '合同' },
};

/**
 * [#34030] A locale's flat `a.b.c` rows as the nested translation data
 * `II18nService.getTranslations()` hands over — what a refusal's labels are
 * read off, as the metadata route reads them; `t()` keeps answering the
 * sentence overrides.
 */
const nestedRows = (flat: Record<string, string> = {}): Record<string, unknown> => {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = out;
    for (const part of parts.slice(0, -1)) cur = cur[part] ??= {};
    cur[parts[parts.length - 1]] = value;
  }
  return out;
};

const text = (name: string) => ({ name, type: 'text' });
const MASTER_READ_OPT_IN = { sharing: { controlledByParent: { writeRequiresMasterRead: true } } };
const OBJECTS = [
  SysUser,
  { name: 'mue_contract', label: 'Contract', sharingModel: 'public_read_write', fields: { name: text('name') } },
  // A master whose label is its API name: no label to name.
  { name: 'mue_vault', label: 'mue_vault', sharingModel: 'public_read_write', fields: { name: text('name') } },
  { name: 'mue_ledger', label: 'Ledger', sharingModel: 'public_read_write', fields: { name: text('name') } },
  {
    name: 'mue_milestone', label: 'Billing Milestone', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), contract: { name: 'contract', type: 'master_detail', reference: 'mue_contract', required: true } },
  },
  {
    name: 'mue_note', label: 'Note', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), vault: { name: 'vault', type: 'master_detail', reference: 'mue_vault', required: true } },
  },
  {
    name: 'mue_entry', label: 'Entry', sharingModel: 'controlled_by_parent', ...MASTER_READ_OPT_IN,
    fields: { name: text('name'), ledger: { name: 'ledger', type: 'master_detail', reference: 'mue_ledger', required: true } },
  },
  {
    name: 'mue_contact', label: 'Contact', sharingModel: 'controlled_by_parent',
    fields: { name: text('name'), contract: { name: 'contract', type: 'master_detail', reference: 'mue_contract', required: false } },
  },
];

let engine: ObjectQL;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.master-edit-user-message',
    name: 'A master-detail write refusal names the master to its user',
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
    sharing: { canEdit: async () => true },
    i18n: {
      t: (key: string, loc: string) => TRANSLATIONS[loc]?.[key] ?? key,
      getLocales: () => Object.keys(TRANSLATIONS),
      getTranslations: (loc: string) => nestedRows(TRANSLATIONS[loc]),
    },
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
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'mue_readable' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert('sys_user', [WRITER, OTHER].map((id) => ({ id, name: id, email: `${id}@mue.test` })), SYS);
  await engine.insert('mue_contract', [{ id: 'ctr_1', name: 'contract' }], SYS);
  await engine.insert('mue_vault', [{ id: 'vault_1', name: 'vault' }], SYS);
  await engine.insert('mue_ledger', [{ id: 'ledger_1', name: 'ledger' }], SYS);
  await engine.insert('mue_milestone', [{ id: 'ms_1', name: 'milestone', contract: 'ctr_1' }], SYS);
  await engine.insert('mue_note', [{ id: 'note_1', name: 'note', vault: 'vault_1' }], SYS);
  await engine.insert('mue_contact', [{ id: 'ct_orphan', name: 'contact', contract: null, owner_id: OTHER }], SYS);
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** The refusal a write threw; a failure when it was admitted. */
async function refusal(write: Promise<unknown>): Promise<any> {
  try {
    await write;
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused');
}
const insert = (object: string, data: Record<string, unknown>, caller: unknown) =>
  refusal(engine.insert(object, data, { context: { ...(caller as object) } } as never));
const update = (object: string, id: string, data: Record<string, unknown>, caller: unknown) =>
  refusal(engine.update(object, data, { where: { id }, context: { ...(caller as object) } } as never));
const remove = (object: string, id: string, caller: unknown) =>
  refusal(engine.delete(object, { where: { id }, context: { ...(caller as object) } } as never));

const edit = (locale: string, master: string) =>
  renderOperationMessage({ messageKey: 'master_record_edit_denied', params: { master } }, { locale });

/** The envelope the refusal kept: code, status, the diagnostic's opening. */
function expectGateEnvelope(e: any, operation: string, object: string, question = 'edit') {
  expect(e.code).toBe('PERMISSION_DENIED');
  expect(e.statusCode ?? e.status).toBe(403);
  expect(String(e.message)).toMatch(
    new RegExp(`^\\[Security\\] Access denied: ${operation} on '${object}' requires ${question} access to its master record \\(`),
  );
}

describe('master-detail write refusal: the userMessage names the master', () => {
  it('create, en: names the master label', async () => {
    const e = await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(READABLE_SET, 'en'));
    expectGateEnvelope(e, 'insert', 'mue_milestone');
    expect(e.userMessage).toBe(edit('en', 'Contract'));
    expect(e.userMessage).toContain('Contract');
  });

  it('create, zh-CN: names the translated label in the zh-CN sentence', async () => {
    const e = await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(READABLE_SET, 'zh-CN'));
    expectGateEnvelope(e, 'insert', 'mue_milestone');
    expect(e.userMessage).toBe('您需要拥有这条记录所属合同的编辑权限，如需访问请联系该合同的负责人或管理员。');
  });

  it('edit, en and zh-CN: the same sentence for an update of a stored detail', async () => {
    const en = await update('mue_milestone', 'ms_1', { name: 'renamed' }, callerOf(READABLE_SET, 'en'));
    expectGateEnvelope(en, 'update', 'mue_milestone');
    expect(en.userMessage).toBe(edit('en', 'Contract'));
    const zh = await update('mue_milestone', 'ms_1', { name: 'renamed' }, callerOf(READABLE_SET, 'zh-CN'));
    expectGateEnvelope(zh, 'update', 'mue_milestone');
    expect(zh.userMessage).toBe(edit('zh-CN', '合同'));
  });

  it('delete: the lifecycle verb reaches the same refusal and the same sentence', async () => {
    const e = await remove('mue_milestone', 'ms_1', callerOf(READABLE_SET, 'en'));
    expectGateEnvelope(e, 'delete', 'mue_milestone');
    expect(e.userMessage).toBe(edit('en', 'Contract'));
  });

  it('a request language with no text falls back to the workspace default', async () => {
    const e = await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(READABLE_SET, 'de-DE', 'zh-CN'));
    expect(e.userMessage).toBe(edit('zh-CN', '合同'));
  });

  it('no translation in the resolved language: the declared label, in that language\'s sentence', async () => {
    const e = await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(READABLE_SET, 'ja-JP'));
    expect(e.userMessage).toBe(edit('ja-JP', 'Contract'));
  });

  it('the read question: a detail that asks read on its master says read', async () => {
    const e = await insert('mue_entry', { name: 'new', ledger: 'ledger_1' }, callerOf(READABLE_SET, 'en'));
    expectGateEnvelope(e, 'insert', 'mue_entry', 'read');
    expect(e.userMessage).toBe(renderOperationMessage(
      { messageKey: 'master_record_read_denied', params: { master: 'Ledger' } }, { locale: 'en' },
    ));
  });

  it('a writer who cannot read the master reference is named no master', async () => {
    const e = await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(HIDDEN_SET, 'zh-CN'));
    expectGateEnvelope(e, 'insert', 'mue_milestone');
    expect(e.userMessage).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].master_record_edit_denied_opaque);
    expect(e.userMessage).not.toContain('合同');
    expect(String(e.message)).not.toContain('mue_contract');
  });

  it('a master with no label is named by none, never by its API name', async () => {
    const e = await insert('mue_note', { name: 'new', vault: 'vault_1' }, callerOf(READABLE_SET, 'en'));
    expectGateEnvelope(e, 'insert', 'mue_note');
    expect(e.userMessage).toBe(BUILTIN_OPERATION_MESSAGES.en.master_record_edit_denied_opaque);
  });

  it('CONTROL: the owner rule of a row with no master keeps its own sentence and carries no userMessage', async () => {
    const e = await update('mue_contact', 'ct_orphan', { name: 'renamed' }, callerOf(READABLE_SET, 'en'));
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.statusCode ?? e.status).toBe(403);
    expect(String(e.message)).toMatch(/is permitted only to the record's owner or a holder of Modify All/);
    expect('userMessage' in e).toBe(false);
  });

  it('the REST data door relays it: code and status unchanged, userMessage on the body', async () => {
    const answer = mapDataError(
      await insert('mue_milestone', { name: 'new', contract: 'ctr_1' }, callerOf(READABLE_SET, 'zh-CN')),
      'mue_milestone',
    );
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('PERMISSION_DENIED');
    expect(answer.body.userMessage).toBe(edit('zh-CN', '合同'));
  });
});
