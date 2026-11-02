// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `showcase_project_escalation` runs to the end on a project with no budget or
 * no owner. Both fields are optional on `showcase_project`, and nothing
 * defaults them.
 *
 * THE DEFECT. The `triage` decision branched on `budget > 200000` (e2) and
 * `budget <= 200000` (e3). A flow's trigger record is TOTAL over the object's
 * declared fields, so a project with no budget carries `budget: null`. CEL has
 * no `null > int` overload, so the run failed terminally at the decision and
 * notified nobody. The owner notifies guarded with
 * `has(record.owner) ? record.owner : null`. `has()` is true on a null column,
 * so the guard answered `null`, and the notify node refused a node left with no
 * recipient.
 *
 * THE FIX, in the reference app alone. e2 tests `record.budget != null` before
 * it compares. e3 is the decision's `isDefault` edge, the "otherwise" that also
 * takes a project with no budget. The normal-path and converge notifies fall
 * back to the organization's owners (`role:owner`, the exec the critical
 * branch already alerts) when the owner is blank (`isBlank`, so `null` and
 * `''` alike). The critical branch's owner alert sits behind its own
 * `decision`, because its sibling branch already alerts the exec.
 *
 * THE HARNESS IS THE PRODUCTION ONE for everything the defect touched: a real
 * kernel with ObjectQL over sqlite, the automation plugin and the app's real
 * `showcase_project` object and real flow. The project is written and turned
 * red through the data engine, and the run is handed the row as stored, the
 * way the record-change trigger hands it (that package is not a dependency of
 * this app). So a project with no budget reads `budget: null`, which each case
 * checks before it runs, rather than a hand-written literal missing the key.
 * Messaging is a recorder: what this file is about is which audience each
 * notify hands over, not inbox fan-out.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';

import { Account, Project } from '../src/data/objects/index.js';
import { ProjectEscalationFlow } from '../src/automation/flows/index.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true, positions: [], permissions: [] } as any };
const FLOW = ProjectEscalationFlow.name;
/** A user the directory holds: an inbox-only notify delivers an address only to its holder. */
const OWNER_EMAIL = 'admin@objectos.ai';

const openKernels: Array<{ shutdown?: () => Promise<void> }> = [];
const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  while (openKernels.length) {
    try { await openKernels.pop()?.shutdown?.(); } catch { /* noop */ }
  }
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

interface Emitted { audience: string[]; title: string }

interface Booted {
  automation: AutomationEngine & Record<string, any>;
  data: any;
  emitted: Emitted[];
  accountId: string;
}

async function boot(flow: unknown = ProjectEscalationFlow): Promise<Booted> {
  // The critical branch POSTs to an incident system; answer it here so the
  // try/catch takes its success path without leaving the process.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })));

  const emitted: Emitted[] = [];
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use({
    name: 'test.messaging-recorder', type: 'standard', version: '1.0.0', dependencies: [],
    async init(ctx: any) {
      ctx.registerService('messaging', {
        async emit(n: any) {
          emitted.push({ audience: [...(n.audience ?? [])], title: String(n.payload?.title ?? '') });
          return { delivered: 1, failed: 0 };
        },
      });
    },
    async start() {},
  } as any);
  await kernel.bootstrap();
  openKernels.push(kernel as any);

  const objectql: any = kernel.getService('objectql');
  const data: any = kernel.getService('data');
  const automation = kernel.getService<AutomationEngine>('automation') as AutomationEngine & Record<string, any>;

  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);

  for (const obj of [Account, Project]) objectql.registry.registerObject(obj, 'showcase', 'showcase');
  objectql.registry.registerObject(
    { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { email: { type: 'email', label: 'Email' }, name: { type: 'text', label: 'Name' } } },
    '@objectstack/example-showcase',
  );
  await objectql.syncSchemas();
  await installDefaultOrganization(objectql);
  await objectql.getDriverForObject('sys_user')!.create('sys_user', { id: 'usr_admin', email: OWNER_EMAIL, name: 'Admin' });

  automation.registerFlow((flow as any).name, flow as any);

  const account = await data.insert('showcase_account', { name: 'Escalation Co' }, SYS);
  return { automation, data, emitted, accountId: (Array.isArray(account) ? account[0] : account).id };
}

/**
 * Turn a fresh project red, and run the flow on it the way the record-change
 * trigger does: `record` is the row as stored (every declared column, so a
 * project with no budget reads `budget: null`), `previous` is that row before
 * the update.
 */
async function turnRed(booted: Booted, fields: Record<string, unknown>): Promise<{ result: any; run: any; steps: any[] }> {
  const created = await booted.data.insert('showcase_project', {
    name: 'esc', account: booted.accountId, status: 'planned', health: 'yellow', ...fields,
  }, SYS);
  const id = (Array.isArray(created) ? created[0] : created).id;
  const previous = await booted.data.findOne('showcase_project', { where: { id }, ...SYS });
  await booted.data.update('showcase_project', { id, health: 'red' }, SYS);
  const record = await booted.data.findOne('showcase_project', { where: { id }, ...SYS });
  // The defect's precondition, measured rather than assumed: the stored row
  // carries every optional field the case left out, as `null`.
  for (const field of ['budget', 'owner']) {
    if (!(field in fields)) expect(record).toHaveProperty(field, null);
  }

  const result = await booted.automation.execute(FLOW, {
    record, previous, object: 'showcase_project', event: 'update', organizationId: null,
  } as any);
  const runs: any[] = (await booted.automation.listRuns(FLOW)) ?? [];
  const run = runs[0] ?? {};
  return { result, run, steps: run.steps ?? [] };
}

/** `nodeId → status` for the steps that ran or were passed over. */
function stepStatus(steps: any[]): Record<string, string> {
  return Object.fromEntries(steps.map((s) => [s.nodeId, s.status]));
}

describe('showcase_project_escalation on a project missing an optional field', () => {
  it('a project with NO budget takes the normal path and notifies its owner', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { owner: OWNER_EMAIL });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.notify_normal).toBe('success');
    expect(status.alert).toBe('skipped');
    expect(booted.emitted.map((e) => e.audience)).toEqual([[OWNER_EMAIL], [OWNER_EMAIL]]);
  });

  it('a budgeted project with NO owner takes the normal path and notifies the exec instead', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 1000 });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(stepStatus(steps).notify_normal).toBe('success');
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('a blank owner reads as no owner: the normal path notifies the exec', async () => {
    const booted = await boot();
    const { result } = await turnRed(booted, { budget: 1000, owner: '' });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('a project with neither budget nor owner still completes and reaches the exec', async () => {
    const booted = await boot();
    const { result } = await turnRed(booted, {});

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(booted.emitted.map((e) => e.audience)).toEqual([['role:owner'], ['role:owner']]);
  });

  it('control: a budgeted project with an owner still takes e3 to notify_normal', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 1000, owner: OWNER_EMAIL });

    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.notify_normal).toBe('success');
    expect(status.alert).toBe('skipped');
    expect(booted.emitted.map((e) => e.audience)).toEqual([[OWNER_EMAIL], [OWNER_EMAIL]]);
  });

  it('a critical project with NO owner skips the owner alert and still alerts the exec once', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 500_000 });

    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.alert_exec).toBe('success');
    expect(status.alert_owner).toBe('skipped');
    expect(status.notify_normal).toBe('skipped');
    const critical = booted.emitted.filter((e) => e.title.startsWith('🔴'));
    expect(critical.map((e) => e.audience)).toEqual([['role:owner']]);
  });

  it('control: a critical project with an owner alerts both the owner and the exec', async () => {
    const booted = await boot();
    const { result, steps } = await turnRed(booted, { budget: 500_000, owner: OWNER_EMAIL });

    expect(result.success).toBe(true);
    const status = stepStatus(steps);
    expect(status.alert_owner).toBe('success');
    expect(status.alert_exec).toBe('success');
    const critical = booted.emitted.filter((e) => e.title.startsWith('🔴'));
    expect(critical.map((e) => e.audience).sort()).toEqual([[OWNER_EMAIL], ['role:owner']]);
  });
});
