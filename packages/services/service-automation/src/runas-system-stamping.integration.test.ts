// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5494 — a `runAs:'system'` flow's `create_record` must not insert rows with
 * `owner_id` / `organization_id` / `created_by` all NULL.
 *
 * The defect: `resolveRunDataContext`'s system branch DISCARDED the trigger's
 * identity (`userId` / `tenantId`), and every platform stamp for the three
 * columns keys on exactly what was discarded — `created_by` on the write
 * context's `userId` (ObjectQL audit hook), `owner_id` on the acting user in
 * the security middleware (whose whole chain, stamp included, short-circuits
 * on `isSystem`), `organization_id` on the context `tenantId` (driver-level
 * tenant machinery; the org middleware also skips system writes). So every
 * record a user-triggered system sweep created was born with all three NULL:
 * outside the org partition (unique indexes don't bite across NULL, org
 * queries don't see it) and outside every owner/creator-scoped grant — the
 * issue's "born untouchable even by admin", flipped to 200 only after a demo
 * crutch stamped the row.
 *
 * These tests run the REAL stack — ObjectKernel, ObjectQLPlugin (audit-stamp
 * hooks), driver-sql on better-sqlite3 `:memory:` (tenant-column injection),
 * the real AutomationEngine + CRUD nodes, and (for the flip) the real
 * SecurityPlugin middleware — because the defect lived precisely in the
 * hand-off between those layers, invisible to any single-layer unit test.
 *
 * Directions decided before running (reverse-verification discipline):
 *  - user-triggered system run → all three columns land (was: all NULL);
 *  - user-LESS system run (schedule shape) → columns stay NULL — there is no
 *    acting user, and ADR-0118 D1 forbids a sentinel/pseudo-user in its
 *    place; the actor label + flowRunId remain the provenance channels. This
 *    is also the structural "before" twin that proves the columns come from
 *    the carried identity, not from some new global default;
 *  - the #5494 step-3→5 flip: the SAME caller is denied on the NULL-born row
 *    and admitted on the stamped row — row content, not caller, decides.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

/** Real backend: better-sqlite3 `:memory:` through driver-sql (PR #5715 shape). */
function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/**
 * A plain business object. `organization_id`, `owner_id` and the audit family
 * (`created_by` / `updated_by`) are NOT declared — the registry injects them
 * (`applySystemFields`), exactly like a production app object, so the test
 * proves the stamps land on the injected platform columns.
 */
const crmTask = {
  name: 'crm_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** start → create_record(crm_task) → end, under runAs:'system'. */
const sweepFlow = (name: string, fields: Record<string, unknown>) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'crm_task', fields } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mk' },
    { id: 'e2', source: 'mk', target: 'end' },
  ],
});

/** The manual-trigger envelope the issue reproduced with: a real user + org. */
const ADMIN_TRIGGER = {
  userId: 'usr_admin',
  tenantId: 'org_1',
  positions: [] as string[],
  permissions: [] as string[],
};

describe("runAs:'system' create_record stamps organization_id / owner_id / created_by (#5494)", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function boot(extraPlugins: any[] = []) {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    for (const p of extraPlugins) await kernel.use(p);
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = makeSqliteDriver();
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(crmTask as any, 'stamping-test', 'stamping-test');
    await ql.syncSchemas();
  }

  const SYS = { isSystem: true } as const;
  const taskByTitle = (title: string) =>
    ql.findOne('crm_task', { where: { title }, context: SYS });

  it('a USER-TRIGGERED system run lands all three columns from the trigger identity', async () => {
    await boot();
    automation.registerFlow('renewal_sweep', sweepFlow('renewal_sweep', { title: 'renew A', status: 'open' }) as any);

    const res = await automation.execute('renewal_sweep', { ...ADMIN_TRIGGER });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    const row = await taskByTitle('renew A');
    expect(row, 'the sweep must have created the row').toBeTruthy();
    // The issue's step 2, inverted: the three platform columns are all
    // non-NULL, and each equals what the trigger context knew.
    expect(row.created_by, 'created_by must be the triggering user').toBe('usr_admin');
    expect(row.owner_id, 'owner_id must be the acting user (the runAs:user default, restored)').toBe('usr_admin');
    expect(row.organization_id, "organization_id must be the trigger context's org").toBe('org_1');
  });

  it("flow-authored ownership wins: an explicit `fields.owner_id` is never overwritten", async () => {
    await boot();
    automation.registerFlow(
      'assigned_sweep',
      sweepFlow('assigned_sweep', { title: 'renew B', owner_id: 'usr_assignee' }) as any,
    );

    const res = await automation.execute('assigned_sweep', { ...ADMIN_TRIGGER });
    expect(res.success).toBe(true);

    const row = await taskByTitle('renew B');
    // ADR-0073 D3 — flow logic sets ownership explicitly; the stamp is the
    // fill-only default underneath it, exactly like the security middleware's
    // own "empty means stamp" rule on the user path.
    expect(row.owner_id).toBe('usr_assignee');
    // Attribution is untouched by the ownership choice.
    expect(row.created_by).toBe('usr_admin');
    expect(row.organization_id).toBe('org_1');
  });

  it('a USER-LESS system run (schedule shape) stamps nothing — and that is the contract, not a gap', async () => {
    await boot();
    automation.registerFlow('night_sweep', sweepFlow('night_sweep', { title: 'renew C' }) as any);

    // What ScheduleTrigger actually supplies: an event and params, NO user, NO
    // org (schedule-trigger.ts builds `{ event: 'schedule', params }`).
    const res = await automation.execute('night_sweep', { event: 'schedule', params: {} } as any);
    expect(res.success).toBe(true);

    const row = await taskByTitle('renew C');
    expect(row).toBeTruthy();
    // No acting user exists. ADR-0118 D1: the system actor's representation in
    // user-lookup columns IS null — a sentinel string or pseudo-user is the
    // banned alternative. ADR-0073's automation principal (a real identity for
    // these runs) is M2, gated on its first consumer. Provenance still names
    // the writer: the run's `svc:flow:*` actor label and flowRunId (#4366/#3712).
    expect(row.created_by ?? null).toBeNull();
    expect(row.owner_id ?? null).toBeNull();
    // The schedule trigger supplies no org today, so there is nothing to
    // stamp; a schedule-run in an org-partitioned deployment needs the flow's
    // `fields` to place rows (or a future org-aware schedule binding).
    expect(row.organization_id ?? null).toBeNull();
  });

  it("REGRESSION: the runAs:'user' path is unchanged — audit + org stamps still land", async () => {
    await boot();
    const userFlow = { ...sweepFlow('user_flow', { title: 'renew D' }), runAs: 'user' };
    automation.registerFlow('user_flow', userFlow as any);

    const res = await automation.execute('user_flow', { ...ADMIN_TRIGGER });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    const row = await taskByTitle('renew D');
    expect(row.created_by).toBe('usr_admin');
    expect(row.organization_id).toBe('org_1');
    // (`owner_id` on the user path is the security middleware's stamp; the
    // full-security composition below covers it. This harness pins that the
    // audit + tenant machinery behave identically before and after the fix.)
  });
});

/**
 * The issue's step 3→5 flip, replayed against the REAL SecurityPlugin: the
 * same non-elevated caller PATCHes and DELETEs the flow-created row — denied
 * (403-shape: PermissionDeniedError) while the row's stamp columns are NULL,
 * admitted once they carry the acting user. Nothing about the caller changes
 * between the two, exactly the issue's tell.
 *
 * The framework's own default grants make the mechanism concrete: member
 * writes are scoped by the `owner_only_writes` / `owner_only_deletes` RLS
 * policies (`created_by == current_user.id`, bound to `org_member`), enforced
 * on by-id writes via the middleware's pre-image re-read — so a row born with
 * `created_by = NULL` matches nobody's write scope, and no caller-side change
 * can ever reach it (the HotCRM report's admin hit the owner-keyed variant of
 * the same class).
 */
describe('the #5494 admission flip: row content, not caller, decides (real SecurityPlugin)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /** Members get no baseline delete (ADR-0090 D5) — grant it explicitly. */
  const taskDeleteSet = PermissionSetSchema.parse({
    name: 'task_delete',
    label: 'Flip proof — task delete',
    objects: { crm_task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  });

  /** The rank-and-file member who triggered the sweep. */
  const MEMBER_CTX = {
    userId: 'usr_member',
    tenantId: 'org_1',
    positions: ['org_member'],
    permissions: ['member_default', 'task_delete'],
  };

  async function bootWithSecurity() {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(
      new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, taskDeleteSet],
      }),
    );
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = makeSqliteDriver();
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(crmTask as any, 'stamping-test', 'stamping-test');
    await ql.syncSchemas();
  }

  const SYS = { isSystem: true } as const;
  const rowByTitle = (title: string) =>
    ql.findOne('crm_task', { where: { title }, context: SYS });

  it('the member can PATCH and DELETE the row their own trigger created (was: denied)', async () => {
    await bootWithSecurity();
    automation.registerFlow('renewal_sweep', sweepFlow('renewal_sweep', { title: 'flip A', status: 'open' }) as any);

    // The member triggers the system sweep — the issue's reproduction shape.
    const res = await automation.execute('renewal_sweep', { ...MEMBER_CTX });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    const row = await rowByTitle('flip A');
    expect(row.created_by).toBe('usr_member');
    expect(row.owner_id).toBe('usr_member');
    expect(row.organization_id).toBe('org_1');

    // Step 3, inverted: the same member — no elevation, no transfer grant —
    // repairs and completes the record the sweep made for them.
    await expect(
      ql.update('crm_task', { id: row.id, status: 'done' }, { context: { ...MEMBER_CTX } }),
    ).resolves.toBeDefined();
    expect((await rowByTitle('flip A')).status).toBe('done');

    await expect(
      ql.delete('crm_task', { where: { id: row.id }, context: { ...MEMBER_CTX } }),
    ).resolves.toBeDefined();
    expect(await rowByTitle('flip A')).toBeFalsy();
  });

  it('the NULL-born row (user-less run) is still untouchable by the same caller — the 403 half of the flip', async () => {
    await bootWithSecurity();
    automation.registerFlow('night_sweep', sweepFlow('night_sweep', { title: 'flip B', status: 'open' }) as any);

    // A user-less firing creates the row with NULL stamps (nothing to carry).
    const res = await automation.execute('night_sweep', { event: 'schedule', params: {} } as any);
    expect(res.success).toBe(true);
    const row = await rowByTitle('flip B');
    expect(row.created_by ?? null).toBeNull();

    // The SAME member context that succeeded above is denied here: the only
    // difference between the two attempts is the row's stamp columns — the
    // issue's step-4/5 tell, reproduced in one build. (`owner_only_writes`
    // matches no one on a NULL `created_by`; the pre-image check fails closed.)
    //
    // [#7451] Re-spelled from `toThrow(/denied|permission/i)`, and the reason is
    // worth recording: that regex was never asserting this refusal, it was
    // asserting the SHAPE OF THE ENGLISH COPY, and it matched only because the
    // sentence happened to open with "Access denied". The row-level gate's user
    // half is now a localized catalog sentence ("You do not have access to this
    // record…"), which contains neither word — so the regex went red on a change
    // that altered nothing it was written to protect. Pinned properly now: the
    // ADR-0112 envelope (`code` + `statusCode`, never a bare throw), the user
    // half against the catalog CONSTANT so the next copy edit needs no re-spell,
    // and the developer half — which still carries the English sentence verbatim
    // — for the one thing the regex was reaching for, namely WHICH gate refused.
    const rowLevelDenial = {
      code: 'PERMISSION_DENIED',
      statusCode: 403,
      message: BUILTIN_OPERATION_MESSAGES.en.record_access_denied,
      developerMessage: expect.stringContaining('(row-level security)'),
    };
    await expect(
      ql.update('crm_task', { id: row.id, status: 'done' }, { context: { ...MEMBER_CTX } }),
    ).rejects.toMatchObject(rowLevelDenial);
    await expect(
      ql.delete('crm_task', { where: { id: row.id }, context: { ...MEMBER_CTX } }),
    ).rejects.toMatchObject(rowLevelDenial);
  });
});
