// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34699] Three refusals the platform writes carry the end user's half as
 * `userMessage`, in the caller's language (the request locale, else the
 * workspace default), beside a `code`, status and `message` that do not move:
 *
 *  - the filter-oracle guard (`403 PERMISSION_DENIED`): a query that filters,
 *    sorts or groups by a field the caller may not read →
 *    `query_field_not_readable`, naming no field;
 *  - the by-id write gate's not-found (`404 RECORD_NOT_FOUND`) →
 *    `record_not_found`, naming no id and no API name;
 *  - the delegated-administration scope refusal
 *    (`403 DELEGATION_SCOPE_VIOLATION`) → `delegation_scope_violation`.
 *
 * Before this, a zh-CN user read each of them in English. The console shows a
 * refusal's `userMessage` in place of its `message` (`readEnvelopeFailureText`
 * in `ui/packages/app-shell/src/utils/apiErrorEnvelope.ts`), and `mapDataError`
 * relays it to the REST body — asserted below on the real classifier.
 *
 * Measured with the real security layer on a real `ObjectQL` over a real
 * `SqlDriver`, through the engine's own reads and writes. The delegated gate's
 * own verdicts are pinned in `delegated-admin-gate.test.ts`; here a stub gate
 * throws the gate's real error class, because what is under test is the
 * middleware that answers it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { mapDataError } from '@objectstack/types';
import { SecurityPlugin } from './security-plugin.js';
import { DelegationScopeViolationError } from './errors.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID } } as never;
const READER = 'usr_reader';

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const SET: PermissionSet = PermissionSetSchema.parse({
  name: 'pru_member',
  label: 'Member',
  objects: { '*': CRUD },
  fields: { 'pru_deal.margin': { readable: false, editable: false } },
});
const SETS = [SET];

const callerOf = (locale?: string, workspaceLocale?: string) => ({
  userId: READER, positions: [], permissions: [SET.name], posture: 'MEMBER', tenantId: DEFAULT_ORGANIZATION_ID,
  ...(locale ? { locale } : {}),
  ...(workspaceLocale ? { workspaceLocale } : {}),
});

const text = (name: string) => ({ name, type: 'text' });
const OBJECTS = [
  SysUser,
  {
    name: 'pru_deal', label: 'Deal', sharingModel: 'public_read_write',
    fields: { name: text('name'), margin: { name: 'margin', type: 'number' } },
  },
  // The object the stub delegated gate refuses every write on.
  { name: 'pru_grant', label: 'Grant', sharingModel: 'public_read_write', fields: { name: text('name') } },
];

const ZH = BUILTIN_OPERATION_MESSAGES['zh-CN'];
const EN = BUILTIN_OPERATION_MESSAGES.en;

let engine: ObjectQL;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.platform-refusal-user-message',
    name: 'Platform refusals carry a userMessage in the caller language',
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
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'pru_member' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  // The stub: the real gate for every object but `pru_grant`, whose every
  // write it refuses as a delegated administrator's out-of-scope write.
  const host = plugin as unknown as { delegatedAdminGate: { assert(opCtx: any): Promise<void> } | null };
  const realGate = host.delegatedAdminGate;
  host.delegatedAdminGate = {
    assert: async (opCtx: any) => {
      if (opCtx.object === 'pru_grant' && !opCtx.context?.isSystem) {
        throw new DelegationScopeViolationError(
          "[Security] Outside your delegated scope: delegated 'insert' on pru_grant rejected — business unit 'bu_west' is outside the delegated subtree.",
          { operation: opCtx.operation, object: opCtx.object },
        );
      }
      await realGate?.assert(opCtx);
    },
  };
  wireEngineSecuritySource(engine, () => plugin);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert('sys_user', [{ id: READER, name: READER, email: `${READER}@pru.test` }], SYS);
  await engine.insert('pru_deal', [{ id: 'deal_1', name: 'deal', margin: 12 }], SYS);
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** The refusal an operation threw; a failure when it was admitted. */
async function refusal(run: Promise<unknown>): Promise<any> {
  try {
    await run;
  } catch (e) {
    return e;
  }
  throw new Error('expected the operation to be refused');
}

describe('the filter-oracle guard: a query on a field the caller may not read', () => {
  const find = (caller: unknown) =>
    refusal(engine.find('pru_deal', { where: { margin: 12 }, context: { ...(caller as object) } } as never));

  it('zh-CN: the Chinese sentence, naming no field; code, status and message unchanged', async () => {
    const e = await find(callerOf('zh-CN'));
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.statusCode ?? e.status).toBe(403);
    expect(String(e.message)).toMatch(/^\[Security\] Access denied: query on 'pru_deal' references field\(s\) not readable by the caller: margin\./);
    expect(e.userMessage).toBe(ZH.query_field_not_readable);
    expect(e.userMessage).not.toContain('margin');
  });

  it('a request locale the catalog does not carry falls to the workspace default, then en', async () => {
    expect((await find(callerOf('xx-YY', 'zh-CN'))).userMessage).toBe(ZH.query_field_not_readable);
    expect((await find(callerOf())).userMessage).toBe(EN.query_field_not_readable);
  });

  it('the REST classifier relays it to the body', async () => {
    const mapped = mapDataError(await find(callerOf('zh-CN'))) as { status: number; body: Record<string, unknown> };
    expect(mapped.status).toBe(403);
    expect(mapped.body.userMessage).toBe(ZH.query_field_not_readable);
  });

  it('CONTROL: a query on readable fields is admitted', async () => {
    const rows = await engine.find('pru_deal', { where: { name: 'deal' }, context: callerOf('zh-CN') } as never);
    expect(rows.length).toBe(1);
  });
});

describe('the by-id write on an id naming no row', () => {
  it('update, zh-CN: 404 RECORD_NOT_FOUND carrying the Chinese sentence, naming no id', async () => {
    const e = await refusal(
      engine.update('pru_deal', { name: 'x' }, { where: { id: 'deal_missing' }, context: callerOf('zh-CN') } as never),
    );
    expect([e.code, e.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    expect(e.message).toBe('Record deal_missing not found in pru_deal');
    expect(e.userMessage).toBe(ZH.record_not_found);
    expect(e.userMessage).not.toContain('deal_missing');
  });

  it('delete, workspace default zh-CN: the Chinese sentence', async () => {
    const e = await refusal(
      engine.delete('pru_deal', { where: { id: 'deal_missing' }, context: callerOf(undefined, 'zh-CN') } as never),
    );
    expect([e.code, e.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    expect(e.userMessage).toBe(ZH.record_not_found);
  });

  it('the REST classifier relays it to the body', async () => {
    const e = await refusal(
      engine.update('pru_deal', { name: 'x' }, { where: { id: 'deal_missing' }, context: callerOf('zh-CN') } as never),
    );
    const mapped = mapDataError(e) as { status: number; body: Record<string, unknown> };
    expect(mapped.status).toBe(404);
    expect(mapped.body.userMessage).toBe(ZH.record_not_found);
  });
});

describe('the delegated-administration scope refusal', () => {
  const insert = (caller: unknown) =>
    refusal(engine.insert('pru_grant', { name: 'g' }, { context: { ...(caller as object) } } as never));

  it('zh-CN: the Chinese sentence beside the gate reason, which does not move', async () => {
    const e = await insert(callerOf('zh-CN'));
    expect([e.code, e.status]).toEqual(['DELEGATION_SCOPE_VIOLATION', 403]);
    expect(String(e.message)).toMatch(/^\[Security\] Outside your delegated scope: /);
    expect(e.userMessage).toBe(ZH.delegation_scope_violation);
    expect(e.userMessage).not.toContain('bu_west');
  });

  it('no locale: the English sentence', async () => {
    expect((await insert(callerOf())).userMessage).toBe(EN.delegation_scope_violation);
  });

  it('the REST classifier relays it to the body with its own code', async () => {
    const mapped = mapDataError(await insert(callerOf('zh-CN'))) as { status: number; body: Record<string, unknown> };
    expect(mapped.status).toBe(403);
    expect(mapped.body.code).toBe('DELEGATION_SCOPE_VIOLATION');
    expect(mapped.body.userMessage).toBe(ZH.delegation_scope_violation);
  });
});
