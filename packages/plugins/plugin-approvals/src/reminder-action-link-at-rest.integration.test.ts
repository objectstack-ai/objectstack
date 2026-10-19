// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24564] ADR-0043's storage axis — only a token's SHA-256 digest is stored,
 * so a read of the database yields no usable link — holds for the WHOLE
 * database, not only for `sys_approval_token`.
 *
 * A raw action token carries the entire authorization of a decision (ADR-0043):
 * single use, one request, one action, one approver. `sys_approval_token`
 * keeps its digest only, but the guarantee is about storage, so a raw token
 * kept in any other row breaks it just as well. A notification is such a row:
 * messaging stores the payload it is handed — verbatim on `sys_notification`,
 * snapshotted onto each `sys_notification_delivery`. A reminder hands it no
 * action link.
 *
 * ## The rig
 *
 * A real `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory, real DDL), the
 * real `ApprovalsServicePlugin`, and a `messaging` service that records every
 * emit and stores its event row on the REAL `sys_notification` object
 * (`@objectstack/platform-objects`) the way messaging's single ingress does —
 * `payload` verbatim. Every other row messaging writes for a notification (the
 * delivery's payload snapshot, the inbox row, the receipt) is built from that
 * same emit input, so the emit input is the boundary pinned here, beside the
 * stored rows themselves.
 *
 * ## What it pins
 *
 * - live tokens exist — minted directly and held in memory, the way a message
 *   that is sent and not kept would hold them — so every scan below can fail;
 * - after a reminder, no emit input and no row of ANY table holds an
 *   action-page URL, or a string whose SHA-256 is a live token's digest;
 * - the data door's read of `sys_notification`, by a caller it serves every
 *   row to, returns the reminder's event and nothing redeemable in it;
 * - the reminder mints no token at all, and still reaches its approver with
 *   the deep link to the request;
 * - positive control: the action page still decides once with a token held
 *   outside storage, recorded as the bound approver — `actor_id` and
 *   `acted_as` that approver, `via_override` false — and refuses a replay.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysNotification } from '@objectstack/platform-objects/audit';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';

const OBJECT = 'linkrest_invoice';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
/** An organization administrator: the data door serves this caller every row of the notification log. */
const ORG_ADMIN = {
  userId: 'u_org_admin', positions: ['org_admin'], permissions: ['organization_admin'], posture: 'TENANT_ADMIN',
} as any;

const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';

/** What an action-page link looks like in any spelling a row could hold it. */
const ACTION_LINK = /\/approvals\/act|[?&]token=/;
/** A raw token is 32 random bytes, base64url: 43 characters. */
const TOKEN_LENGTH = 43;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Every substring of `text` that could be a raw token whose digest is in
 * `digests` — each 43-character window of each base64url run, and the whole
 * string. A token embedded anywhere (a URL, a JSON payload, a bare column) is
 * found; a digest is 64 hex characters and never its own preimage.
 */
function preimagesIn(text: string, digests: Set<string>): string[] {
  const hits = new Set<string>();
  if (digests.has(sha256(text))) hits.add(text);
  for (const run of text.match(/[A-Za-z0-9_-]{43,}/g) ?? []) {
    for (let i = 0; i + TOKEN_LENGTH <= run.length; i++) {
      const candidate = run.slice(i, i + TOKEN_LENGTH);
      if (digests.has(sha256(candidate))) hits.add(candidate);
    }
  }
  return [...hits];
}

/** Every string a value holds, however deeply (JSON columns arrive parsed or as text). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  svc: ApprovalService;
  protocol: any;
  emitted: any[];
  requestId: string;
  /** Raw tokens held in memory only — the message that is sent and not kept. */
  held: { approve: string; reject: string };
}

let current: ObjectQL | undefined;

afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  current = engine;
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  const sysUser = {
    name: 'sys_user',
    label: 'User',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', label: 'Name', type: 'text' as const },
      email: { name: 'email', label: 'Email', type: 'text' as const },
    },
  };
  const invoice = {
    name: OBJECT,
    label: 'Invoice',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
  };
  for (const def of [
    sysUser, invoice, SysNotification,
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken,
  ]) {
    engine.registry.registerObject(def as any, 'approvals-link-at-rest-test', 'approvals-link-at-rest-test');
  }
  await engine.syncSchemas();
  for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [APPROVER, 'Ada Approver'], [ORG_ADMIN.userId, 'Olga Admin']]) {
    await engine.insert('sys_user', { id, name, email: `${id}@example.com` }, { context: SYSTEM } as any);
  }
  await engine.insert(OBJECT, { id: 'inv_1', title: 'March invoice' }, { context: SYSTEM } as any);

  const emitted: any[] = [];
  const services: Record<string, unknown> = {
    objectql: engine,
    messaging: {
      emit: async (input: any) => {
        emitted.push(input);
        // Messaging's single ingress keeps the event row, `payload` verbatim.
        await engine.insert('sys_notification', {
          topic: input.topic,
          payload: input.payload ?? null,
          severity: input.severity ?? 'info',
          dedup_key: input.dedupKey ?? null,
          source_object: input.source?.object ?? null,
          source_id: input.source?.id ?? null,
          actor_id: input.actorId ?? null,
          organization_id: input.organizationId ?? null,
          created_at: new Date().toISOString(),
        }, { context: SYSTEM } as any);
      },
    },
  };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => {},
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
  };
  await new ApprovalsServicePlugin().start(ctx);
  const svc = services.approvals as ApprovalService;

  const opened: any = await svc.openNodeRequest({
    object: OBJECT, recordId: 'inv_1', runId: 'run_1', nodeId: 'signoff', flowName: 'linkrest_signoff',
    config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: 'inv_1', title: 'March invoice' },
  }, asUser(SUBMITTER));
  const requestId = String(opened.id);
  const held = await svc.issueActionTokens(requestId, APPROVER);

  return {
    engine, driver, svc, emitted, requestId, held,
    protocol: new ObjectStackProtocolImplementation(engine as any),
  };
}

/**
 * The digests of every live token, straight from storage — `token_hash` is
 * `internal`, so the engine's generic read omits it (#21197).
 */
async function liveDigests(rig: Rig): Promise<Set<string>> {
  const rows = (await rig.driver.getKnex()('sys_approval_token').select('token_hash', 'consumed_at')) as any[];
  expect(rows.every((r) => typeof r.token_hash === 'string' && r.token_hash.length === 64)).toBe(true);
  return new Set(rows.filter((r) => !r.consumed_at).map((r) => String(r.token_hash)));
}

/** Every row of every table in the database, straight from the driver. */
async function everyStoredRow(rig: Rig): Promise<Array<{ table: string; row: Record<string, unknown> }>> {
  const knex = rig.driver.getKnex();
  const tables = (await knex('sqlite_master').where({ type: 'table' }).select('name')) as Array<{ name: string }>;
  const out: Array<{ table: string; row: Record<string, unknown> }> = [];
  for (const { name } of tables) {
    if (name.startsWith('sqlite_')) continue;
    for (const row of (await knex(name).select('*')) as Array<Record<string, unknown>>) out.push({ table: name, row });
  }
  return out;
}

describe('a reminder leaves no usable action link in storage (ADR-0043 storage axis)', () => {
  it('no emit input and no stored row holds an action-page URL or the preimage of a live token', async () => {
    const rig = await boot();
    await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));

    const digests = await liveDigests(rig);
    // Not vacuous: the two tokens held in memory are live, and their own text IS found by the scan.
    for (const held of [rig.held.approve, rig.held.reject]) expect(digests.has(sha256(held))).toBe(true);
    expect(preimagesIn(`x?token=${rig.held.approve}&y`, digests)).toEqual([rig.held.approve]);

    const reminders = rig.emitted.filter((e) => e.topic === 'approval.reminder');
    expect(reminders).toHaveLength(1);
    const emitLeaks = rig.emitted.flatMap((e) => stringsOf(e)
      .filter((s) => ACTION_LINK.test(s) || preimagesIn(s, digests).length > 0)
      .map((s) => `${e.topic}: ${s}`));

    const stored = await everyStoredRow(rig);
    // Not vacuous: the reminder's event row is in storage, and so are the token rows.
    expect(stored.some(({ table, row }) => table === 'sys_notification' && row.topic === 'approval.reminder')).toBe(true);
    expect(stored.filter(({ table }) => table === 'sys_approval_token').length).toBeGreaterThanOrEqual(2);
    const storedLeaks = stored.flatMap(({ table, row }) => stringsOf(row)
      .filter((s) => ACTION_LINK.test(s) || preimagesIn(s, digests).length > 0)
      .map((s) => `${table}: ${s}`));

    // Both readings at once: what messaging is handed, and what the database holds.
    expect({ emitLeaks, storedLeaks }).toEqual({ emitLeaks: [], storedLeaks: [] });
  });

  it('the data door serves the notification log with the reminder in it, and nothing redeemable', async () => {
    const rig = await boot();
    await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));
    const digests = await liveDigests(rig);

    const res = await rig.protocol.findData({ object: 'sys_notification', query: {}, context: ORG_ADMIN });
    const rows = (res.records ?? []) as any[];
    const reminder = rows.find((r) => r.topic === 'approval.reminder');
    expect(reminder, 'the door served the reminder event').toBeTruthy();
    expect(reminder.source_id).toBe(rig.requestId);

    const candidates = rows.flatMap((r) => stringsOf(r));
    expect(candidates.filter((s) => ACTION_LINK.test(s))).toEqual([]);
    expect(candidates.flatMap((s) => preimagesIn(s, digests))).toEqual([]);
  });

  it('the reminder mints no token, and reaches its approver with the deep link to the request', async () => {
    const rig = await boot();
    const before = (await liveDigests(rig)).size;
    const out = await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));
    expect(out.notified).toBe(1);
    expect((await liveDigests(rig)).size).toBe(before);

    const [reminder] = rig.emitted.filter((e) => e.topic === 'approval.reminder');
    expect(reminder.audience).toEqual([APPROVER]);
    expect(reminder.payload).toEqual({
      title: 'Approval reminder',
      body: expect.stringContaining('is still waiting on you'),
      actionUrl: `/system/approvals?request=${encodeURIComponent(rig.requestId)}`,
    });
  });
});

describe('positive control: a token held outside storage still decides once, as its approver', () => {
  it('the action page approves as the bound approver, without an override, and refuses a replay', async () => {
    const rig = await boot();
    await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));

    const post = (token: string) => rig.svc.handleActionPage(new Request('http://localhost/api/v1/approvals/act', {
      method: 'POST', body: new URLSearchParams({ token }),
    }));
    const first = await post(rig.held.approve);
    expect(first.status).toBe(200);
    const request: any = await rig.engine.findOne('sys_approval_request', { where: { id: rig.requestId }, context: SYSTEM } as any);
    expect(request?.status).toBe('approved');

    const decisions = (await rig.engine.find('sys_approval_action', {
      where: { request_id: rig.requestId, action: 'approve' }, context: SYSTEM,
    } as any)) as any[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0].actor_id).toBe(APPROVER);
    expect(decisions[0].acted_as).toBe(APPROVER);
    expect(Boolean(decisions[0].via_override)).toBe(false);

    expect(await rig.svc.redeemActionToken(rig.held.approve)).toMatchObject({ ok: false, reason: 'consumed' });
    const after = (await rig.engine.find('sys_approval_action', {
      where: { request_id: rig.requestId, action: 'approve' }, context: SYSTEM,
    } as any)) as any[];
    expect(after).toHaveLength(1);
  });
});
