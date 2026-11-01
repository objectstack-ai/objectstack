// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27908 — maintainer ruling 6513869839 on #27681, parameter 3] The
 * `action_invocation` writer stores a REAL, READ-BACK ledger row that names the
 * door the action came through.
 *
 * Every assertion reads the row back through a real ObjectQL engine, for the
 * reason `auth-event-audit.test.ts` records: every `sys_audit_log` field is
 * `readonly` and `validateRecord` skips readonly fields, so "the call did not
 * throw" is equally true when the row landed right, landed wrong, or was never
 * attempted. The door side — that both action doors hand this writer one event
 * per invocation on every branch — is `runtime/src/action-invocation-audit.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  ACTION_INVOCATION_AUDIT_ACTION,
  buildActionInvocationAuditRow,
  createActionInvocationAuditWriter,
  type ActionInvocationAuditEvent,
} from './action-invocation-audit.js';
import { SysAuditLog } from './objects/index.js';

const OWNER_PACKAGE = 'com.objectstack.test.action-invocation-audit';

/** The ledger as every stack registers it since ADR-0131 D7 (no organization column). */
const ledger = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  systemFields: { tenant: false },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    action: { name: 'action', label: 'Action', type: 'text' as const },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    actor: { name: 'actor', label: 'Actor', type: 'text' as const },
    object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
    record_id: { name: 'record_id', label: 'Record', type: 'text' as const },
    old_value: { name: 'old_value', label: 'Old', type: 'textarea' as const },
    new_value: { name: 'new_value', label: 'New', type: 'textarea' as const },
    tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' as const },
    metadata: { name: 'metadata', label: 'Metadata', type: 'textarea' as const },
  },
};

/** Minimal in-memory driver — the `auth-event-audit.test.ts` shape. */
function makeMemoryDriver(opts: { failCreate?: Error } = {}) {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) {
      s = new Map();
      stores.set(obj, s);
    }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {} as any,
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      if (opts.failCreate) throw opts.failCreate;
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update() {
      return null;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      return this.create(object, data);
    },
    async delete() {
      return false;
    },
    async count(object: string, ast: any) {
      return (await this.find(object, ast)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async updateMany() {
      return 0;
    },
    async beginTransaction() {
      return { commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return { driver };
}

async function boot(opts: { failCreate?: Error } = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(makeMemoryDriver(opts).driver, true);
  await engine.init();
  engine.registry.registerObject(ledger as any, OWNER_PACKAGE);
  return engine;
}

async function ledgerRows(engine: any) {
  return (await engine.find('sys_audit_log', { where: { action: ACTION_INVOCATION_AUDIT_ACTION } }, {
    context: { isSystem: true },
  })) as any[];
}

const CLICK: ActionInvocationAuditEvent = {
  context: { userId: 'usr_1', tenantId: 'org_1', surface: 'rest' },
  actionName: 'close_case',
  objectName: 'crm_case',
  recordId: 'case_1',
  branch: 'update',
  outcome: 'succeeded',
};

const AGENT: ActionInvocationAuditEvent = {
  context: { userId: 'usr_1', tenantId: 'org_1', surface: 'mcp', performedBy: { clientId: 'cli_agent' } },
  actionName: 'close_case',
  objectName: 'crm_case',
  recordId: 'case_1',
  branch: 'update',
  outcome: 'succeeded',
};

describe('[#27908] the action_invocation row tells an agent\'s call from a click', () => {
  it('a click and an agent\'s call of the same action land as two rows that differ by surface and performer', async () => {
    const engine = await boot();
    const writer = createActionInvocationAuditWriter({ getEngine: () => engine as any });

    await writer.recordActionInvocation(CLICK);
    await writer.recordActionInvocation(AGENT);

    const rows = await ledgerRows(engine);
    expect(rows).toHaveLength(2);
    const [click, agent] = rows.map((r) => ({ ...r, meta: JSON.parse(r.metadata) }));
    for (const row of [click, agent]) {
      expect(row.action).toBe('action_invocation');
      expect(row.user_id).toBe('usr_1');
      expect(row.actor).toBe('usr_1');
      expect(row.object_name).toBe('crm_case');
      expect(row.record_id).toBe('case_1');
      expect(row.tenant_id).toBe('org_1');
      expect(row.old_value ?? null).toBeNull();
      expect(row.new_value ?? null).toBeNull();
    }
    expect(click.meta).toEqual({ surface: 'rest', action_name: 'close_case', branch: 'update', outcome: 'succeeded' });
    expect(agent.meta).toEqual({
      surface: 'mcp', action_name: 'close_case', branch: 'update', outcome: 'succeeded',
      performed_by: 'cli_agent', on_behalf_of: 'usr_1',
    });
  });

  it('a refused invocation records the status and machine code; a resume records the run', async () => {
    const engine = await boot();
    const writer = createActionInvocationAuditWriter({ getEngine: () => engine as any });

    await writer.recordActionInvocation({
      ...AGENT, branch: 'flow', outcome: 'failed', status: 400, errorCode: 'FLOW_FAILED', runId: 'run_7',
    });

    const [row] = await ledgerRows(engine);
    expect(JSON.parse(row.metadata)).toMatchObject({
      surface: 'mcp', branch: 'flow', outcome: 'failed', status: 400, error_code: 'FLOW_FAILED', run_id: 'run_7',
    });
  });

  it('[#28281] an api forward\'s two rows name each other: the outer row its target, the inner row the forward', async () => {
    const engine = await boot();
    const writer = createActionInvocationAuditWriter({ getEngine: () => engine as any });

    await writer.recordActionInvocation({
      context: { userId: 'usr_1', tenantId: 'org_1', surface: 'rest' },
      actionName: 'nudge_case', objectName: 'crm_case', recordId: 'case_1', branch: 'script', outcome: 'succeeded',
      forwardedFrom: 'crm_case/forward_case',
    });
    await writer.recordActionInvocation({
      ...AGENT, actionName: 'forward_case', branch: 'api', target: '/api/v1/actions/crm_case/nudge_case',
    });

    const [inner, outer] = (await ledgerRows(engine)).map((r) => JSON.parse(r.metadata));
    expect(inner).toEqual({
      surface: 'rest', action_name: 'nudge_case', branch: 'script', outcome: 'succeeded',
      forwarded_from: 'crm_case/forward_case',
    });
    expect(outer).toEqual({
      surface: 'mcp', action_name: 'forward_case', branch: 'api', outcome: 'succeeded',
      target: '/api/v1/actions/crm_case/nudge_case', performed_by: 'cli_agent', on_behalf_of: 'usr_1',
    });
  });

  it('[#28281] a target is recorded only on the api branch', () => {
    const row = buildActionInvocationAuditRow({ ...CLICK, branch: 'flow', target: 'escalate_flow' });
    expect('target' in JSON.parse(String(row.metadata))).toBe(false);
  });

  it('an object-less action names no object and no record', () => {
    const row = buildActionInvocationAuditRow({ ...CLICK, objectName: undefined, recordId: 'r1' });
    expect(row.object_name).toBeNull();
    expect(row.record_id).toBeNull();
  });

  it('an envelope that names no surface records none — the writer never guesses one', () => {
    const row = buildActionInvocationAuditRow({ ...CLICK, context: { userId: 'usr_1' } });
    expect(JSON.parse(String(row.metadata)).surface).toBeNull();
  });

  it('an older ledger with no `actor` column is written without one', () => {
    const row = buildActionInvocationAuditRow(CLICK, () => false);
    expect('actor' in row).toBe(false);
  });

  it('a lost row is reported once per cause at `error`, and the writer never throws', async () => {
    const engine = await boot({ failCreate: Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' }) });
    const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const writer = createActionInvocationAuditWriter({ getEngine: () => engine as any, logger });

    await expect(writer.recordActionInvocation(CLICK)).resolves.toBeUndefined();
    await expect(writer.recordActionInvocation(AGENT)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain('Action-invocation audit write FAILED');
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('the value it writes is declared by sys_audit_log.action', () => {
    const options = ((SysAuditLog as any).fields.action.options ?? []).map((o: any) => (typeof o === 'string' ? o : o.value));
    expect(options).toContain(ACTION_INVOCATION_AUDIT_ACTION);
  });
});
