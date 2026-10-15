// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#23546 · ADR-0131 D7] Under a wall the AUTHORING TRAIL doors refuse an
// organization admin, on a REAL booted stack.
//
// What this harness measured before the narrowing (objectstack `main` at
// `286eb9ef32`), under both walled postures: an organization's owner (rung
// `TENANT_ADMIN`, holding `setup.access`, `setup.write`, `manage_org_users` and
// `manage_mailboxes`, and neither `studio.access` nor `manage_metadata`)
// answered 200 with the operator's trail at all four doors:
//   - `GET /meta/:type/:name/history` (5 events), `/audit` (5 rows) and
//     `/diff` (the operator's superseded versions), served by `RestServer`;
//   - `GET /packages/:id/commits` (2 commits), served by the runtime dispatcher.
// No organization authors that trail (ADR-0131 C5), and the data door on the
// same three tables already refused the same admin
// (`requiredPermissions: ['studio.access']`, ADR-0131 D7).
//
// Pinned here, under each walled posture: the organization admin gets 403 at
// all four doors (`FORBIDDEN` at the three `/meta` doors, `PERMISSION_DENIED`
// at the commits door), and no part of the trail is in the body. CONTROLS: an
// organization owner who differs from that admin by `studio.access` alone
// reads all four, as the platform operator does; and the draft switches
// (`GET /meta/_drafts`, `?state=draft`, `?preview=draft`) and the other three
// package reads answer the organization admin exactly as they did before.
// Under `single`: a `manage_metadata` holder reads history, audit and diff
// (CONTROL); the commits door, which never admitted `manage_metadata`, still
// refuses it (CONTROL: no door gains a capability); and a `setup.access`-only
// holder is refused all four, because the narrowing is not a posture branch.
//
// The boot is `multiTenant: 'posture-only'`, a real, non-degraded walled
// posture, copied from `wall-package-doors-refusal.dogfood.test.ts`. The
// harness declares the seeded admin as `OS_PLATFORM_OWNER_EMAIL`, so that admin
// is the platform operator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true, positions: [], permissions: [] };

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

const set = (name: string, systemPermissions: string[]) => ({ name, label: name, objects: {}, systemPermissions });

const OP_PKG = 'com.t23546.operator';
/** The operator's item: two published saves, then a pending draft. */
const OP_SET = 't23546_set';
const STUDIO_SET = 't23546_studio';
const AUTHOR_SET = 't23546_author';
const SETUP_SET = 't23546_setup';
/** What the operator's pending draft of `OP_SET` grants: only the draft switches serve it. */
const DRAFT_GRANTS = ['manage_users', 'manage_mailboxes'];

const TRAIL = {
  history: `/meta/permission/${OP_SET}/history`,
  audit: `/meta/permission/${OP_SET}/audit`,
  diff: `/meta/permission/${OP_SET}/diff`,
  commits: `/packages/${OP_PKG}/commits`,
} as const;
type Door = keyof typeof TRAIL;
const DOORS = Object.keys(TRAIL) as Door[];
const META_DOORS: readonly Door[] = ['history', 'audit', 'diff'];
/** The refusal code each door answers: `RestServer`'s explicit one, the dispatcher's derived one. */
const REFUSAL_CODE: Record<Door, string> = {
  history: 'FORBIDDEN',
  audit: 'FORBIDDEN',
  diff: 'FORBIDDEN',
  commits: 'PERMISSION_DENIED',
};

/** How much trail an admitted answer carries: events, rows, the newest version, commits. */
function trailSize(door: Door, body: any): number {
  if (door === 'history' || door === 'audit') return Array.isArray(body?.events) ? body.events.length : -1;
  if (door === 'diff') return typeof body?.toVersion === 'number' ? body.toVersion : -1;
  return Array.isArray(body?.data?.commits) ? body.data.commits.length : -1;
}

interface Harness {
  stack: VerifyStack;
  ql: Engine;
  operator: string;
  operatorId: string;
  tokAdmin: string;
  tokStudio: string;
  tokAuthor: string;
  tokSetup: string;
  admin: string;
  studio: string;
  author: string;
  setup: string;
  orgs: Record<'admin' | 'studio' | 'author', string | undefined>;
}

/**
 * Boot, sign in the operator, and sign up four users. Under a wall the admin,
 * the studio author and the metadata author each create an organization and
 * own it. The operator creates `OP_PKG`, publishes `OP_SET` twice and leaves a
 * third save pending as a draft. The studio author is granted `studio.access`
 * and the metadata author `manage_metadata`, inside their own organization
 * under a wall. Under `single` a fourth user is granted `setup.access` alone.
 */
async function boot(posture: 'isolated' | 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  const stack = await bootStack(crmStack as never, walled ? { multiTenant: 'posture-only' } : {});
  const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
  const email = (who: string) => `t23546-${who}-${posture}@wall.test`;
  const operator = await stack.signIn();
  const tokAdmin = await stack.signUp(email('admin'));
  const tokStudio = await stack.signUp(email('studio'));
  const tokAuthor = await stack.signUp(email('author'));
  const tokSetup = await stack.signUp(email('setup'));
  const orgs: Harness['orgs'] = { admin: undefined, studio: undefined, author: undefined };
  if (walled) {
    for (const [who, tok] of [['admin', tokAdmin], ['studio', tokStudio], ['author', tokAuthor]] as const) {
      const slug = `t23546-${who}-${posture}`;
      const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
      expect(created.status, await created.clone().text()).toBe(200);
      orgs[who] = ((await created.json()) as { id: string }).id;
      const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(active.status, await active.clone().text()).toBe(200);
    }
  }
  const idOf = async (address: string) =>
    String((await ql.find('sys_user', { where: { email: address }, limit: 1, context: SYS }))[0]?.id);
  const ok = async (res: Response, status = 200) => expect(res.status, await res.clone().text()).toBe(status);

  await ok(await stack.apiAs(operator, 'POST', '/packages', { id: OP_PKG, name: 't23546 operator', version: '1.0.0', type: 'app' }), 201);
  for (const [name, caps] of [[STUDIO_SET, ['studio.access']], [AUTHOR_SET, ['manage_metadata']], [SETUP_SET, ['setup.access']]] as const) {
    await ok(await stack.apiAs(operator, 'PUT', `/meta/permission/${name}?package=${OP_PKG}`, set(name, [...caps])));
  }
  await ok(await stack.apiAs(operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, [])));
  await ok(await stack.apiAs(operator, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
  await ok(await stack.apiAs(operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, ['manage_users'])));
  await ok(await stack.apiAs(operator, 'POST', `/packages/${OP_PKG}/publish-drafts`, {}));
  await ok(await stack.apiAs(operator, 'PUT', `/meta/permission/${OP_SET}?package=${OP_PKG}&mode=draft`, set(OP_SET, DRAFT_GRANTS)));

  const h: Harness = {
    stack, ql, operator, tokAdmin, tokStudio, tokAuthor, tokSetup, orgs,
    operatorId: '',
    admin: await idOf(email('admin')),
    studio: await idOf(email('studio')),
    author: await idOf(email('author')),
    setup: await idOf(email('setup')),
  };
  const grant = (user: string, permissionSet: string, org: string | undefined) =>
    ql.insert('sys_user_permission_set', { user_id: user, permission_set: permissionSet, ...(org ? { organization_id: org } : {}) },
      { context: { ...SYS, ...(org ? { tenantId: org } : {}) } });
  await grant(h.studio, STUDIO_SET, orgs.studio);
  await grant(h.author, AUTHOR_SET, orgs.author);
  if (!walled) await grant(h.setup, SETUP_SET, undefined);
  const me = await stack.apiAs(operator, 'GET', '/auth/get-session');
  h.operatorId = String(((await me.json().catch(() => ({}))) as { user?: { id?: string } })?.user?.id ?? '');
  return h;
}

const grantsOf = (h: Harness, user: string, org: string | undefined) =>
  resolveUserAuthzGrants(h.ql as never, user, org ? { tenantId: org } : {});

async function get(h: Harness, token: string, path: string): Promise<{ status: number; body: any; text: string }> {
  const res = await h.stack.apiAs(token, 'GET', path);
  const text = await res.clone().text();
  const body = await res.json().catch(() => null);
  return { status: res.status, body, text };
}

/** A refusal: status, code, and nothing of the trail or the item in the body. */
async function expectRefused(h: Harness, token: string, door: Door) {
  const res = await get(h, token, TRAIL[door]);
  expect({ status: res.status, code: res.body?.error?.code }, `${door}: ${res.text}`)
    .toEqual({ status: 403, code: REFUSAL_CODE[door] });
  for (const leaked of [OP_SET, OP_PKG, '"events"', '"commits"', '"toVersion"', ...(h.operatorId ? [h.operatorId] : [])]) {
    expect(res.text, `${door} carries ${leaked}`).not.toContain(leaked);
  }
}

/** An admission: 200 with the same trail the platform operator reads. */
async function expectAdmitted(h: Harness, token: string, door: Door) {
  const res = await get(h, token, TRAIL[door]);
  expect(res.status, `${door}: ${res.text}`).toBe(200);
  const operator = await get(h, h.operator, TRAIL[door]);
  expect(trailSize(door, res.body), door).toBeGreaterThan(0);
  expect(trailSize(door, res.body), door).toBe(trailSize(door, operator.body));
}

for (const posture of ['isolated', 'group'] as const) {
  describe(`[#23546 · ADR-0131 D7] ${posture}: the authoring-trail doors refuse an organization admin`, () => {
    let h: Harness;
    const previous = process.env.OS_TENANCY_POSTURE;

    beforeAll(async () => { h = await boot(posture); }, 180_000);
    afterAll(async () => {
      await h?.stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture; the admin holds setup.access and neither platform authoring capability; the studio author differs by studio.access alone', async () => {
      const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      const admin = await grantsOf(h, h.admin, h.orgs.admin);
      expect(admin.systemPermissions).toContain('setup.access');
      expect(admin.systemPermissions).not.toContain('studio.access');
      expect(admin.systemPermissions).not.toContain('manage_metadata');
      expect(admin.posture).not.toBe('PLATFORM_ADMIN');
      const studio = await grantsOf(h, h.studio, h.orgs.studio);
      expect(studio.posture).not.toBe('PLATFORM_ADMIN');
      const extra = [...studio.systemPermissions].filter((c) => !admin.systemPermissions.includes(c));
      expect(extra).toEqual(['studio.access']);
      expect([...admin.systemPermissions].filter((c) => !studio.systemPermissions.includes(c))).toEqual([]);
      expect(h.operatorId).not.toBe('');
    });

    for (const door of DOORS) {
      it(`${door}: the organization admin is refused, with none of the trail`, async () => {
        await expectRefused(h, h.tokAdmin, door);
      });

      it(`${door}: CONTROL — the organization owner holding studio.access reads the trail the operator reads`, async () => {
        await expectAdmitted(h, h.tokStudio, door);
      });
    }

    it('CONTROL: the draft switches answer the organization admin as before — the pending draft listed, read and previewed', async () => {
      const drafts = await get(h, h.tokAdmin, '/meta/_drafts');
      expect(drafts.status, drafts.text).toBe(200);
      expect((drafts.body?.drafts ?? []).map((d: any) => `${d.type}/${d.name}`)).toContain(`permission/${OP_SET}`);
      for (const switchName of ['state', 'preview'] as const) {
        const res = await get(h, h.tokAdmin, `/meta/permission/${OP_SET}?${switchName}=draft`);
        expect(res.status, res.text).toBe(200);
        expect(res.body?.item?.systemPermissions, switchName).toEqual(DRAFT_GRANTS);
      }
    });

    it('CONTROL: the other package reads still answer the organization admin — only the commits door narrowed', async () => {
      for (const path of ['/packages', `/packages/${OP_PKG}`, `/packages/${OP_PKG}/export`]) {
        const res = await get(h, h.tokAdmin, path);
        expect(res.status, `${path}: ${res.text}`).toBe(200);
      }
    });
  });
}

describe('[#23546] single: the narrowing is not a posture branch, and no door gains a capability', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('guard the guard: the metadata author holds manage_metadata alone; the setup holder holds setup.access alone', async () => {
    const author = await grantsOf(h, h.author, undefined);
    expect([...author.systemPermissions].sort()).toEqual(['manage_metadata']);
    expect(author.posture).not.toBe('PLATFORM_ADMIN');
    const setup = await grantsOf(h, h.setup, undefined);
    expect([...setup.systemPermissions].sort()).toEqual(['setup.access']);
  });

  for (const door of META_DOORS) {
    it(`${door}: CONTROL — a manage_metadata holder reads the trail the operator reads`, async () => {
      await expectAdmitted(h, h.tokAuthor, door);
    });
  }

  it('commits: CONTROL — the commits door never admitted manage_metadata, and still refuses it', async () => {
    await expectRefused(h, h.tokAuthor, 'commits');
  });

  for (const door of DOORS) {
    it(`${door}: a setup.access-only holder is refused here too`, async () => {
      await expectRefused(h, h.tokSetup, door);
    });
  }
});
