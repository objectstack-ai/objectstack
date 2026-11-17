// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Default Organization's seed resolves the platform owner it is bound to.
 *
 * On a walled boot the default-organization bootstrap writes the
 * `sys_organization` row as SYSTEM, with no person behind it, and THEN the
 * platform owner's `sys_member` row. This package's per-org seed replay is
 * the organization insert's middleware, and an organization-scoped seed load
 * resolves a person through membership in the load organization. When the
 * replay ran on the organization insert, the Default Organization had no
 * member at all, so every person reference the app's seed declared landed NULL
 * with "not a member of organization ORG", the owner's included. The
 * seed-ownership handoff that follows the bind re-owns NULL `owner_id` rows,
 * so `owner_id` read right; a `Field.user()` or `Field.lookup('sys_user')`
 * column naming the owner stayed NULL.
 *
 * The second leg boots the same app un-walled. There the boot seed loads
 * before the dev admin exists, so its person columns have nobody to resolve to
 * when the seed runs, and the first-admin handoff writes `owner_id` and no
 * other column. The seed loader therefore holds each person reference its last
 * pass left NULL, on the row it landed on, and the runtime's AppPlugin retries
 * them once a `sys_user` row is inserted, writing each one that now resolves
 * while its column is still NULL. So the un-walled boot resolves the owner too,
 * through its own moment rather than the walled replay's.
 *
 * The held list lives in the process, and the last leg restarts between the
 * seed and the person's sign-up. For a keyed dataset (`mode` `ignore`, `upsert`
 * or `update`) a restart loses nothing: the durable holder is the seed
 * declaration itself. An un-walled boot runs its inline seed on every start;
 * the replay matches the row it landed on before by its key, meets the same
 * unresolved person there, and holds it again. No second record of the held
 * references is kept. An `insert` or `replace` dataset matches no row on
 * replay, so its first row is not held again; that leg is not pinned here.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): an `ObjectKernel` over in-process
 * SQLite, the real `AuthPlugin`, `SecurityPlugin`, the real `AppPlugin` seed
 * replayer and THIS package's `OrganizationsPlugin`. The walled leg runs under
 * `OS_TENANCY_POSTURE=isolated`; the harness declares its dev admin as the
 * platform owner, so the bootstrap binds that admin. Nothing is stubbed.
 * Stored rows are read back through the engine as SYSTEM.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { OrganizationsPlugin } from './organizations-plugin.js';

const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  // A walled deployment must declare what a new user joins, or this package's
  // own boot gate refuses it.
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

/** The harness's dev admin: the declared platform owner on the walled leg. */
const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_NAME = 'Dev Admin';

const TASK = 'seedowner_task';

const APP = {
  manifest: {
    id: 'com.example.seedowner',
    namespace: 'seedowner',
    version: '0.0.1',
    type: 'app',
    name: 'Seed Owner Fixture',
  },
  objects: [
    {
      name: TASK,
      label: 'Task',
      fields: {
        name: { type: 'text', label: 'Name' },
        assignee: { type: 'user', label: 'Assignee', reference: 'sys_user' },
        reviewer: { type: 'lookup', label: 'Reviewer', reference: 'sys_user' },
      },
    },
  ],
  data: [
    {
      object: TASK,
      mode: 'upsert',
      externalId: 'name',
      records: [
        // Every person reference the seed can carry names the platform owner.
        { name: 'Owner task', assignee: ADMIN_NAME, reviewer: ADMIN_NAME, owner_id: ADMIN_NAME },
      ],
    },
  ],
};

const SYS = { context: { isSystem: true } } as const;

/** Boot the walled stack once at module scope and stop it: the first boot's loading is paid here, never in a clocked hook. */
async function warmUp(): Promise<void> {
  const before = { ...process.env };
  for (const [name, value] of WALLED_BOOT_ENV) process.env[name] = value;
  try {
    const stack = await bootStack({ manifest: { ...APP.manifest, id: 'com.example.seedowner.warmup' }, objects: [] } as never, {
      extraPlugins: [new OrganizationsPlugin()],
    });
    await stack.stop();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
await warmUp();

/**
 * Hold `env` for one leg: set it before the boot and restore it after the
 * stack stops, because the plugins read the posture live. A name mapped to
 * `undefined` is removed for the leg.
 */
function legEnv(env: ReadonlyArray<readonly [string, string | undefined]>) {
  const saved: Array<[string, string | undefined]> = [];
  return {
    apply() {
      for (const [name, value] of env) {
        saved.push([name, process.env[name]]);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
    restore() {
      for (const [name, value] of saved.reverse()) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}

interface Booted {
  stack: VerifyStack;
  ql: any;
  adminId: string;
}

/** Boot APP, sign the dev admin in, and read the admin's id. */
async function bootApp(): Promise<Booted> {
  const stack = await bootStack(APP as never, { extraPlugins: [new OrganizationsPlugin()] });
  await stack.signIn();
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const adminId = String((await ql.findOne('sys_user', { where: { email: ADMIN_EMAIL }, ...SYS }))?.id ?? '');
  return { stack, ql, adminId };
}

async function ownerTasks(ql: any, where: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  return ql.find(TASK, { where: { name: 'Owner task', ...where }, ...SYS });
}

describe('the walled Default Organization’s seed resolves the platform owner it is bound to', () => {
  const env = legEnv(WALLED_BOOT_ENV);
  let booted: Booted;
  let defaultOrgId: string;

  beforeAll(async () => {
    env.apply();
    booted = await bootApp();
    defaultOrgId = String(
      (await booted.ql.findOne('sys_organization', { where: { slug: 'default' }, ...SYS }))?.id ?? '',
    );
  }, 120_000);

  afterAll(async () => {
    await booted?.stack.stop();
    env.restore();
  });

  it('PREMISE: the wall is up, and the Default Organization’s only member is the platform owner', async () => {
    const tenancy: any = await booted.stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(booted.adminId).not.toBe('');
    expect(defaultOrgId).not.toBe('');
    const members: Array<Record<string, unknown>> = await booted.ql.find('sys_member', {
      where: { organization_id: defaultOrgId },
      ...SYS,
    });
    expect(members.map((m) => [m.user_id, m.role])).toEqual([[booted.adminId, 'owner']]);
  });

  it('the replay seeded the Default Organization once, and every person reference naming the owner resolves to the owner', async () => {
    const rows = await ownerTasks(booted.ql, { organization_id: defaultOrgId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assignee: booted.adminId,
      reviewer: booted.adminId,
      owner_id: booted.adminId,
    });
  });
});

describe('the same seed on an un-walled boot resolves the first admin once that admin exists', () => {
  const env = legEnv([
    ['OS_TENANCY_POSTURE', undefined],
    ['OS_AUTH_MEMBERSHIP_POLICY', undefined],
  ]);
  let booted: Booted;

  beforeAll(async () => {
    env.apply();
    booted = await bootApp();
  }, 120_000);

  afterAll(async () => {
    await booted?.stack.stop();
    env.restore();
  });

  it('the wall is down, the seed landed once before the admin existed, and every person reference naming the admin resolves to the admin', async () => {
    const tenancy: any = await booted.stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.isolationActive).toBe(false);
    expect(booted.adminId).not.toBe('');
    const rows = await ownerTasks(booted.ql, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assignee: booted.adminId,
      reviewer: booted.adminId,
      owner_id: booted.adminId,
    });
  });
});

/**
 * ADR-0138 D1 on the un-walled handoff. The person the seed names here signs
 * up after the boot (and after the dev admin), so the held reference waits
 * past the admin's insert and resolves on that person's own insert. Only the
 * seed's own rows are reached, and only while their column is still NULL: a
 * row the seed did not write keeps the NULL its writer left, and a seeded row
 * someone assigned meanwhile keeps that assignment.
 */
describe('un-walled: a held seed person reference fills only the seed’s own rows, and only while still NULL', () => {
  const env = legEnv([
    ['OS_TENANCY_POSTURE', undefined],
    ['OS_AUTH_MEMBERSHIP_POLICY', undefined],
  ]);
  const LATE_NAME = 'Late Person';
  const LATE_EMAIL = 'late.person@example.com';
  const LATE_APP = {
    ...APP,
    manifest: { ...APP.manifest, id: 'com.example.seedowner.late' },
    data: [
      {
        object: TASK,
        mode: 'upsert',
        externalId: 'name',
        records: [
          { name: 'Late task', assignee: LATE_NAME },
          { name: 'Late task, assigned meanwhile', assignee: LATE_NAME },
        ],
      },
    ],
  };
  let stack: VerifyStack;
  let ql: any;
  let adminId: string;
  let lateId: string;
  let beforeSignUp: Array<Record<string, unknown>>;

  const taskNamed = async (name: string) => (await ql.find(TASK, { where: { name }, ...SYS }))[0];

  beforeAll(async () => {
    env.apply();
    stack = await bootStack(LATE_APP as never, { extraPlugins: [new OrganizationsPlugin()] });
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    adminId = String((await ql.findOne('sys_user', { where: { email: ADMIN_EMAIL }, ...SYS }))?.id ?? '');
    // A row the seed did not write, with no person: a guest's or a form's.
    await ql.insert(TASK, { name: 'Guest task' }, SYS);
    // A seeded row someone assigned by hand before the named person arrived.
    const meanwhile = await taskNamed('Late task, assigned meanwhile');
    await ql.update(TASK, { id: meanwhile.id, assignee: adminId }, SYS);
    beforeSignUp = await ql.find(TASK, { where: {}, ...SYS });
    await stack.signUp(LATE_EMAIL, undefined, LATE_NAME);
    lateId = String((await ql.findOne('sys_user', { where: { email: LATE_EMAIL }, ...SYS }))?.id ?? '');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    env.restore();
  });

  it('PREMISE: before the named person signs up, the seeded reference is NULL and the admin’s insert did not fill it', () => {
    expect(adminId).not.toBe('');
    expect(lateId).not.toBe('');
    const byName = Object.fromEntries(beforeSignUp.map((row) => [row.name, row.assignee]));
    expect(byName).toEqual({
      'Late task': null,
      'Late task, assigned meanwhile': adminId,
      'Guest task': null,
    });
  });

  it('the seed’s NULL reference resolves to the person once they exist; the guest row and the hand assignment stand', async () => {
    expect((await taskNamed('Late task')).assignee).toBe(lateId);
    expect((await taskNamed('Late task, assigned meanwhile')).assignee).toBe(adminId);
    expect((await taskNamed('Guest task')).assignee).toBeNull();
  });
});

/**
 * A restart between the un-walled seed and the person's sign-up loses nothing
 * for a keyed dataset (`mode: 'upsert'` here). The first process holds the
 * reference in memory and stops before the person exists. The second process
 * boots cold over the same database file; its own inline seed replays, matches
 * the same row by its key, meets the same NULL there, and holds it again, so
 * the person's sign-up in the second process fills the row.
 */
describe('un-walled: a restart between the seed and the person’s sign-up still fills the seed’s person columns', () => {
  const env = legEnv([
    ['OS_TENANCY_POSTURE', undefined],
    ['OS_AUTH_MEMBERSHIP_POLICY', undefined],
  ]);
  const RESTART_NAME = 'Restart Person';
  const RESTART_EMAIL = 'restart.person@example.com';
  /** Built again for each boot: a live boot holds references into its configuration. */
  const restartApp = () => ({
    ...APP,
    manifest: { ...APP.manifest, id: 'com.example.seedowner.restart' },
    data: [
      {
        object: TASK,
        mode: 'upsert',
        externalId: 'name',
        records: [{ name: 'Restart task', assignee: RESTART_NAME, reviewer: RESTART_NAME }],
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), 'seed-person-restart-'));
  const databaseFile = join(dir, 'restart.sqlite');
  let stack: VerifyStack | undefined;
  let firstProcess: Array<Record<string, unknown>>;
  let afterRestart: Array<Record<string, unknown>>;
  let afterSignUp: Array<Record<string, unknown>>;
  let personId: string;

  beforeAll(async () => {
    env.apply();
    const first = await bootStack(restartApp() as never, { extraPlugins: [new OrganizationsPlugin()], databaseFile });
    const firstQl = await first.kernel.getServiceAsync<any>('objectql');
    firstProcess = await firstQl.find(TASK, { where: {}, ...SYS });
    await first.stop();

    stack = await bootStack(restartApp() as never, { extraPlugins: [new OrganizationsPlugin()], databaseFile });
    await stack.signIn();
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    afterRestart = await ql.find(TASK, { where: {}, ...SYS });
    await stack.signUp(RESTART_EMAIL, undefined, RESTART_NAME);
    personId = String((await ql.findOne('sys_user', { where: { email: RESTART_EMAIL }, ...SYS }))?.id ?? '');
    afterSignUp = await ql.find(TASK, { where: {}, ...SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    env.restore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('PREMISE: the first process seeded the row with NULL person columns, and the second booted over that same row', () => {
    expect(firstProcess).toHaveLength(1);
    expect(firstProcess[0]).toMatchObject({ assignee: null, reviewer: null });
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]).toMatchObject({ id: firstProcess[0].id, assignee: null, reviewer: null });
  });

  it('the person’s sign-up after the restart fills both columns on the row the first process seeded', () => {
    expect(personId).not.toBe('');
    expect(afterSignUp).toHaveLength(1);
    expect(afterSignUp[0]).toMatchObject({ id: firstProcess[0].id, assignee: personId, reviewer: personId });
  });
});
