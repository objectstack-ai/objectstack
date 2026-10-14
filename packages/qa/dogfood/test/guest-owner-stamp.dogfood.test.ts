// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0138 E3 — the owner-anchor stamp's guest branch (D1: the guest is a
// principal, never an owner), at the real doors, on a booted stack.
//
// The record's row for E3, one pin per clause:
//
//  1. a guest insert with nothing in the scenario setting an owner leaves it
//     unset — the stamp writes nothing for a caller with no user id;
//  2. an owner set by a hook or a record-change flow stands — those writers
//     run AFTER the stamp (a `beforeInsert` hook inside the engine's
//     operation) or as their own write (a flow), so the stamp never sees
//     their value as one the guest sent;
//  3. a guest-supplied owner is refused at an endpoint (D2 class 4) and
//     stripped at the form doors (D2 class 1, unchanged);
//  4. the owner column never holds the guest or the system principal.
//
// WHY A SET CARRYING THE TRANSFER BIT IS BOUND TO THE GUEST HERE. The anchor
// tier refuses such a set at every door that binds one
// (`describeAnchorForbiddenBits`, asserted below), so on a real deployment the
// generic forge rule already refuses a guest's owner for want of the transfer
// grant. The guest branch must not lean on that: D1 says the guest never owns
// and never assigns, whatever it is granted. The binding is installed through
// the registry's bare slot — the one route a boot has to that state, as the E1
// fixture beside this one explains — so the pins prove the branch holds on its
// own, and an ablation of it turns them red.
//
// There is no first-class assignment-rule mechanism on this platform: an
// assignment rule is written as a hook or a record-change flow, the two
// writers pin 2 exercises.
//
// The fixture is inline and throwaway. Every anonymous endpoint carries the
// armed rate limit ADR-0121 D6 makes its publish obligation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineView, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { definePermissionSet, describeAnchorForbiddenBits } from '@objectstack/spec/security';
import { SystemUserId } from '@objectstack/spec/system';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYS = { context: { isSystem: true } } as const;
const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 1_000 };
const BASE = '/api/v1/apps/e3guest';
const FORM_SLUG = 'e3guest-intake';
/** The user the scenario's own writers assign a guest-written row to. */
const QUEUE_USER = 'usr_e3guest_queue';
/** Every row the guest writes is named with this prefix, so the census can find them all. */
const GUEST_ROW = 'e3guest-anon-';

const OBJ = {
  lead: 'e3guest_lead',
  hooked: 'e3guest_hooked',
  flowed: 'e3guest_flowed',
  intake: 'e3guest_intake',
} as const;

const object = (name: string) =>
  ObjectSchema.create({
    name,
    label: name,
    pluralLabel: name,
    sharingModel: 'public_read_write',
    fields: { name: Field.text({ label: 'Name', required: true }) },
  });

/** The set bound to the guest: create (and read) on the three endpoint objects — the anchor tier admits it. */
const GUEST_WRITER = 'e3guest_writer';
const GuestWriter = definePermissionSet({
  name: GUEST_WRITER,
  label: 'E3 guest writer',
  objects: {
    [OBJ.lead]: { allowRead: true, allowCreate: true },
    [OBJ.hooked]: { allowRead: true, allowCreate: true },
    [OBJ.flowed]: { allowRead: true, allowCreate: true },
  },
});

/** The same, plus the transfer bit — refused by the anchor tier, installed through the bare slot. */
const GUEST_TRANSFER = 'e3guest_writer_transfer';
const GuestWriterTransfer = definePermissionSet({
  name: GUEST_TRANSFER,
  label: 'E3 guest writer with transfer',
  objects: { [OBJ.lead]: { allowRead: true, allowCreate: true, allowTransfer: true } },
});

/** The scenario's own record-change flow: it assigns every new flowed row to the queue user. */
const AssignFlow = defineFlow({
  name: 'e3guest_assign_owner',
  label: 'Assign the owner of a new request',
  description: 'Runs on create and assigns the row to the intake queue.',
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'On create', config: { objectName: OBJ.flowed, triggerType: 'record-after-create' } },
    {
      id: 'assign',
      type: 'update_record',
      label: 'Assign the owner',
      config: {
        objectName: OBJ.flowed,
        filter: { id: { dialect: 'cel', source: 'record.id' } },
        fields: { owner_id: QUEUE_USER },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'assign' },
    { id: 'e2', source: 'assign', target: 'end' },
  ],
});

const create = (key: 'lead' | 'hooked' | 'flowed'): ApiEndpoint => ({
  name: `e3guest_create_${key}`,
  path: `${BASE}/${key}`,
  method: 'POST',
  summary: `create ${key}`,
  description: `anonymous create on ${OBJ[key]}`,
  type: 'object_operation',
  objectParams: { object: OBJ[key], operation: 'create' },
  authRequired: false,
  rateLimit: ARMED,
} as ApiEndpoint);

const intakeData = { provider: 'object' as const, object: OBJ.intake };
const IntakeViews = defineView({
  list: { label: 'Intake', type: 'grid', data: intakeData, columns: [{ field: 'name' }] },
  formViews: {
    intake: {
      type: 'simple',
      data: intakeData,
      sections: [{ name: 'intake', label: 'Intake', columns: 1, fields: [{ field: 'name', required: true }] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${FORM_SLUG}` },
    },
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.guest-owner-stamp',
    namespace: 'e3guest',
    version: '0.0.0',
    type: 'app',
    name: 'Guest Owner Stamp Fixture',
    description: 'ADR-0138 E3: the owner-anchor stamp for a guest, at the class-4 endpoint door and the form door.',
  },
  // ADR-0097: the `record-after-create` start node needs the trigger pair declared.
  requires: ['automation', 'triggers'],
  objects: [object(OBJ.lead), object(OBJ.hooked), object(OBJ.flowed), object(OBJ.intake)],
  views: [IntakeViews],
  flows: [AssignFlow],
  permissions: [GuestWriter, GuestWriterTransfer],
  apis: [create('lead'), create('hooked'), create('flowed')],
} as any);

let stack: VerifyStack;
let tempDir: string;
let adminToken: string;
let adminId: string;
let ql: IObjectQLEngine;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-e3-guest-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(fixtureStack));
  stack = await bootStack(fixtureStack, {
    automation: true,
    extraPlugins: [
      new RecordChangeTriggerPlugin(),
      new MetadataPlugin({
        rootDir: tempDir,
        watch: false,
        artifactWatch: false,
        registerSystemObjects: false,
        artifactSource: { mode: 'local-file', path: artifactPath },
      }),
    ],
  });
  adminToken = await stack.signIn();
  ql = stack.kernel.getService<IObjectQLEngine>('objectql');

  const orgs = await ql.find('sys_organization', { fields: ['id'], limit: 5, ...SYS });
  expect(orgs, 'the fixture boots the single-organization deployment the guest entry derives from').toHaveLength(1);
  const admins = await ql.find('sys_user', { where: { email: 'admin@objectos.ai' }, fields: ['id'], limit: 2, ...SYS });
  expect(admins).toHaveLength(1);
  adminId = String(admins[0].id);

  // The scenario's assignee, and the legacy system-principal row an older
  // runtime may still hold — present, so a forged reference to it resolves and
  // only the stamp's own verdict stands between it and the column.
  await ql.insert('sys_user', { id: QUEUE_USER, email: 'e3guest-queue@example.test', name: 'Intake queue', email_verified: true }, SYS);
  await ql.insert('sys_user', { id: SystemUserId.SYSTEM, email: 'e3guest-system@example.test', name: 'System', email_verified: true }, SYS);

  // The scenario's own hook: every new hooked row is assigned to the queue user.
  (ql as unknown as HookSeam).registerHook(
    'beforeInsert',
    async (hookCtx: any) => {
      if (hookCtx?.input?.data && typeof hookCtx.input.data === 'object') hookCtx.input.data.owner_id = QUEUE_USER;
    },
    { object: OBJ.hooked },
  );

  bindGuest([GUEST_WRITER]);
}, 180_000);

afterAll(async () => {
  await stack?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** The engine's hook and registry seams — not part of the engine slot's contract, so typed here, narrowly. */
interface HookSeam {
  registerHook(event: string, handler: (ctx: unknown) => Promise<void>, options?: { object?: string }): void;
}
interface RegistrySeam {
  registry: { registerItem(type: string, item: Record<string, unknown>, key: string): void };
}

/** Declare a definition of the `guest` anchor in the registry's bare slot — where an environment definition answers first. */
function bindGuest(permissionSets: string[]): void {
  (ql as unknown as RegistrySeam).registry.registerItem('position', { name: 'guest', label: 'guest', permissionSets }, 'name');
}

async function anonymousCreate(key: 'lead' | 'hooked' | 'flowed', body: Record<string, unknown>) {
  const res = await stack.api(`/apps/e3guest/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  return { status: res.status, body: parsed, text };
}

async function rowsNamed(object: string, name: string): Promise<any[]> {
  return (await ql.find(object, { where: { name }, limit: 5, ...SYS })) as any[];
}

/** The owner of the one row named `name` on `object`, as stored. */
async function storedOwner(object: string, name: string): Promise<unknown> {
  const rows = await rowsNamed(object, name);
  expect(rows, `exactly one '${name}' row on ${object}`).toHaveLength(1);
  return rows[0].owner_id ?? null;
}

/** 403 PERMISSION_DENIED (ADR-0112: code + status), and the row was never written. */
async function expectOwnerRefused(res: { status: number; body: any; text: string }, object: string, name: string) {
  expect(res.status, res.text).toBe(403);
  expect(res.body?.error?.code, res.text).toBe('PERMISSION_DENIED');
  expect(await rowsNamed(object, name), 'a refused guest write lands no row').toHaveLength(0);
}

describe('ADR-0138 E3 pin 1 — a guest insert with nothing setting an owner leaves it unset', () => {
  it('the class-4 door writes the guest\'s row with no owner — never the guest, never the system principal', async () => {
    const name = `${GUEST_ROW}lead-plain`;
    const res = await anonymousCreate('lead', { name });
    expect(res.status, res.text).toBe(201);
    expect(await storedOwner(OBJ.lead, name)).toBeNull();
  });

  it('a supplied empty owner is no owner: the row stays unset', async () => {
    for (const [suffix, owner_id] of [['null', null], ['blank', '']] as const) {
      const name = `${GUEST_ROW}lead-empty-${suffix}`;
      const res = await anonymousCreate('lead', { name, owner_id });
      expect(res.status, res.text).toBe(201);
      expect(await storedOwner(OBJ.lead, name)).toBeNull();
    }
  });

  it('control: the stamp is live on this object — a signed-in caller\'s row is stamped with its own id', async () => {
    const name = 'e3guest-admin-stamped';
    const res = await stack.apiAs(adminToken, 'POST', `/data/${OBJ.lead}`, { name });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await storedOwner(OBJ.lead, name)).toBe(adminId);
  });
});

describe('ADR-0138 E3 pin 2 — an owner the scenario sets stands', () => {
  it('a `beforeInsert` hook\'s owner stands on the guest\'s row', async () => {
    const name = `${GUEST_ROW}hooked`;
    const res = await anonymousCreate('hooked', { name });
    expect(res.status, res.text).toBe(201);
    expect(await storedOwner(OBJ.hooked, name)).toBe(QUEUE_USER);
  });

  it('a record-change flow\'s owner stands on the guest\'s row', async () => {
    const name = `${GUEST_ROW}flowed`;
    const res = await anonymousCreate('flowed', { name });
    expect(res.status, res.text).toBe(201);
    // The flow is its own write, after the insert; wait for it, bounded.
    let owner: unknown = null;
    for (let i = 0; i < 50 && owner !== QUEUE_USER; i += 1) {
      owner = await storedOwner(OBJ.flowed, name);
      if (owner !== QUEUE_USER) await new Promise((r) => setTimeout(r, 100));
    }
    expect(owner).toBe(QUEUE_USER);
  });

  it('control: without the scenario\'s writer the same guest row has no owner, so the owner above is theirs', async () => {
    // Pin 1's row: the plain object carries no hook and no flow.
    expect(await storedOwner(OBJ.lead, `${GUEST_ROW}lead-plain`)).toBeNull();
  });
});

describe('ADR-0138 E3 pin 3 — a guest-supplied owner is refused at the endpoint door and stripped at the form door', () => {
  it('the class-4 door refuses a guest naming a real user as the owner', async () => {
    const name = `${GUEST_ROW}lead-forged-admin`;
    await expectOwnerRefused(await anonymousCreate('lead', { name, owner_id: adminId }), OBJ.lead, name);
  });

  it('the refusal holds whatever the guest is granted: a guest holding the transfer bit is refused too', async () => {
    // Production cannot bind this set to the guest — the anchor tier refuses it.
    expect(describeAnchorForbiddenBits(GuestWriterTransfer, 'guest')).not.toBeNull();
    bindGuest([GUEST_TRANSFER, GUEST_WRITER]);
    try {
      const name = `${GUEST_ROW}lead-forged-admin-transfer`;
      await expectOwnerRefused(await anonymousCreate('lead', { name, owner_id: adminId }), OBJ.lead, name);
      // Control: the same guest, the same grant, no owner — admitted and unset.
      const plain = `${GUEST_ROW}lead-transfer-plain`;
      const res = await anonymousCreate('lead', { name: plain });
      expect(res.status, res.text).toBe(201);
      expect(await storedOwner(OBJ.lead, plain)).toBeNull();
    } finally {
      bindGuest([GUEST_WRITER]);
    }
  });

  it('control: a caller who holds the transfer authority sets the same owner on the same object', async () => {
    const name = 'e3guest-admin-assigned';
    const res = await stack.apiAs(adminToken, 'POST', `/data/${OBJ.lead}`, { name, owner_id: QUEUE_USER });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await storedOwner(OBJ.lead, name)).toBe(QUEUE_USER);
  });

  it('the form door strips a submitted owner and leaves the row unset, as it does today', async () => {
    const name = `${GUEST_ROW}intake-forged`;
    const res = await stack.api(`/forms/${FORM_SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, owner_id: adminId }),
    });
    const text = await res.text();
    expect(res.status, text).toBe(201);
    expect(await storedOwner(OBJ.intake, name)).toBeNull();
  });

  it('control: the form object\'s owner column takes a value from a caller with the authority', async () => {
    const name = 'e3guest-admin-intake';
    const res = await stack.apiAs(adminToken, 'POST', `/data/${OBJ.intake}`, { name, owner_id: QUEUE_USER });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await storedOwner(OBJ.intake, name)).toBe(QUEUE_USER);
  });
});

describe('ADR-0138 E3 pin 4 — the owner column never holds the guest or the system principal', () => {
  it('a guest naming the system principal, or itself, as the owner is refused — the transfer bit notwithstanding', async () => {
    bindGuest([GUEST_TRANSFER, GUEST_WRITER]);
    try {
      for (const [suffix, owner] of [['system', SystemUserId.SYSTEM], ['guest', 'guest']] as const) {
        const name = `${GUEST_ROW}lead-forged-${suffix}`;
        await expectOwnerRefused(await anonymousCreate('lead', { name, owner_id: owner }), OBJ.lead, name);
      }
    } finally {
      bindGuest([GUEST_WRITER]);
    }
  });

  it('census: every row the guest wrote holds no owner or the scenario\'s, and none holds the guest or the system principal', async () => {
    const census: Array<{ object: string; name: string; owner: unknown }> = [];
    for (const object of Object.values(OBJ)) {
      const rows = (await ql.find(object, { fields: ['name', 'owner_id'], limit: 500, ...SYS })) as any[];
      for (const row of rows) {
        if (String(row.name).startsWith(GUEST_ROW)) census.push({ object, name: row.name, owner: row.owner_id ?? null });
      }
    }
    // The census saw every guest row the pins above wrote, and only those.
    expect(census.map((c) => c.name).sort()).toEqual([
      `${GUEST_ROW}flowed`,
      `${GUEST_ROW}hooked`,
      `${GUEST_ROW}intake-forged`,
      `${GUEST_ROW}lead-empty-blank`,
      `${GUEST_ROW}lead-empty-null`,
      `${GUEST_ROW}lead-plain`,
      `${GUEST_ROW}lead-transfer-plain`,
    ]);
    for (const entry of census) {
      expect([null, QUEUE_USER], `${entry.object} '${entry.name}'`).toContain(entry.owner);
    }
  });
});
