// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0138 E1 — the guest's grants channel (D3) and the organization it acts in
// (D4), at the real door: an `authRequired: false` endpoint of
// `type: 'object_operation'` (D2 class 4), on a booted stack.
//
// What the record decides, and what this file holds at the door:
//
//  - D3 item 1: the guest envelope carries the sets bound to the `guest` anchor
//    position, read by the one binding reader every position uses — the
//    position's own declared sets (ADR-0131 D3/D4) — in the organization D4
//    resolves. A bound read set grants that object, and only that object.
//  - D3 item 2: nothing bound, nothing granted (the denial is the empty state).
//  - D3 item 3: one channel — the authenticated baseline, the `everyone` anchor
//    and the position-name fold never reach the guest.
//  - D4: the organization is derived when it is unique; a deployment that holds
//    several answers the located refusal at the door that needs one.
//  - D4 item 4: the public form doors keep their own posture, unchanged.
//  - D3 item 6: the guest's row scope for each sharing model, one pipeline.
//
// THE BINDING IS INSTALLED THROUGH THE REGISTRY'S BARE SLOT, by the test. The
// `guest` anchor is a built-in position `@objectstack/plugin-security` declares
// as packaged metadata, and this deployment offers no door that writes a set
// into its definition: the metadata door refuses an in-place write on a
// packaged position, and the audience-binding acceptance takes `everyone`
// suggestions only. The bare slot is where an environment definition of the
// anchor answers first (ADR-0005), which is the state D3 reads; installing it
// directly is the only way a boot can reach that state today. The case at the
// foot of this file records the refusal at the metadata door.
//
// The fixture is inline and throwaway, like the policy and guest fixtures beside
// it. Every anonymous endpoint carries the armed rate limit ADR-0121 D6 makes its
// publish obligation.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { definePermissionSet } from '@objectstack/spec/security';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import multiPackageStack from '@objectstack/example-multi-package';

const SYS = { context: { isSystem: true } } as const;
const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 1_000 };
const BASE = '/api/v1/apps/e1guest';
const FORM_SLUG = 'e1guest-intake';

/** One object per sharing model, plus the controls. */
const OBJ = {
  private: 'e1guest_private',
  publicRead: 'e1guest_public_read',
  publicReadExternal: 'e1guest_public_read_ext',
  publicReadWrite: 'e1guest_public_rw',
  parent: 'e1guest_parent',
  child: 'e1guest_child',
  unbound: 'e1guest_unbound',
  fold: 'e1guest_fold',
  intake: 'e1guest_intake',
} as const;

const text = () => ({ name: Field.text({ label: 'Name', required: true }) });
const object = (name: string, sharingModel: string, extra: Record<string, unknown> = {}) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: sharingModel as any, fields: text(), ...extra });

const objects = [
  object(OBJ.private, 'private'),
  object(OBJ.publicRead, 'public_read'),
  object(OBJ.publicReadExternal, 'public_read', { externalSharingModel: 'public_read' }),
  object(OBJ.publicReadWrite, 'public_read_write'),
  object(OBJ.parent, 'public_read'),
  ObjectSchema.create({
    name: OBJ.child,
    label: OBJ.child,
    pluralLabel: OBJ.child,
    sharingModel: 'controlled_by_parent',
    fields: { ...text(), parent: Field.masterDetail(OBJ.parent, { label: 'Parent', required: true }) },
  }),
  object(OBJ.unbound, 'public_read'),
  object(OBJ.fold, 'public_read'),
  object(OBJ.intake, 'private'),
];

/** The set the test binds to the `guest` anchor: read on the sharing-model objects, create on one. */
const GUEST_SET = 'e1guest_reader';
const GuestReader = definePermissionSet({
  name: GUEST_SET,
  label: 'E1 guest reader',
  objects: {
    [OBJ.private]: { allowRead: true },
    [OBJ.publicRead]: { allowRead: true },
    [OBJ.publicReadExternal]: { allowRead: true },
    [OBJ.publicReadWrite]: { allowRead: true, allowCreate: true },
    [OBJ.parent]: { allowRead: true },
    [OBJ.child]: { allowRead: true },
  },
});

/** A set that shares the anchor's NAME — the position-name fold's only route to the guest. */
const FoldSet = definePermissionSet({
  name: 'guest',
  label: 'Named like the guest anchor',
  objects: { [OBJ.fold]: { allowRead: true } },
});

/** The set the test binds to the `everyone` anchor — authenticated members only. */
const EVERYONE_SET = 'e1guest_everyone_reader';
const EveryoneReader = definePermissionSet({
  name: EVERYONE_SET,
  label: 'E1 everyone reader',
  objects: { [OBJ.unbound]: { allowRead: true } },
});

const find = (key: keyof typeof OBJ): ApiEndpoint => ({
  name: `e1guest_find_${key.toLowerCase()}`,
  path: `${BASE}/${key}`,
  method: 'GET',
  summary: `find ${key}`,
  description: `anonymous find on ${OBJ[key]}`,
  type: 'object_operation',
  objectParams: { object: OBJ[key], operation: 'find' },
  authRequired: false,
  rateLimit: ARMED,
} as ApiEndpoint);

const endpoints: ApiEndpoint[] = [
  find('private'),
  find('publicRead'),
  find('publicReadExternal'),
  find('publicReadWrite'),
  find('parent'),
  find('child'),
  find('unbound'),
  find('fold'),
  {
    name: 'e1guest_create_public_rw',
    path: `${BASE}/publicReadWrite`,
    method: 'POST',
    summary: 'create',
    description: 'anonymous create',
    type: 'object_operation',
    objectParams: { object: OBJ.publicReadWrite, operation: 'create' },
    authRequired: false,
    rateLimit: ARMED,
  } as ApiEndpoint,
];

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
    id: 'com.dogfood.guest-grants-channel',
    namespace: 'e1guest',
    version: '0.0.0',
    type: 'app',
    name: 'Guest Grants Channel Fixture',
    description: 'ADR-0138 E1: the guest anchor bindings, the guest organization, at the class-4 door.',
  },
  objects,
  views: [IntakeViews],
  permissions: [GuestReader, FoldSet, EveryoneReader],
  apis: endpoints,
} as any);

type Ctx = Record<string, any> | undefined;

let stack: VerifyStack;
let tempDir: string;
let adminToken: string;
let memberToken: string;
let ql: any;
let organizationId: string;
let parentId: string;
/** The context each engine `find` / `insert` on a fixture object was handed, in order. */
const engineCalls: Array<{ method: string; object: string; context: Ctx }> = [];

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-e1-guest-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(fixtureStack));
  stack = await bootStack(fixtureStack, {
    extraPlugins: [
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
  memberToken = await stack.signUp('e1guest-member@example.test', 'e1guest-member-pw-7311');

  ql = stack.kernel.getService<IObjectQLEngine>('objectql');
  const orgs = await ql.find('sys_organization', { fields: ['id'], limit: 5, ...SYS });
  expect(orgs, 'the fixture boots the single-organization deployment D4 derives from').toHaveLength(1);
  organizationId = String(orgs[0].id);

  // Two rows per object, written by the admin through the data door.
  for (const name of [OBJ.private, OBJ.publicRead, OBJ.publicReadExternal, OBJ.publicReadWrite, OBJ.parent, OBJ.unbound, OBJ.fold]) {
    for (const n of [1, 2]) {
      const res = await stack.apiAs(adminToken, 'POST', `/data/${name}`, { name: `${name}-seed-${n}` });
      expect(res.status, await res.clone().text()).toBe(201);
      if (name === OBJ.parent && n === 1) parentId = ((await res.json()) as { id: string }).id;
    }
  }
  for (const n of [1, 2]) {
    const res = await stack.apiAs(adminToken, 'POST', `/data/${OBJ.child}`, { name: `${OBJ.child}-seed-${n}`, parent: parentId });
    expect(res.status, await res.clone().text()).toBe(201);
  }

  const watched = new Set<string>(Object.values(OBJ));
  for (const [method, at] of [['find', 1], ['insert', 2]] as const) {
    const original = ql[method].bind(ql);
    vi.spyOn(ql, method).mockImplementation(async (...args: any[]) => {
      if (watched.has(args[0])) engineCalls.push({ method, object: args[0], context: args[at]?.context });
      return original(...args);
    });
  }
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await stack?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** Declare a definition of `position` in the registry's bare slot — where an environment definition answers first. */
function bindAnchor(position: 'guest' | 'everyone', permissionSets: string[]): void {
  ql.registry.registerItem('position', { name: position, label: position, permissionSets }, 'name');
}

async function anonymous(key: keyof typeof OBJ, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await stack.api(`/apps/e1guest/${key}`, init ?? { method: 'GET' });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: res.status, body, text };
}

function rowsOf(body: any): any[] {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.value)) return data.value;
  return [];
}

/** The permission-set names the security service resolves for the context the engine was last handed. */
async function resolvedSetNames(context: Ctx): Promise<string[]> {
  const security = stack.kernel.getService<any>('security');
  const sets = await security.resolvePermissionSetsForContext(context);
  return sets.map((s: any) => s.name).sort();
}

function lastContext(object: string): Ctx {
  return [...engineCalls].reverse().find((c) => c.object === object)?.context;
}

describe('ADR-0138 E1 — nothing bound: the guest is denied at the class-4 door (D3 item 2)', () => {
  it('a guest with no binding is refused 403 PERMISSION_DENIED, carrying the guest identity and no set', async () => {
    const res = await anonymous('publicRead');
    expect(res.status, res.text).toBe(403);
    expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(res.text).not.toContain(`${OBJ.publicRead}-seed-`);
    const ctx = lastContext(OBJ.publicRead);
    expect(ctx).toMatchObject({ principalKind: 'guest', positions: ['guest'], isSystem: false });
    expect(ctx).not.toHaveProperty('userId');
  });
});

describe('ADR-0138 E1 — one channel: the name fold, the baseline and `everyone` never reach the guest (D3 item 3)', () => {
  it('a set NAMED like the anchor is not folded into the guest\'s request', async () => {
    const res = await anonymous('fold');
    expect(res.status, res.text).toBe(403);
    expect(res.text).not.toContain(`${OBJ.fold}-seed-`);
    // Negative control: the set is real and grants — to the admin, by name.
    const admin = await stack.apiAs(adminToken, 'GET', `/data/${OBJ.fold}`);
    expect(admin.status).toBe(200);
  });

  it('the guest resolves neither the baseline nor the `everyone` anchor\'s sets, while a member resolves both', async () => {
    bindAnchor('everyone', ['member_default', EVERYONE_SET]);
    try {
      const res = await anonymous('unbound');
      expect(res.status, res.text).toBe(403);
      const names = await resolvedSetNames(lastContext(OBJ.unbound));
      expect(names).not.toContain('member_default');
      expect(names).not.toContain(EVERYONE_SET);
      // Negative control: a signed-in member reads the same object through `everyone`.
      const member = await stack.apiAs(memberToken, 'GET', `/data/${OBJ.unbound}`);
      expect(member.status, await member.clone().text()).toBe(200);
      expect(rowsOf(await member.json())).toHaveLength(2);
    } finally {
      bindAnchor('everyone', ['member_default']);
    }
  });
});

describe('ADR-0138 E1 — a bound read set grants that object only (D3 item 1, D4)', () => {
  beforeAll(() => bindAnchor('guest', [GUEST_SET]));

  it('the guest envelope carries the bound set and the derived organization, and resolves exactly that set', async () => {
    const res = await anonymous('publicRead');
    expect(res.status, res.text).toBe(200);
    const ctx = lastContext(OBJ.publicRead);
    expect(ctx).toMatchObject({ principalKind: 'guest', positions: ['guest'], isSystem: false, tenantId: organizationId });
    expect(ctx?.permissions).toEqual([GUEST_SET]);
    expect(ctx).not.toHaveProperty('userId');
    expect(await resolvedSetNames(ctx)).toEqual([GUEST_SET]);
  });

  it('an object the bound set does not name stays denied', async () => {
    const res = await anonymous('unbound');
    expect(res.status, res.text).toBe(403);
    expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
    expect(res.text).not.toContain(`${OBJ.unbound}-seed-`);
  });

  it('a create the set grants lands in the derived organization, with no owner', async () => {
    const res = await anonymous('publicReadWrite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e1guest-anonymous-write' }),
    });
    expect(res.status, res.text).toBe(201);
    const rows = await ql.find(OBJ.publicReadWrite, { where: { name: 'e1guest-anonymous-write' }, limit: 2, ...SYS });
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(organizationId);
    expect(rows[0].owner_id ?? null).toBeNull();
  });
});

describe('ADR-0138 E1 — the guest\'s row scope for each sharing model (D3 item 6)', () => {
  beforeAll(() => bindAnchor('guest', [GUEST_SET]));

  // Measured on this boot. The row-level pipeline is the one every caller
  // runs; the guest carries no user id and no external audience, so it is
  // judged against the INTERNAL dial (`sharingModel`), and `externalSharingModel`
  // is not read for it. See the E1 report: this reading is held for a ruling
  // against ADR-0090 D9's division of labour and D11.
  const cases: Array<[keyof typeof OBJ, number]> = [
    ['private', 0],
    ['publicRead', 2],
    ['publicReadExternal', 2],
    ['publicReadWrite', 3],
    ['parent', 2],
    ['child', 2],
  ];
  for (const [key, expected] of cases) {
    it(`${OBJ[key]}: the guest reads ${expected} row(s)`, async () => {
      const res = await anonymous(key);
      expect(res.status, res.text).toBe(200);
      expect(rowsOf(res.body)).toHaveLength(expected);
    });
  }
});

describe('ADR-0138 E1 — the form doors are unchanged (D4 item 4)', () => {
  it('an anonymous form submission answers 201 and lands in the organization it always did', async () => {
    const res = await stack.api(`/forms/${FORM_SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e1guest-form-row' }),
    });
    const text = await res.text();
    expect(res.status, text).toBe(201);
    const rows = await ql.find(OBJ.intake, { where: { name: 'e1guest-form-row' }, limit: 2, ...SYS });
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(organizationId);
  });
});

describe('ADR-0138 E1 — a multi-organization deployment answers the located refusal (D4 items 1, 5)', () => {
  beforeAll(async () => {
    bindAnchor('guest', [GUEST_SET]);
    await ql.insert('sys_organization', { name: 'E1 Second Organization', slug: 'e1guest-second' }, SYS);
  });

  it('the class-4 door refuses with NOT_IMPLEMENTED, naming the missing site binding, and serves nothing', async () => {
    const res = await anonymous('publicRead');
    expect(res.status, res.text).toBe(501);
    expect(res.body?.error?.code).toBe('NOT_IMPLEMENTED');
    expect(String(res.body?.error?.message)).toMatch(/site binding/);
    expect(res.text).not.toContain(`${OBJ.publicRead}-seed-`);
  });

  it('the form doors still answer as they did before E1 on the same deployment', async () => {
    const res = await stack.api(`/forms/${FORM_SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e1guest-form-row-multi' }),
    });
    const text = await res.text();
    // Recorded by E1's before/after reading; D4 item 4 keeps it as it is.
    expect(res.status, text).toBe(201);
  });
});

describe('ADR-0138 E1 — the anchor\'s definition has no authoring door (measured)', () => {
  it('the metadata door refuses a save of the packaged `guest` position', async () => {
    const res = await stack.apiAs(adminToken, 'PUT', '/meta/position/guest', {
      name: 'guest',
      label: 'Guest',
      permissionSets: [GUEST_SET],
    });
    const text = await res.text();
    expect(res.status, text).toBeGreaterThanOrEqual(400);
  });
});

/**
 * What a stack declares that would reach the guest: a `guest` position naming
 * sets (the anchor's binding — a package is refused the built-in name at the
 * package door, so this is expected empty by construction), and a set NAMED
 * `guest` (the fold's only route, which E1 closes for the guest).
 */
function guestReach(stack: { positions?: unknown; permissions?: unknown }): { anchorSets: string[]; foldSets: string[] } {
  const positions = (Array.isArray(stack.positions) ? stack.positions : []) as Array<{ name?: string; permissionSets?: string[] }>;
  const permissions = (Array.isArray(stack.permissions) ? stack.permissions : []) as Array<{ name?: string }>;
  return {
    anchorSets: positions.filter((p) => p?.name === 'guest').flatMap((p) => p.permissionSets ?? []),
    foldSets: permissions.filter((p) => p?.name === 'guest').map((p) => String(p.name)),
  };
}

describe('ADR-0138 E1 — the bindings that start granting, counted on the reference apps', () => {
  const apps: Array<[string, { positions?: unknown; permissions?: unknown }]> = [
    ['app-showcase', showcaseStack as any],
    ['app-crm', crmStack as any],
    ['app-multi-package', multiPackageStack as any],
  ];
  for (const [name, stack] of apps) {
    it(`${name}: no set starts granting to the guest, and no fold grant stops`, () => {
      expect(guestReach(stack)).toEqual({ anchorSets: [], foldSets: [] });
    });
  }

  it('control: the census counts a stack that declares a set named like the anchor', () => {
    expect(guestReach(fixtureStack as any)).toEqual({ anchorSets: [], foldSets: ['guest'] });
  });
});
