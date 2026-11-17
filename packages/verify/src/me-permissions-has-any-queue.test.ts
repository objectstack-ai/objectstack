// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28508: through the real HTTP door, a PLAIN member's `/auth/me/permissions`
// answers `hasAnyQueue`, whether the member's organization has at least one
// ownership queue. The console's list toolbar reads it once per session to
// decide whether its "in a queue" toggle can ever return a row.
//
// The member cannot answer this themselves: `member_default` names no
// `sys_queue` entry and has had no wildcard since #5491, so `GET
// /data/sys_queue` is 403 for them. That stays so. The server resolves the
// question under system context through the ownership-queue service and
// discloses only the boolean.
//
// Five cases, as the card's Acceptance lists them, each read as the member:
//
//   1. only a `sys_queue` row in the organization        ⇒ true
//   2. only a declared queue                             ⇒ true
//   3. a declared queue switched off in the activation
//      ledger, and no row                                ⇒ false
//   4. neither                                           ⇒ false
//   5. no ownership-queue service registered             ⇒ false
//
// and, beside every case, the member's `GET /data/sys_queue` stays 403
// PERMISSION_DENIED.
//
// Two boots, to keep the cost down: one stack declares no queue (cases 4, 1,
// then 5, in that order, since each step only adds to the state the last one
// read), one stack declares a queue (cases 2, then 3, switching it off through
// the real activation door as the admin).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack } from '@objectstack/spec';
// The harness loads these two inside a function body; paid here, during collection, not in a clocked window.
import '@objectstack/service-datasource';
import '@objectstack/service-automation';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { MePermissionsResponseSchema } from '@objectstack/spec/api';
import { bootStack, type VerifyStack } from './harness.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

await warmUpBoot();

const memo = (namespace: string) =>
  ObjectSchema.create({
    name: `${namespace}_memo`,
    label: 'Memo',
    pluralLabel: 'Memos',
    fields: { name: Field.text({ label: 'Name', required: true }) },
  });

const DECLARED_QUEUE = 'qbitd_support';

const stackWithoutQueues = () =>
  defineStack({
    manifest: {
      id: 'com.example.qbit-no-queue',
      namespace: 'qbitn',
      version: '0.0.1',
      type: 'app',
      name: 'No Queue Fixture',
    },
    objects: [memo('qbitn')],
  });

const stackWithDeclaredQueue = () =>
  defineStack({
    manifest: {
      id: 'com.example.qbit-declared-queue',
      namespace: 'qbitd',
      version: '0.0.1',
      type: 'app',
      name: 'Declared Queue Fixture',
    },
    objects: [memo('qbitd')],
    queues: [{ name: DECLARED_QUEUE, label: 'Support', members: [] }],
  });

async function hasAnyQueueAs(stack: VerifyStack, token: string): Promise<unknown> {
  const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
  expect(res.status).toBe(200);
  const raw: unknown = await res.json();
  // The real full-stack body holds to the declared STRICT contract: an
  // undeclared key the handler sends reds here.
  const parsed = MePermissionsResponseSchema.safeParse(raw);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  const body = raw as { authenticated?: unknown; hasAnyQueue?: unknown };
  expect(body.authenticated).toBe(true);
  return body.hasAnyQueue;
}

/** The #5491 baseline, pinned beside every case: the member still may not read `sys_queue`. */
async function expectSysQueueRefused(stack: VerifyStack, token: string): Promise<void> {
  const res = await stack.apiAs(token, 'GET', '/data/sys_queue');
  expect(res.status).toBe(403);
  const body = (await res.json()) as { code?: unknown };
  expect(body.code, JSON.stringify(body)).toBe('PERMISSION_DENIED');
}

describe('[#28508] a plain member\'s /auth/me/permissions answers hasAnyQueue (no declared queue)', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;

  beforeAll(async () => {
    stack = await bootStack(stackWithoutQueues());
    admin = await stack.signIn();
    member = await stack.signUp('qbit-member-n@verify.test');
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('4. neither a declared queue nor a sys_queue row: false', async () => {
    expect(await hasAnyQueueAs(stack, member)).toBe(false);
    await expectSysQueueRefused(stack, member);
  });

  it('1. only a sys_queue row in the organization: true, and still no read of sys_queue for the member', async () => {
    const created = await stack.apiAs(admin, 'POST', '/data/sys_queue', { name: 'qbitn_desk', label: 'Desk' });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    expect(await hasAnyQueueAs(stack, member)).toBe(true);
    await expectSysQueueRefused(stack, member);
  });

  it('5. no ownership-queue service registered: false, though the row is still there', async () => {
    const kernel = stack.kernel as any;
    kernel.services.delete(OWNERSHIP_QUEUE_SERVICE);
    kernel.pluginLoader.serviceInstances.delete(OWNERSHIP_QUEUE_SERVICE);
    expect(() => kernel.context.getService(OWNERSHIP_QUEUE_SERVICE)).toThrow(/not found/);
    expect(await hasAnyQueueAs(stack, member)).toBe(false);
    await expectSysQueueRefused(stack, member);
  });
});

describe('[#28508] a plain member\'s /auth/me/permissions answers hasAnyQueue (a declared queue)', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;

  beforeAll(async () => {
    stack = await bootStack(stackWithDeclaredQueue());
    admin = await stack.signIn();
    member = await stack.signUp('qbit-member-d@verify.test');
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('2. only a declared queue: true', async () => {
    expect(await hasAnyQueueAs(stack, member)).toBe(true);
    await expectSysQueueRefused(stack, member);
  });

  it('3. the declared queue switched off in the activation ledger, and no row: false', async () => {
    const off = await stack.apiAs(admin, 'POST', `/security/_activation/queue/${DECLARED_QUEUE}`, { enabled: false });
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await hasAnyQueueAs(stack, member)).toBe(false);
    await expectSysQueueRefused(stack, member);
  });
});

// ─── [#34602] objectsUsingQueues: which objects use queues ───────────────────
//
// Through the same door, the per-object answer beside `hasAnyQueue`: the
// objects on which the list's "In a queue" filter can find something — a
// record sits in a queue now (no owner, a queue set), OR an active assignment
// rule routes the object into a queue. Narrowed to what the caller may read.
//
// One boot. A declared queue and four objects:
//   qobj_case     — a declared rule parks its new records in the queue  ⇒ named
//   qobj_memo     — no rule, nothing queued at first; then a record is
//                   parked by hand (no owner, a queue set)               ⇒ named after
//   qobj_note     — no rule, an OWNED record with a queue left on it     ⇒ not named
//   qobj_secret   — a record sitting in the queue, but the member may
//                   not read the object                                  ⇒ named for the admin only
// and one `ownership: 'org'` object, which carries no queue column at all.

const QOBJ_QUEUE = 'qobj_desk';
const qobjObject = (name: string, extra: Record<string, unknown> = {}) =>
  ObjectSchema.create({
    name,
    label: name,
    pluralLabel: name,
    fields: { name: Field.text({ label: 'Name', required: true }) },
    ...extra,
  } as never);

const qobjReader = PermissionSetSchema.parse({
  name: 'qobj_member_default',
  label: 'Queue objects fixture member (default)',
  isDefault: true,
  objects: {
    qobj_case: { allowRead: true },
    qobj_memo: { allowRead: true },
    qobj_note: { allowRead: true },
    qobj_catalog: { allowRead: true },
  },
});

const stackWithQueueObjects = () =>
  defineStack({
    manifest: {
      id: 'com.example.qobj-queue-objects',
      namespace: 'qobj',
      version: '0.0.1',
      type: 'app',
      name: 'Queue Objects Fixture',
    },
    objects: [
      qobjObject('qobj_case'),
      qobjObject('qobj_memo'),
      qobjObject('qobj_note'),
      qobjObject('qobj_secret'),
      qobjObject('qobj_catalog', { ownership: 'org' }),
    ],
    queues: [{ name: QOBJ_QUEUE, label: 'Desk', members: [] }],
    assignmentRules: [{
      name: 'qobj_case_intake',
      label: 'Case intake',
      object: 'qobj_case',
      entries: [{ name: 'all', assignTo: { type: 'queue', value: QOBJ_QUEUE } }],
    }],
    permissions: [qobjReader],
  } as never);

async function objectsUsingQueuesAs(stack: VerifyStack, token: string): Promise<{ tenantId: unknown; objects: unknown }> {
  const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
  expect(res.status).toBe(200);
  const raw: unknown = await res.json();
  const parsed = MePermissionsResponseSchema.safeParse(raw);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  const body = raw as { tenantId?: unknown; hasAnyQueue?: unknown; objectsUsingQueues?: unknown };
  expect(body.hasAnyQueue).toBe(true);
  return { tenantId: body.tenantId, objects: body.objectsUsingQueues };
}

describe('[#34602] /auth/me/permissions answers objectsUsingQueues through the real door', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let organizationId: string;

  /** A record written as the platform writes one, in the member's organization. */
  const systemInsert = (object: string, data: Record<string, unknown>) =>
    stack.hooks.run(object, 'insert', { organization_id: organizationId, ...data }, { system: true });

  beforeAll(async () => {
    stack = await bootStack(stackWithQueueObjects());
    admin = await stack.signIn();
    member = await stack.signUp('qobj-member@verify.test');
    organizationId = String((await objectsUsingQueuesAs(stack, member)).tenantId);
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a declared rule routing into a queue names its object before any record exists; nothing else is named', async () => {
    expect((await objectsUsingQueuesAs(stack, member)).objects).toEqual(['qobj_case']);
  });

  it('an owned record with a queue left on it does not name its object: the filter would not return it', async () => {
    await systemInsert('qobj_note', { name: 'owned', owner_id: (await stack.contextFor(admin)).userId, queue: QOBJ_QUEUE });
    expect((await objectsUsingQueuesAs(stack, member)).objects).toEqual(['qobj_case']);
  });

  it('a record parked in a queue by hand names its object from the next read on', async () => {
    await systemInsert('qobj_memo', { name: 'parked', owner_id: null, queue: QOBJ_QUEUE });
    expect((await objectsUsingQueuesAs(stack, member)).objects).toEqual(['qobj_case', 'qobj_memo']);
  });

  it('an object the member may not read is named for the admin, never for the member', async () => {
    await systemInsert('qobj_secret', { name: 'hidden', owner_id: null, queue: QOBJ_QUEUE });
    expect((await objectsUsingQueuesAs(stack, member)).objects).toEqual(['qobj_case', 'qobj_memo']);
    expect((await objectsUsingQueuesAs(stack, admin)).objects).toEqual(['qobj_case', 'qobj_memo', 'qobj_secret']);
  });
});
