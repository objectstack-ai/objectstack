// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The owner-anchor, queue and field-write 403s carry a `userMessage`: the end
 * user's half, rendered from the shared operation-message catalog in the
 * caller's locale, beside a `code`, status and `message` that do not move.
 *
 * The console replaces every `403 PERMISSION_DENIED` without a `userMessage`
 * with its own generic "no permission" toast, so before this a console user
 * never learned what was refused. `mapDataError` (`@objectstack/types`) is the
 * REST data door's mapper for `POST` / `PATCH /data/:object`, and the last
 * describe pins that the text arrives on that body.
 *
 * The object-level grant refusal is the CONTROL: it is ruled nameless and its
 * catalog sentence is already its `message`, so it carries no `userMessage`.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES, objectFieldLabelKey, renderOperationMessage } from '@objectstack/spec/system';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { CLAIM_REFUSAL, INSERT_QUEUE_REFUSAL, MOVE_REFUSAL, RELEASE_REFUSAL } from './ownership-queue-gate.js';

const runEngineWriteBody = async (opCtx: any): Promise<void> => {
  const seam = opCtx?.postHookWriteImageCheck;
  if (!seam) return;
  seam.honoured = true;
  if (opCtx.operation === 'update') {
    await seam.evaluate([]);
    return;
  }
  await seam.evaluate(Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data]);
};

const memberSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: {
    'case.salary': { readable: true, editable: false },
    'case.grade': { readable: true, editable: false },
    'case.ssn': { readable: false, editable: false },
    'case.code_name': { readable: true, editable: false },
  },
} as any;
const readOnlySet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true } },
} as any;

const QUEUES: Record<string, string[]> = { support_intake: ['u2'], billing: ['u9'] };

/** Field definitions: `code_name` has no label, `salary` / `grade` / `ssn` have one. */
const FIELDS: Record<string, any> = {
  id: { name: 'id' },
  organization_id: { name: 'organization_id' },
  owner_id: { name: 'owner_id', label: 'Owner' },
  queue: { name: 'queue', label: 'Queue' },
  name: { name: 'name', label: 'Name' },
  salary: { name: 'salary', label: 'Salary' },
  grade: { name: 'grade', label: 'Grade' },
  ssn: { name: 'ssn', label: 'Social Security Number' },
  code_name: { name: 'code_name' },
};

/** The deployment's translations: `salary`'s label in zh-CN only. */
const TRANSLATIONS: Record<string, Record<string, string>> = {
  'zh-CN': { [objectFieldLabelKey('case', 'salary')]: '薪资' },
};

const boot = async (opts: { sets: PermissionSet[]; row?: Record<string, unknown> | null; verdict?: 'allow' | 'deny' | 'abstain' }) => {
  const schema: any = { name: 'case', label: 'Case', fields: FIELDS };
  let middleware: any;
  const findOne = vi.fn(async (object: string, query: any) => {
    assertEngineFindOnePredicate(object, query as EngineFindOneQueryInput);
    return opts.row ? { ...opts.row } : null;
  });
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => schema,
    findOne,
    find: vi.fn(async () => [] as Record<string, unknown>[]),
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => schema, list: async () => opts.sets },
    sharing: { checkEdit: vi.fn(async () => opts.verdict ?? 'abstain'), checkDelete: vi.fn(async () => 'abstain') },
    'ownership-queue': {
      resolveQueue: vi.fn(async (name: string, org: string | null) =>
        org && QUEUES[name] ? { name, label: name, source: 'authored', organizationId: org, members: [] } : null),
      isMember: vi.fn(async (userId: string, name: string) => !!QUEUES[name]?.includes(userId)),
    },
    i18n: { t: (key: string, loc: string) => TRANSLATIONS[loc]?.[key] ?? key },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  /** The refusal the middleware throws for `opCtx`, or a failure when it admits it. */
  return async (opCtx: any): Promise<any> => {
    try {
      await middleware(opCtx, () => runEngineWriteBody(opCtx));
    } catch (refusal) {
      return refusal;
    }
    throw new Error('expected a refusal, the write was admitted');
  };
};

const as = (locale: string, userId = 'u1') =>
  ({ userId, tenantId: 'org-1', positions: [], permissions: [], locale });
const update = (data: Record<string, unknown>, locale: string) =>
  ({ object: 'case', operation: 'update', data: { id: 'c1', ...data }, context: as(locale) });
const insert = (data: Record<string, unknown>, locale: string) =>
  ({ object: 'case', operation: 'insert', data, context: as(locale) });

const OWNED_BY_U1 = { id: 'c1', owner_id: 'u1', queue: null, organization_id: 'org-1' };
const SITTING = { id: 'c1', owner_id: null, queue: 'support_intake', organization_id: 'org-1' };

const ownerSentence = (action: string) =>
  `[Security] Access denied: 'owner_id' on 'case' is system-managed — ${action} requires the transfer grant ` +
  '(allowTransfer or modifyAllRecords)';
const changeSentence = (condition: string) =>
  `[Security] Access denied: 'owner_id' on 'case' is system-managed — ${condition}; any other change of ownership ` +
  'requires the transfer grant (allowTransfer or modifyAllRecords)';
const queueSentence = (condition: string) =>
  `[Security] Access denied: 'queue' on 'case' is system-managed — ${condition} (allowTransfer or modifyAllRecords)`;

/** One row per refusal class: the request, the row it reads, the unchanged `message`, the catalog key. */
const CLASSES: Array<{
  name: string;
  opCtx: (locale: string) => any;
  row: Record<string, unknown> | null;
  verdict?: 'deny';
  message: string;
  key: string;
}> = [
  {
    name: 'changing the owner (a transfer)',
    opCtx: (l) => update({ owner_id: 'u2' }, l),
    row: OWNED_BY_U1,
    message: ownerSentence('changing record ownership on update'),
    key: 'record_owner_change_denied',
  },
  {
    name: 'changing the owner (a claim the sharing model does not admit)',
    opCtx: (l) => update({ owner_id: 'u1' }, l),
    row: SITTING,
    verdict: 'deny',
    message: changeSentence(CLAIM_REFUSAL),
    key: 'record_owner_change_denied',
  },
  {
    name: 'creating a record for someone else',
    opCtx: (l) => insert({ name: 'A', owner_id: 'u2' }, l),
    row: null,
    message: ownerSentence('creating a record owned by another user'),
    key: 'record_owner_assign_denied',
  },
  {
    name: 'disowning',
    opCtx: (l) => update({ owner_id: null }, l),
    row: { ...OWNED_BY_U1, owner_id: 'u3' },
    message: ownerSentence('changing record ownership on update'),
    key: 'record_owner_remove_denied',
  },
  {
    name: 'disowning (a release with no queue to go back to)',
    opCtx: (l) => update({ owner_id: null }, l),
    row: OWNED_BY_U1,
    message: changeSentence(RELEASE_REFUSAL),
    key: 'record_owner_remove_denied',
  },
  {
    name: 'a queue write (moving between queues)',
    opCtx: (l) => update({ queue: 'billing' }, l),
    row: SITTING,
    message: queueSentence(MOVE_REFUSAL),
    key: 'record_queue_change_denied',
  },
  {
    name: 'a queue write (creating into a queue the caller is not in)',
    opCtx: (l) => insert({ name: 'A', queue: 'billing' }, l),
    row: null,
    message: queueSentence(INSERT_QUEUE_REFUSAL),
    key: 'record_queue_assign_denied',
  },
];

describe('the owner-anchor and queue 403s carry the catalog userMessage in the caller\'s locale', () => {
  for (const c of CLASSES) {
    for (const locale of ['en', 'zh-CN'] as const) {
      it(`${c.name} — ${locale}`, async () => {
        const refuse = await boot({ sets: [memberSet], row: c.row, verdict: c.verdict });
        const refusal = await refuse(c.opCtx(locale));
        expect(refusal.code).toBe('PERMISSION_DENIED');
        expect(refusal.status).toBe(403);
        // The developer sentence is untouched, byte for byte.
        expect(refusal.message).toBe(c.message);
        expect(refusal.userMessage).toBe(BUILTIN_OPERATION_MESSAGES[locale][c.key]);
      });
    }
  }

  it('no userMessage names a grant or an API name', () => {
    for (const c of CLASSES) {
      for (const locale of Object.keys(BUILTIN_OPERATION_MESSAGES)) {
        const text = BUILTIN_OPERATION_MESSAGES[locale][c.key];
        expect(text).toBeDefined();
        expect(text).not.toMatch(/allowTransfer|modifyAllRecords|owner_id|_id\b/);
      }
    }
  });
});

describe('the field-write 403 names field labels only where the caller may learn them', () => {
  const fieldWriteMessage = (fields: string[]) =>
    `[Security] Field write denied: not permitted to edit [${fields.join(', ')}] on 'case'`;
  const render = (messageKey: string, locale: string, params?: Record<string, unknown>) =>
    renderOperationMessage({ messageKey, params }, { locale });

  it('names the declared label of a readable field (en)', async () => {
    const refuse = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const refusal = await refuse(update({ grade: 'A' }, 'en'));
    expect(refusal.code).toBe('PERMISSION_DENIED');
    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe(fieldWriteMessage(['grade']));
    expect(refusal.userMessage).toBe(render('field_edit_denied', 'en', { fields: '“Grade”' }));
  });

  it('names the translated label, in the caller\'s locale, and lists several (zh-CN)', async () => {
    const refuse = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const refusal = await refuse(update({ salary: 1, grade: 'A' }, 'zh-CN'));
    expect(refusal.message).toBe(fieldWriteMessage(['grade', 'salary']));
    expect(refusal.userMessage).toBe(render('field_edit_denied', 'zh-CN', { fields: '「Grade」、「薪资」' }));
  });

  it('names no field when one refused field has no label — never the API name', async () => {
    const refuse = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const refusal = await refuse(update({ grade: 'A', code_name: 'x' }, 'en'));
    expect(refusal.message).toBe(fieldWriteMessage(['code_name', 'grade']));
    expect(refusal.userMessage).toBe(BUILTIN_OPERATION_MESSAGES.en.field_edit_denied_opaque);
    expect(refusal.userMessage).not.toContain('code_name');
  });

  it('names no field when one refused field is one the caller cannot read (zh-CN)', async () => {
    const refuse = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const refusal = await refuse(update({ salary: 1, ssn: '1' }, 'zh-CN'));
    expect(refusal.userMessage).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].field_edit_denied_opaque);
    expect(refusal.userMessage).not.toContain('Social Security Number');
  });

  it('CONTROL: the object-level grant refusal stays nameless and gains no userMessage', async () => {
    const refuse = await boot({ sets: [readOnlySet], row: OWNED_BY_U1 });
    const refusal = await refuse(update({ grade: 'A' }, 'zh-CN'));
    expect(refusal.code).toBe('PERMISSION_DENIED');
    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
    expect('userMessage' in refusal).toBe(false);
  });
});

describe('the userMessage reaches the REST data door body (mapDataError, POST / PATCH /data/:object)', () => {
  it('a PATCH transfer: 403 PERMISSION_DENIED, the developer error unchanged, userMessage beside it', async () => {
    const refuse = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const answer = mapDataError(await refuse(update({ owner_id: 'u2' }, 'zh-CN')), 'case');
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('PERMISSION_DENIED');
    expect(answer.body.error).toBe(ownerSentence('changing record ownership on update'));
    expect(answer.body.userMessage).toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].record_owner_change_denied);
  });

  it('a POST field write: the label sentence arrives', async () => {
    const refuse = await boot({ sets: [memberSet], row: null });
    const answer = mapDataError(await refuse(insert({ name: 'A', grade: 'A' }, 'en')), 'case');
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('PERMISSION_DENIED');
    expect(answer.body.userMessage).toBe(renderOperationMessage(
      { messageKey: 'field_edit_denied', params: { fields: '“Grade”' } }, { locale: 'en' },
    ));
  });

  it('CONTROL: the object-level refusal carries no userMessage on the body', async () => {
    const refuse = await boot({ sets: [readOnlySet], row: OWNED_BY_U1 });
    const answer = mapDataError(await refuse(update({ grade: 'A' }, 'en')), 'case');
    expect(answer.status).toBe(403);
    expect('userMessage' in answer.body).toBe(false);
  });
});

/**
 * The queue refusal splits its user sentence by verb: a create into a queue the
 * caller does not belong to renders `record_queue_assign_denied`, a change of an
 * existing record's queue keeps `record_queue_change_denied`. Only `userMessage`
 * differs between them; everything else on the wire is the refusal it was
 * before the split, read here off the REST data door's body.
 */
describe('the queue 403 on the wire: a sentence per verb, nothing else moves', () => {
  const PATHS = [
    {
      name: 'POST, creating into a queue the caller is not in',
      opCtx: (l: string) => insert({ name: 'A', queue: 'billing' }, l),
      row: null,
      operation: 'insert',
      message: queueSentence(INSERT_QUEUE_REFUSAL),
      key: 'record_queue_assign_denied',
    },
    {
      name: 'PATCH, moving a record to another queue',
      opCtx: (l: string) => update({ queue: 'billing' }, l),
      row: SITTING,
      operation: 'update',
      message: queueSentence(MOVE_REFUSAL),
      key: 'record_queue_change_denied',
    },
  ] as const;

  for (const p of PATHS) {
    for (const locale of Object.keys(BUILTIN_OPERATION_MESSAGES)) {
      it(`${p.name} — ${locale}`, async () => {
        const refuse = await boot({ sets: [memberSet], row: p.row });
        const refusal = await refuse(p.opCtx(locale));
        // The thrown refusal: code, status, message and details as before.
        expect({
          code: refusal.code,
          status: refusal.status,
          message: refusal.message,
          details: refusal.details,
        }).toEqual({
          code: 'PERMISSION_DENIED',
          status: 403,
          message: p.message,
          details: { operation: p.operation, object: 'case', positions: [], permissionSets: [] },
        });
        // The wire body: every member but `userMessage` as before.
        const answer = mapDataError(refusal, 'case');
        const { userMessage, ...rest } = answer.body;
        expect({ status: answer.status, body: rest }).toEqual({
          status: 403,
          body: { code: 'PERMISSION_DENIED', error: p.message, object: 'case' },
        });
        expect(userMessage).toBe(BUILTIN_OPERATION_MESSAGES[locale][p.key]);
      });
    }
  }

  it('the two verbs render different sentences in every locale', () => {
    const locales = Object.keys(BUILTIN_OPERATION_MESSAGES);
    expect(locales.length).toBeGreaterThanOrEqual(4);
    for (const locale of locales) {
      const create = BUILTIN_OPERATION_MESSAGES[locale].record_queue_assign_denied;
      expect(create, `${locale} defines record_queue_assign_denied`).toBeTypeOf('string');
      expect(create, locale).not.toBe(BUILTIN_OPERATION_MESSAGES[locale].record_queue_change_denied);
    }
  });
});
