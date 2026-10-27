// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26181] An approval notification names the record by its title, as the
 * recipient may read it.
 *
 * ## The defect
 *
 * Every approval notification body named its record by the object's label and
 * the record id (`Your Contract C8Mp7TjRYta8mOWx was approved.`), the
 * #23556 / #23594 ruling B form. A recipient could not tell which record it
 * was without opening it, while the app's own notifications in the same bell
 * named it by title.
 *
 * ## The ruling (A′, maintainer 「同意」 2026-10-26)
 *
 * Each notification is rendered for one named recipient, so the record is
 * named by its display title (ADR-0079 `nameField`) resolved AS THAT
 * RECIPIENT, narrowed by their field-level security, and by the record id
 * when the title is empty or unreadable to them. The token-bearing action-link
 * pages keep the id: they have no reader to narrow for
 * (`subject-title-reader-fls.integration.test.ts` (d) pins them).
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory), with a field-visibility source in
 * place of `plugin-security`'s (its readable / queryable answers are its
 * contract) and the messaging surface recording what reaches it:
 *
 *  (a) a recipient who may read the title field reads the title, in the
 *      literal body and in the keyed `record` param alike;
 *  (b) a record whose title is empty is named by its id;
 *  (c) a recipient who may not read the title field, or is served it masked,
 *      is named the record by its id;
 *  (d) two recipients with different field-level security on one request read
 *      two different bodies, whether each has an emit of its own (the
 *      opening) or one emit names them both (the SLA breach): that emit is
 *      split, one per name, so no recipient is handed another's title.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import type { FieldVisibilitySource } from './payload-redaction.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;

/** May read every field of the contract. */
const READER = 'u_reader';
/** May not read the contract's title field. */
const RESTRICTED = 'u_restricted';
/** Served the title field MASKED: readable, not queryable (#20964). */
const MASKED = 'u_masked';
/** The submitter, who may read every field. */
const SUBMITTER = 'u_sub';

const TITLE = 'Acme MSA 2026';

const contract = {
  name: 'crm_contract',
  label: 'Contract',
  nameField: 'name',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    amount: { name: 'amount', label: 'Amount', type: 'number' as const },
  },
};
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
  },
};

/**
 * The authorization store a recipient's envelope is resolved from
 * (`resolveUserAuthzGrants`): read, and empty — the field-visibility source
 * below answers by user.
 */
const authzStore = ['sys_member', 'sys_user_position', 'sys_user_permission_set'].map((name) => ({
  name,
  label: name,
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Organization', type: 'text' as const },
  },
}));

const ALL = ['id', 'name', 'amount'];
/** recipient → [readable, queryable] on `crm_contract`. */
const ANSWERS: Record<string, [string[], string[]]> = {
  [READER]: [ALL, ALL],
  [SUBMITTER]: [ALL, ALL],
  [RESTRICTED]: [['id', 'amount'], ['id', 'amount']],
  [MASKED]: [ALL, ['id', 'amount']],
};

/** Stands in for `plugin-security`, answering by the context's `userId`. */
function makeVisibility(): FieldVisibilitySource {
  const answer = (object: string, context: any, which: 0 | 1) => {
    if (context?.isSystem) return ALL;
    if (object !== contract.name) return [];
    return ANSWERS[String(context?.userId ?? '')]?.[which] ?? [];
  };
  return {
    async getReadableFields(object: string, context?: any) { return answer(object, context, 0); },
    async getQueryableFields(object: string, context?: any) { return answer(object, context, 1); },
  };
}

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
  payload?: { title?: string; body?: string };
  keyedText?: { params?: Record<string, unknown> };
}

describe('[#26181] an approval notification names the record by the title its recipient may read', () => {
  let engine: ObjectQL;
  let svc: ApprovalService;
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: Emitted[] = [];
  let n = 0;

  /** One pending request on a fresh contract named `name`. */
  const open = async (name: string, approvers: string[], extra: Record<string, unknown> = {}) => {
    n += 1;
    const recordId = `C${n}`;
    await engine.insert('crm_contract', { id: recordId, name, amount: 100 * n }, { context: SYSTEM } as any);
    const row: any = await svc.openNodeRequest({
      object: 'crm_contract', recordId, runId: `run_${n}`, nodeId: 'review', flowName: 'contract_review',
      config: {
        approvers: approvers.map((value) => ({ type: 'user', value })),
        behavior: 'first_response',
        ...extra,
      } as any,
      submitterId: SUBMITTER, record: { id: recordId, name, amount: 100 * n },
    }, asUser(SUBMITTER));
    return { requestId: String(row.id), recordId };
  };

  /** The emits of `topic` about `requestId` that reached `recipient`. */
  const toldTo = (topic: string, requestId: string, recipient: string) =>
    emits.filter((e) => e.topic === topic && e.source?.id === requestId && e.audience.includes(recipient));

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const def of [sysUser, ...authzStore, contract, ...(await packageObjects())]) {
      engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const id of [READER, RESTRICTED, MASKED, SUBMITTER]) {
      await engine.insert('sys_user', { id, name: id, email: `${id}@example.com` }, { context: SYSTEM } as any);
    }
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(now += 1000) },
      automation: {
        resume: async () => ({ status: 'completed' }),
        cancelRun: async () => undefined,
        getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
      } as any,
      logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
    });
    svc.attachFieldVisibility(makeVisibility());
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('(a) a recipient who may read the title reads it, literal and keyed alike', async () => {
    const { requestId } = await open(TITLE, [READER]);
    const [requested] = toldTo('approval.requested', requestId, READER);
    expect(requested?.payload?.body).toBe(`A decision on Contract ${TITLE} is waiting on you.`);
    expect(requested?.keyedText?.params?.record).toBe(TITLE);

    await svc.decide(requestId, { decision: 'approve', actorId: READER }, asUser(READER));
    const [approved] = toldTo('approval.approved', requestId, SUBMITTER);
    expect(approved?.payload?.body).toBe(`Your Contract ${TITLE} was approved.`);
    expect(approved?.keyedText?.params?.record).toBe(TITLE);
  });

  it('(b) a record whose title is empty is named by its id', async () => {
    const { requestId, recordId } = await open('', [READER]);
    const [requested] = toldTo('approval.requested', requestId, READER);
    expect(requested?.payload?.body).toBe(`A decision on Contract ${recordId} is waiting on you.`);
    expect(requested?.keyedText?.params?.record).toBe(recordId);
  });

  it('(c) a recipient who may not read the title field, or is served it masked, is named the id', async () => {
    const { requestId, recordId } = await open(TITLE, [RESTRICTED, MASKED]);
    for (const recipient of [RESTRICTED, MASKED]) {
      const told = toldTo('approval.requested', requestId, recipient);
      expect(told).toHaveLength(1);
      expect(told[0].payload?.body).toBe(`A decision on Contract ${recordId} is waiting on you.`);
      expect(told[0].keyedText?.params?.record).toBe(recordId);
      expect(JSON.stringify(told[0])).not.toContain(TITLE);
    }
  });

  it('(d) two recipients with different field-level security on one request read different bodies', async () => {
    // Each approver has an emit of their own: the opening.
    const opened = await open(TITLE, [READER, RESTRICTED],
      { escalation: { timeoutHours: 1, action: 'notify', notifySubmitter: false } });
    const [toReader] = toldTo('approval.requested', opened.requestId, READER);
    const [toRestricted] = toldTo('approval.requested', opened.requestId, RESTRICTED);
    expect(toReader?.payload?.body).toBe(`A decision on Contract ${TITLE} is waiting on you.`);
    expect(toRestricted?.payload?.body).toBe(`A decision on Contract ${opened.recordId} is waiting on you.`);

    // One emit names both: the SLA breach tells the whole slate. It is split
    // per name, so neither is handed the other's text.
    now += 2 * 3600_000;
    await svc.runEscalations();
    const breached = emits.filter((e) => e.topic === 'approval.sla_breached' && e.source?.id === opened.requestId);
    expect(breached.map((e) => e.audience)).toEqual([[READER], [RESTRICTED]]);
    expect(breached[0].payload?.body).toBe(`A decision on Contract ${TITLE} is overdue.`);
    expect(breached[1].payload?.body).toBe(`A decision on Contract ${opened.recordId} is overdue.`);
    expect(JSON.stringify(breached[1])).not.toContain(TITLE);
  });
});
