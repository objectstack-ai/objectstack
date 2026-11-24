// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A new organization's own seed resolves its founder (#34038).
 *
 * On a walled boot, better-auth's `POST /auth/organization/create` writes the
 * `sys_organization` row and THEN the founder's `sys_member` row, as two
 * separate adapter writes (better-auth's `createOrganization`: `createOrganization`,
 * then `createMember`, then `afterCreateOrganization`). This package's per-org
 * seed replay is the organization insert's middleware. When it ran on that
 * insert, the new organization had no member at all, and an organization-scoped
 * seed load resolves a person through membership in the load organization
 * (`seed-org-scoped-references.integration.test.ts` in `@objectstack/runtime`
 * pins that rule). So every person reference the app's seed declared landed
 * NULL with "not a member of organization ORG", the founder's included.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): an `ObjectKernel` over in-process
 * SQLite, the real `AuthPlugin` (better-auth organizations), `SecurityPlugin`,
 * the real `AppPlugin` seed replayer, and THIS package's `OrganizationsPlugin`,
 * under `OS_TENANCY_POSTURE=isolated`. The organization is created through the
 * product's own door by a signed-up user. Nothing is stubbed. Stored rows are
 * read back through the engine as SYSTEM.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { OrganizationsPlugin } from './organizations-plugin.js';

const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  // A walled deployment must declare what a new user joins, or this package's
  // own boot gate refuses it.
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

const FOUNDER_EMAIL = 'seed-founder@verify.test';
const FOUNDER_NAME = 'Founder Fiona';
const STRANGER_EMAIL = 'seed-stranger@verify.test';
const STRANGER_NAME = 'Stranger Sam';

const TASK = 'seedfounder_task';

const APP = {
  manifest: {
    id: 'com.example.seedfounder',
    namespace: 'seedfounder',
    version: '0.0.1',
    type: 'app',
    name: 'Seed Founder Fixture',
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
        // Every person reference the seed can carry names the founder.
        { name: 'Welcome task', assignee: FOUNDER_NAME, reviewer: FOUNDER_NAME, owner_id: FOUNDER_NAME },
        // A real person who is not a member of the new organization.
        { name: 'Outside task', assignee: STRANGER_NAME },
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
    const stack = await bootStack({ manifest: { ...APP.manifest, id: 'com.example.seedfounder.warmup' }, objects: [] } as never, {
      extraPlugins: [new OrganizationsPlugin()],
    });
    await stack.stop();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
await warmUp();

describe('a new organization’s own seed resolves its founder (#34038)', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let stack: VerifyStack;
  let ql: any;
  let founderId: string;
  let strangerId: string;
  let organizationId: string;

  const tasksOf = async (orgId: string): Promise<Record<string, Record<string, unknown>>> => {
    const rows: Array<Record<string, unknown>> = await ql.find(TASK, { where: { organization_id: orgId }, ...SYS });
    return Object.fromEntries(rows.map((r) => [String(r.name), r]));
  };

  beforeAll(async () => {
    for (const [name, value] of WALLED_BOOT_ENV) {
      restoreEnv.push([name, process.env[name]]);
      process.env[name] = value;
    }
    stack = await bootStack(APP as never, { extraPlugins: [new OrganizationsPlugin()] });
    ql = await stack.kernel.getServiceAsync('objectql');

    const founder = await stack.signUp(FOUNDER_EMAIL, undefined, FOUNDER_NAME);
    await stack.signUp(STRANGER_EMAIL, undefined, STRANGER_NAME);
    founderId = (await ql.findOne('sys_user', { where: { email: FOUNDER_EMAIL }, ...SYS }))?.id;
    strangerId = (await ql.findOne('sys_user', { where: { email: STRANGER_EMAIL }, ...SYS }))?.id;

    const created = await stack.apiAs(founder, 'POST', '/auth/organization/create', {
      name: 'Seed Founder Co',
      slug: 'seed-founder-co',
    });
    expect(created.status, `organization/create: ${await created.clone().text()}`).toBe(200);
    organizationId = ((await created.json()) as { id: string }).id;
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('PREMISE: the wall is up, the founder is a member of the new organization and the stranger is not', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(founderId).toBeTruthy();
    expect(strangerId).toBeTruthy();
    const members: Array<Record<string, unknown>> = await ql.find('sys_member', { where: { organization_id: organizationId }, ...SYS });
    expect(members.map((m) => m.user_id)).toEqual([founderId]);
  });

  it('the replay seeded the new organization, and every person reference naming the founder resolves to the founder', async () => {
    const tasks = await tasksOf(organizationId);
    expect(Object.keys(tasks).sort()).toEqual(['Outside task', 'Welcome task']);
    expect(tasks['Welcome task']).toMatchObject({ assignee: founderId, reviewer: founderId, owner_id: founderId });
  });

  it('control: a real person who is not a member of the new organization still resolves to nothing', async () => {
    const tasks = await tasksOf(organizationId);
    expect(tasks['Outside task']?.assignee ?? null).toBeNull();
  });
});
