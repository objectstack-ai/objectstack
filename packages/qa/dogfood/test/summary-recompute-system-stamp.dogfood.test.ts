// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A roll-up recompute is a SYSTEM write on the master's audit trail — measured
 * on a real showcase boot (SQL driver, the app's own security profile, the
 * audit plugin), through the real REST doors.
 *
 * The defect: a child write recomputes the master's `summary` columns through
 * an ordinary engine `update` of the master, under the child writer's
 * (elevated) context, and the audit stamp wrote that writer into the master's
 * `updated_by`. A member who only added a task to a project they cannot edit
 * then read as the project's last editor.
 *
 * Ruling (recorded on the card, comment 6902001862): 「确定汇总字段自动重算时
 * 主记录的修改人和修改时间怎么记」 → 「记为系统并刷新时间」. ADR-0118 D1: the system
 * actor is `null`. So after the member's task write the project reads
 * `updated_by = null` with a fresh `updated_at`, and no audit-ledger row on the
 * project names the member.
 *
 * Showcase shape (the one the recompute's elevation was measured on): a plain
 * member holds `create` + `read` on `showcase_task` and only `read` on
 * `showcase_project`; `showcase_project.task_count` counts its tasks.
 *
 * CONTROL: the admin's own direct edit of the project still stamps the admin —
 * the fix is the recompute's write, not every write.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const STALE_AT = '2000-01-01T00:00:00.000Z';

type Row = Record<string, any>;

describe('roll-up recompute stamps the master as the system (updated_by = null)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let memberToken: string;
  let adminId: string;
  let memberId: string;
  let projectId: string;

  const idFrom = async (res: Response): Promise<string> => {
    const text = await res.text();
    expect(res.status, text).toBeLessThan(300);
    const json = JSON.parse(text) as { id?: string; data?: { id?: string }; record?: { id?: string } };
    return String(json.data?.id ?? json.record?.id ?? json.id);
  };
  const project = async (): Promise<Row> =>
    (await ql.findOne('showcase_project', { where: { id: projectId }, context: SYS })) as Row;
  /** Age the stored `updated_at` so "the recompute refreshed it" is never a same-millisecond tie. */
  const ageProject = async () => {
    await ql.update('showcase_project', { id: projectId, updated_at: STALE_AT }, { context: { ...SYS, preserveAudit: true } });
    expect(new Date((await project()).updated_at).toISOString()).toBe(STALE_AT);
  };
  const projectAuditRowsBy = async (userId: string): Promise<Row[]> =>
    (await ql.find('sys_audit_log', {
      where: { object_name: 'showcase_project', record_id: projectId, user_id: userId },
      context: SYS,
    })) as Row[];

  beforeAll(async () => {
    stack = await bootShowcase({ extraPlugins: [new AuditPlugin()] });
    ql = await stack.kernel.getServiceAsync('objectql');
    adminToken = await stack.signIn();
    memberToken = await stack.signUp('rollup-stamp-member@verify.test');
    memberId = String((await ql.findOne('sys_user', { where: { email: 'rollup-stamp-member@verify.test' }, context: SYS }))?.id ?? '');
    expect(memberId).not.toBe('');

    const account = await idFrom(await stack.apiAs(adminToken, 'POST', '/data/showcase_account', { name: 'Rollup stamp account' }));
    projectId = await idFrom(await stack.apiAs(adminToken, 'POST', '/data/showcase_project', { name: 'Rollup stamp project', account, status: 'planned' }));
    adminId = String((await project()).created_by ?? '');
    expect(adminId).not.toBe('');
    expect(adminId).not.toBe(memberId);
    expect((await project()).updated_by).toBe(adminId);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  it('the member cannot edit the project directly (the shape under test)', async () => {
    const res = await stack.apiAs(memberToken, 'PATCH', `/data/showcase_project/${projectId}`, { name: 'member edit' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await project()).updated_by).toBe(adminId);
  });

  it('CONTROL: the admin\'s direct edit of the project stamps the admin', async () => {
    await ageProject();
    const res = await stack.apiAs(adminToken, 'PATCH', `/data/showcase_project/${projectId}`, { name: 'Rollup stamp project (admin)' });
    expect(res.status, await res.clone().text()).toBe(200);
    const row = await project();
    expect(row.updated_by).toBe(adminId);
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(STALE_AT));
  });

  it('the member\'s task insert recomputes the project and stamps it as the system, not the member', async () => {
    await ageProject();
    const before = Number((await project()).task_count ?? 0);
    const taskId = await idFrom(await stack.apiAs(memberToken, 'POST', '/data/showcase_task', { title: 'Rollup stamp task', project: projectId }));
    expect(taskId).not.toBe('');
    const row = await project();
    expect(Number(row.task_count)).toBe(before + 1);
    expect(row.updated_by).toBeNull();
    expect(row.updated_by).not.toBe(memberId);
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(STALE_AT));
    expect(await projectAuditRowsBy(memberId)).toEqual([]);
  });
});
