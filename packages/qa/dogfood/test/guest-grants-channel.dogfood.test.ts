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
//  - D3 item 6, as the maintainer's ruling C amends it (comment 6148183570 on
//    #23266): the guest's row scope is share links only — it never takes the
//    OWD branch, so a bound read set reads 0 rows under every sharing model,
//    while a share link still serves its one record.
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
import type { IObjectQLEngine, ISecurityService, SecurityContext } from '@objectstack/spec/contracts';
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
  // The share-link control's object: links on, and an eligibility predicate
  // only the first seed row meets.
  object(OBJ.publicRead, 'public_read', {
    publicSharing: { enabled: true, eligibility: `record.name == '${OBJ.publicRead}-seed-1'` },
  }),
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
let ql: IObjectQLEngine;
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
    const original = (ql as any)[method].bind(ql);
    vi.spyOn(ql as any, method).mockImplementation(async (...args: any[]) => {
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

/** The engine's registry seam — not part of the engine slot's contract, so it is typed here, narrowly. */
interface RegistrySeam {
  registry: { registerItem(type: string, item: Record<string, unknown>, key: string): void };
}

/** Declare a definition of `position` in the registry's bare slot — where an environment definition answers first. */
function bindAnchor(position: 'guest' | 'everyone', permissionSets: string[]): void {
  (ql as unknown as RegistrySeam).registry.registerItem('position', { name: position, label: position, permissionSets }, 'name');
}

async function anonymous(key: keyof typeof OBJ, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await stack.api(`/apps/e1guest/${key}`, init ?? { method: 'GET' });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: res.status, body, text };
}

/**
 * The rows a class-4 `find` endpoint answered. The answer's SHAPE is asserted,
 * never defaulted: a zero-row pin must not pass on a body it failed to read.
 */
function rowsOf(body: any): any[] {
  const records = body?.data?.records;
  expect(Array.isArray(records), JSON.stringify(body)).toBe(true);
  return records;
}

/** The permission-set names the security service resolves for the context the engine was last handed. */
async function resolvedSetNames(context: Ctx): Promise<string[]> {
  const security = stack.kernel.getService<ISecurityService>('security');
  const resolve = security.resolvePermissionSetsForContext;
  expect(resolve, 'the security service serves the set resolution').toBeTypeOf('function');
  const sets = await resolve!.call(security, (context ?? {}) as SecurityContext);
  return sets.map((s) => String(s.name)).sort();
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
      // Negative control: a signed-in member is admitted to the same object, and
      // it is `everyone`'s binding that admits it — the only set naming the object.
      const member = await stack.apiAs(memberToken, 'GET', `/data/${OBJ.unbound}`);
      expect(member.status, await member.clone().text()).toBe(200);
      const memberNames = await resolvedSetNames(lastContext(OBJ.unbound));
      expect(memberNames).toContain(EVERYONE_SET);
      expect(memberNames).toContain('member_default');
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

describe('ADR-0138 E1 — the guest\'s row scope is share links only, under every sharing model (D3 item 6, ruling C)', () => {
  beforeAll(() => bindAnchor('guest', [GUEST_SET]));

  // [ADR-0138 D3 item 6, as the maintainer's ruling C amends it — comment
  // 6148183570 on #23266] The guest never takes the OWD branch of the
  // row-level pipeline: not `sharingModel`, and not `externalSharingModel`
  // (which no runtime reads for anyone, #23268). It owns nothing (D1), so it
  // reaches rows only through share links. A guest with a bound read set and
  // no link is ADMITTED to each object (200: the set grants read) and reads
  // ZERO rows of it, whatever the object's sharing model — the `public_read`
  // object that also declares `externalSharingModel: 'public_read'` included.
  // The link control is the next block.
  const cases: Array<keyof typeof OBJ> = ['private', 'publicRead', 'publicReadExternal', 'publicReadWrite', 'parent', 'child'];
  for (const key of cases) {
    it(`${OBJ[key]}: the guest is admitted and reads 0 rows`, async () => {
      const res = await anonymous(key);
      expect(res.status, res.text).toBe(200);
      expect(rowsOf(res.body)).toHaveLength(0);
      // Control: the rows are there, and the object serves them — to the admin.
      const admin = await stack.apiAs(adminToken, 'GET', `/data/${OBJ[key]}`);
      expect(admin.status).toBe(200);
      const adminRows = ((await admin.json()) as { records?: unknown[] }).records;
      expect(adminRows?.length).toBeGreaterThan(0);
    });
  }
});

describe('ADR-0138 E1 — a share link still serves the guest its one record (ruling C closes the OWD branch, not links)', () => {
  const ELIGIBLE = `${OBJ.publicRead}-seed-1`;
  const idOf = async (name: string): Promise<string> =>
    String((await ql.find(OBJ.publicRead, { where: { name }, limit: 1, ...SYS }))[0].id);

  it('the guest redeems a link and reads the linked record, on an object whose rows it otherwise reads none of', async () => {
    const id = await idOf(ELIGIBLE);
    const minted = await stack.apiAs(adminToken, 'POST', '/share-links', { object: OBJ.publicRead, recordId: id });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { token } = ((await minted.json()) as { data: { token: string } }).data;

    const resolved = await stack.api(`/share-links/${encodeURIComponent(token)}/resolve`);
    const text = await resolved.text();
    expect(resolved.status, text).toBe(200);
    expect(JSON.parse(text).data.record.id).toBe(id);

    // Eligibility is held at every redemption: a record that stops qualifying
    // stops being served through the link already minted for it.
    await ql.update(OBJ.publicRead, { id, name: `${ELIGIBLE}-withdrawn` }, SYS);
    try {
      const after = await stack.api(`/share-links/${encodeURIComponent(token)}/resolve`);
      const afterText = await after.text();
      expect(after.status, afterText).toBe(404);
      expect(JSON.parse(afterText).error?.code).toBe('INVALID_OR_EXPIRED');
    } finally {
      await ql.update(OBJ.publicRead, { id, name: ELIGIBLE }, SYS);
    }
  });

  it('eligibility is held at the mint: a record that does not qualify gets no link', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/share-links', {
      object: OBJ.publicRead,
      recordId: await idOf(`${OBJ.publicRead}-seed-2`),
    });
    const text = await res.text();
    expect(res.status, text).toBe(422);
    expect(JSON.parse(text).error?.code).toBe('RECORD_NOT_ELIGIBLE');
  });
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

  it('the form doors keep their own answer on the same deployment, never the guest refusal', async () => {
    const res = await stack.api(`/forms/${FORM_SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'e1guest-form-row-multi' }),
    });
    const text = await res.text();
    // The reading before E1, on this same topology (measured at 197fbe2c04): the
    // form door carries no organization, and the engine refuses an
    // organization-less insert where the organization is not derivable
    // (ADR-0131 D9). D4 item 4 keeps the form doors as they are: the guest's
    // refusal does not reach them, because the form grant is not the guest.
    expect(res.status, text).toBe(500);
    expect(JSON.parse(text).code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
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
    // Measured: the built-in anchor is packaged metadata, sealed against an
    // in-place edit (ADR-0131; `position` takes no environment overlay).
    expect(res.status, text).toBe(403);
    expect(JSON.parse(text).code).toBe('NOT_OVERRIDABLE');
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
