// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A decision or a comment attaches only files its caller uploaded.
 *
 * Both doors that take `attachments` — a decision (approve / reject) and a
 * comment on the thread — accept an id only when it names a file of the
 * request's organization that the caller uploaded. Every other id is refused
 * before anything is written, and every refusal is the same answer
 * (`VALIDATION_FAILED`, the prefix the REST door maps to 400): a file someone
 * else uploaded, an id that names no file, a file the caller uploaded in
 * another organization, a list mixing the caller's own file with another, and
 * a value that is not a list of ids. Nothing tells those apart.
 *
 * Controls: the caller's own upload is attached on both doors, and a system
 * caller (whose inputs are server-minted) is not judged.
 *
 * ## The rig
 *
 * A real ObjectQL engine over better-sqlite3 under the `isolated` posture with
 * two organizations, the real `ApprovalsServicePlugin.start()`. The one
 * stand-in is the file store's row: a `sys_file` object carrying the columns
 * the rule reads (`owner_id`, and the organization the registry provisions).
 * The membership store answers the fixture's memberships.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
/** Uploaded the other organization-A file; takes no part in any request. */
const COLLEAGUE = 'u_colleague';
const MEMBERSHIPS = [
  { user_id: SUBMITTER, organization_id: ORG_A },
  { user_id: SUBMITTER, organization_id: ORG_B },
  { user_id: APPROVER, organization_id: ORG_A },
  { user_id: APPROVER, organization_id: ORG_B },
  { user_id: COLLEAGUE, organization_id: ORG_A },
];

/** Uploaded by the submitter, in organization A. */
const F_SUBMITTER_OWN = 'f_submitter_own';
/** Uploaded by the approver, in organization A. */
const F_APPROVER_OWN = 'f_approver_own';
/** Uploaded by a colleague, in organization A. */
const F_COLLEAGUE = 'f_colleague';
/** Uploaded by the submitter, in organization B. */
const F_SUBMITTER_ORG_B = 'f_submitter_org_b';
/** Uploaded by the approver, in organization B. */
const F_APPROVER_ORG_B = 'f_approver_org_b';
/** Names no file at all. */
const F_NOWHERE = 'f_nowhere';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, tenantId: ORG_A, positions: [], permissions: [] }) as any;

let current: ObjectQL | undefined;
afterEach(async () => {
  try { await current?.destroy(); } catch { /* noop */ }
  current = undefined;
});

function membershipsWhere(where: unknown): Array<Record<string, unknown>> {
  const w = (where ?? {}) as Record<string, unknown>;
  return MEMBERSHIPS.filter((m) => Object.entries(w).every(([k, v]) => {
    const own = (m as Record<string, unknown>)[k];
    const set = (v as { $in?: unknown[] } | null)?.$in;
    return Array.isArray(set) ? set.includes(own) : own === v;
  }));
}

async function boot() {
  const engine = new ObjectQL();
  current = engine;
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.setTenancyPostureProvider(() => 'isolated');
  const owner = 'approvals-decision-attachments-test';
  const objects = [
    { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } },
    { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } } },
    { name: 'sys_file', label: 'File', fields: { name: { type: 'text', label: 'Name' }, owner_id: { type: 'text', label: 'Uploaded by' } } },
    { name: 'exam_sheet', label: 'Exam Sheet', fields: { title: { type: 'text', label: 'Title' } } },
    SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation,
  ];
  for (const def of objects) engine.registry.registerObject(def as any, owner, owner);
  await engine.syncSchemas();
  for (const id of [ORG_A, ORG_B]) {
    await (engine.getDriverForObject('sys_organization') as any).create('sys_organization', { id, name: id });
  }
  for (const id of [SUBMITTER, APPROVER, COLLEAGUE]) {
    await (engine.getDriverForObject('sys_user') as any).create('sys_user', { id, name: id, email: `${id}@example.test` });
  }
  const files: Array<[string, string, string]> = [
    [F_SUBMITTER_OWN, SUBMITTER, ORG_A],
    [F_APPROVER_OWN, APPROVER, ORG_A],
    [F_COLLEAGUE, COLLEAGUE, ORG_A],
    [F_SUBMITTER_ORG_B, SUBMITTER, ORG_B],
    [F_APPROVER_ORG_B, APPROVER, ORG_B],
  ];
  for (const [id, uploader, org] of files) {
    await engine.insert('sys_file', { id, name: `${id}.pdf`, owner_id: uploader } as any, { context: { isSystem: true, tenantId: org } } as any);
  }

  // The kernel's data engine, except that the membership store this fixture
  // never registers answers the fixture's memberships.
  const dataEngine = new Proxy(engine, {
    get(target, prop) {
      if (prop === 'find') {
        return (object: string, query?: EngineQueryOptions, options?: unknown) => (target.getSchema(object)
          ? target.find(object, query, options as never)
          : Promise.resolve(object === 'sys_member' ? membershipsWhere(query?.where) : []));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const services: Record<string, unknown> = { objectql: dataEngine };
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

  let n = 0;
  const open = async (): Promise<string> => {
    const recordId = `sheet_${++n}`;
    await engine.insert('exam_sheet', { id: recordId, title: recordId } as any, { context: { isSystem: true, tenantId: ORG_A } } as any);
    const opened: any = await svc.openNodeRequest({
      object: 'exam_sheet', recordId, runId: `run_${n}`, nodeId: 'review', flowName: 'exam_review',
      config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
      submitterId: SUBMITTER, record: { id: recordId, title: recordId },
    }, asUser(SUBMITTER));
    if ('autoApproved' in opened) throw new Error('fixture: the approver slate must not be empty');
    return String(opened.id);
  };
  const actionsOf = async (requestId: string) => ((await engine.find('sys_approval_action', {
    where: { request_id: requestId }, context: SYSTEM,
  } as any)) as any[]).map((a) => ({ action: a.action, attachments: a.attachments ?? null }));
  const statusOf = async (requestId: string) => ((await engine.find('sys_approval_request', {
    where: { id: requestId }, context: SYSTEM,
  } as any)) as any[])[0]?.status;

  return { svc, open, actionsOf, statusOf };
}

type Rig = Awaited<ReturnType<typeof boot>>;

/** The refusal's message, or `null` when the call went through. */
const refusalOf = (p: Promise<unknown>) => p.then(() => null, (e: any) => String(e?.message ?? e));

const comment = (rig: Rig, requestId: string, attachments: unknown, ctx = asUser(SUBMITTER)) =>
  rig.svc.comment(requestId, { actorId: ctx.userId ?? SUBMITTER, comment: 'see attached', attachments: attachments as any }, ctx);
const reject = (rig: Rig, requestId: string, attachments: unknown, ctx = asUser(APPROVER)) =>
  rig.svc.decide(requestId, { decision: 'reject', actorId: ctx.userId ?? APPROVER, comment: 'no', attachments: attachments as any }, ctx);

/** Every value the rule refuses, as the caller on each door would send it. */
const refusedFor = (own: string, ownInOtherOrg: string): Array<[string, unknown]> => [
  ['a file someone else uploaded', [F_COLLEAGUE]],
  ['an id that names no file', [F_NOWHERE]],
  ['a file the caller uploaded in another organization', [ownInOtherOrg]],
  ['the caller\'s own file beside another', [own, F_COLLEAGUE]],
  ['a value that is not a list of ids', { id: own }],
];

describe('a comment attaches only files its caller uploaded', () => {
  it('every other id is refused before anything is written, with one answer', async () => {
    const rig = await boot();
    const answers = new Set<string | null>();
    for (const [label, attachments] of refusedFor(F_SUBMITTER_OWN, F_SUBMITTER_ORG_B)) {
      const requestId = await rig.open();
      const before = await rig.actionsOf(requestId);
      const answer = await refusalOf(comment(rig, requestId, attachments));
      expect({ label, answer: answer === null ? 'admitted' : answer.split(':')[0] }).toEqual({ label, answer: 'VALIDATION_FAILED' });
      expect(await rig.actionsOf(requestId), `${label}: nothing written`).toEqual(before);
      answers.add(answer);
    }
    expect(answers.size, 'one answer for every refused value').toBe(1);
  });

  it('control: the caller\'s own upload is attached', async () => {
    const rig = await boot();
    const requestId = await rig.open();
    expect(await refusalOf(comment(rig, requestId, [F_SUBMITTER_OWN]))).toBeNull();
    expect(await rig.actionsOf(requestId)).toContainEqual({ action: 'comment', attachments: [F_SUBMITTER_OWN] });
  });

  it('control: a system caller is not judged', async () => {
    const rig = await boot();
    const requestId = await rig.open();
    const system = { ...SYSTEM, userId: SUBMITTER };
    expect(await refusalOf(rig.svc.comment(requestId, { actorId: SUBMITTER, comment: 'x', attachments: [F_COLLEAGUE] }, system))).toBeNull();
  });
});

describe('a decision attaches only files its caller uploaded', () => {
  it('every other id is refused before anything is written, with one answer, and the request stays pending', async () => {
    const rig = await boot();
    const answers = new Set<string | null>();
    for (const [label, attachments] of refusedFor(F_APPROVER_OWN, F_APPROVER_ORG_B)) {
      const requestId = await rig.open();
      const before = await rig.actionsOf(requestId);
      const answer = await refusalOf(reject(rig, requestId, attachments));
      expect({ label, answer: answer === null ? 'admitted' : answer.split(':')[0] }).toEqual({ label, answer: 'VALIDATION_FAILED' });
      expect(await rig.actionsOf(requestId), `${label}: nothing written`).toEqual(before);
      expect(await rig.statusOf(requestId), label).toBe('pending');
      answers.add(answer);
    }
    expect(answers.size, 'one answer for every refused value').toBe(1);
  });

  it('control: the caller\'s own upload is attached', async () => {
    const rig = await boot();
    const requestId = await rig.open();
    // The decision itself is recorded; this rig attaches no flow to resume.
    await refusalOf(reject(rig, requestId, [F_APPROVER_OWN]));
    expect(await rig.actionsOf(requestId)).toContainEqual({ action: 'reject', attachments: [F_APPROVER_OWN] });
  });
});
