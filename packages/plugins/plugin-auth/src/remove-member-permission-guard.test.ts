// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8289] Regression suite for "`organization/remove-member` answers a
// PERMISSION denial with `400 YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`".
//
// ## Where the wrong answer is minted (measured, not assumed)
//
// NOT in our packages. better-auth `1.7.0-rc.2`,
// `dist/plugins/organization/routes/crud-members.mjs`, the `removeMember`
// handler, runs its checks in this order:
//
//   1. resolve the caller's own member row              → 400 MEMBER_NOT_FOUND
//   2. resolve the target member row                    → 400 MEMBER_NOT_FOUND
//   3. `if (targetRoles.includes('owner')) {`
//        a. `if (!callerRoles.includes('owner'))`
//              throw 400 YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER  ← the defect
//        b. `if (ownerCount <= 1)`
//              throw 400 YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER  ← genuine
//      `}`
//   4. `hasPermission({ member: ['delete'] })`
//         → throw 401 UNAUTHORIZED YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER
//
// Step 3a is a PERMISSION rule ("only an owner may remove an owner") wearing the
// only-owner invariant's error code and status. It is also ordered AHEAD of the
// real permission check at step 4, so for any caller who is not an owner and any
// target who is, the permission check never runs and the invariant answers a
// question it was never asked. That is the filer's step 1 and step 2 exactly —
// and it is why adding a second owner does not change the answer: step 3a
// short-circuits before the owner COUNT at 3b is ever consulted.
//
// Step 4 carries a second, smaller parity defect: `UNAUTHORIZED` (401), where
// every sibling denial (`update-member-role`, `organization/update`,
// `organization/delete`) uses `FORBIDDEN` (403).
//
// ## The fix shape this pins
//
// We do NOT fork better-auth. `remove-member-permission-guard.ts` answers the
// permission class ITSELF, in the global before-hook, ahead of the vendor
// handler — so the two vendor branches above become unreachable for exactly the
// inputs they get wrong, while the genuine sole-owner invariant at 3b and every
// legitimate 200 path stay with the vendor, untouched.
//
// Real better-auth pipeline throughout, through a real `AuthManager` — the
// #5233 / #7725 precedent. The 400 in the field came out of the mounted route,
// so the mounted route is what has to answer here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const ORG = 'org_acme';
const PASSWORD = 'S3cure!Passw0rd-8289';

/**
 * The same minimal in-memory `IDataEngine` double the other end-to-end
 * auth-manager suites use, with `delete` pinned to ObjectQL's own dispatch
 * predicate ({@link assertEngineDeleteDispatch}) rather than a hand-written
 * copy — a fake that accepts a call the real engine refuses is how a dead route
 * ships with its suite green (#4550).
 */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any) {
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

type MemoryEngine = ReturnType<typeof createMemoryEngine>;

const makeManager = (engine: MemoryEngine) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as any,
    plugins: { organization: true },
  } as any);

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const post = (manager: AuthManager, path: string, body: unknown, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

const signUp = async (manager: AuthManager, engine: MemoryEngine, email: string) => {
  const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: email });
  expect(res.status, await res.clone().text()).toBe(200);
  const user = (engine.tables.get('sys_user') ?? []).find((u) => u.email === email);
  expect(user, `sign-up did not create ${email}`).toBeDefined();
  return { cookie: cookieFrom(res), userId: String(user!.id), email };
};

/** The membership rows for an org, as the database holds them. */
const membersOf = (engine: MemoryEngine, organizationId = ORG) =>
  (engine.tables.get('sys_member') ?? []).filter((m) => m.organization_id === organizationId);

/**
 * The filer's fixture: a workspace whose roles are seeded directly, the way an
 * operator's data looks. Returns the actors by the names the issue uses.
 */
const bootWorkspace = async (roles: Record<string, string>) => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);
  await engine.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme' });

  const actors: Record<string, { cookie: string; userId: string; email: string }> = {};
  let n = 0;
  for (const [who, role] of Object.entries(roles)) {
    const actor = await signUp(manager, engine, `${who}@example.com`);
    actors[who] = actor;
    await engine.insert('sys_member', {
      id: `mem_${++n}`,
      organization_id: ORG,
      user_id: actor.userId,
      role,
      created_at: new Date(),
    });
  }
  return { engine, manager, actors };
};

/** `POST organization/remove-member`, exactly as the console makes it. */
const removeMember = (
  manager: AuthManager,
  cookie: string,
  memberIdOrEmail: string,
) => post(manager, '/organization/remove-member', { memberIdOrEmail, organizationId: ORG }, cookie);

const answer = async (response: Response) => {
  const body = (await response.clone().json().catch(() => null)) as any;
  return { status: response.status, code: body?.code ?? null, message: body?.message ?? null };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('#8289 organization/remove-member — a permission denial answers as one', () => {
  // ── The defect, exactly as filed ────────────────────────────────────────
  it("step 1: a plain member removing the owner is refused as a PERMISSION denial, not as 'only owner'", async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.zhangsan!.cookie, actors.lisi!.email);

    expect(await answer(res)).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      message: 'You are not allowed to delete this member',
    });
    // The refusal is real — it always was; this card is about the ANSWER.
    expect(membersOf(engine)).toHaveLength(2);
  });

  it('step 2: adding a SECOND owner does not change the answer — the reason was never the owner count', async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      outsider: 'owner',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.zhangsan!.cookie, actors.outsider!.email);

    // Before the fix this returned the only-owner 400 even though TWO owners
    // exist — the clause was false and the status was wrong at the same time.
    expect(await answer(res)).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      message: 'You are not allowed to delete this member',
    });
    expect(membersOf(engine)).toHaveLength(3);
  });

  it('a plain member removing another plain member is refused as 403, not 401', async () => {
    // The vendor reaches its OWN permission check here and answers it with
    // `UNAUTHORIZED` (401) — right code, wrong status, and 401 tells a client
    // "you are not signed in" when they plainly are.
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
      wangwu: 'member',
    });

    const res = await removeMember(manager, actors.zhangsan!.cookie, actors.wangwu!.email);

    expect(await answer(res)).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      message: 'You are not allowed to delete this member',
    });
    expect(membersOf(engine)).toHaveLength(3);
  });

  it('an ADMIN removing an owner is refused as a permission denial too', async () => {
    // An admin passes better-auth's `member: ['delete']` permission but is not
    // an owner, so it is branch 3a's other inhabitant — and the one a
    // guard written as "plain members may not remove" would miss.
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      admin: 'admin',
    });

    const res = await removeMember(manager, actors.admin!.cookie, actors.lisi!.email);

    expect(await answer(res)).toEqual({
      status: 403,
      code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
      message: 'You are not allowed to delete this member',
    });
    expect(membersOf(engine)).toHaveLength(2);
  });

  // ── The invariant that must NOT be masked ───────────────────────────────
  it('the genuine sole-owner refusal still fires on the self-removal path', async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.lisi!.cookie, actors.lisi!.email);

    // Unchanged, and still the vendor's — this one is TRUE: the caller is
    // leaving, is an owner, and is the only owner.
    expect(await answer(res)).toEqual({
      status: 400,
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
      message: 'You cannot leave the organization as the only owner',
    });
    expect(membersOf(engine)).toHaveLength(2);
  });

  it('the sole-owner guard also still fires through organization/leave', async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
    });

    const res = await post(manager, '/organization/leave', { organizationId: ORG }, actors.lisi!.cookie);

    expect(await answer(res)).toEqual({
      status: 400,
      code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
      message: 'You cannot leave the organization as the only owner',
    });
    expect(membersOf(engine)).toHaveLength(2);
  });

  it('an owner who is NOT the last owner may still leave', async () => {
    // The other side of the invariant: the guard is about the LAST owner, so a
    // second owner leaving must succeed. A remap that swallowed the 400 would
    // not show up here, but a guard that over-refuses would.
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      outsider: 'owner',
    });

    const res = await post(manager, '/organization/leave', { organizationId: ORG }, actors.outsider!.cookie);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(membersOf(engine)).toHaveLength(1);
  });

  // ── The legitimate paths, still 200 ─────────────────────────────────────
  it('step 4a: an owner may remove the other owner', async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      outsider: 'owner',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.lisi!.cookie, actors.outsider!.email);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(membersOf(engine).map((m) => m.role).sort()).toEqual(['member', 'owner']);
  });

  it('step 4b: an owner may remove a plain member', async () => {
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.lisi!.cookie, actors.zhangsan!.email);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(membersOf(engine).map((m) => m.role)).toEqual(['owner']);
  });

  it('an admin may still remove a plain member', async () => {
    // The guard answers only the owner-target branch, so an admin's ordinary
    // authority is untouched — proof it did not over-refuse.
    const { manager, engine, actors } = await bootWorkspace({
      lisi: 'owner',
      admin: 'admin',
      zhangsan: 'member',
    });

    const res = await removeMember(manager, actors.admin!.cookie, actors.zhangsan!.email);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(membersOf(engine).map((m) => m.role).sort()).toEqual(['admin', 'owner']);
  });

  // ── The parity target the card names ────────────────────────────────────
  it('answers in the same envelope shape as its sibling update-member-role', async () => {
    const { manager, actors, engine } = await bootWorkspace({
      lisi: 'owner',
      zhangsan: 'member',
    });
    const [ownerRow] = membersOf(engine).filter((m) => m.user_id === actors.lisi!.userId);

    const sibling = await post(
      manager,
      '/organization/update-member-role',
      { memberId: String(ownerRow!.id), role: 'member', organizationId: ORG },
      actors.zhangsan!.cookie,
    );
    const removal = await removeMember(manager, actors.zhangsan!.cookie, actors.lisi!.email);

    const siblingAnswer = await answer(sibling);
    const removalAnswer = await answer(removal);

    // The parity the issue asks for: same status, same code FAMILY.
    expect(siblingAnswer.status).toBe(403);
    expect(siblingAnswer.code).toBe('YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER');
    expect(removalAnswer.status).toBe(siblingAnswer.status);
    expect(removalAnswer.code).toMatch(/^YOU_ARE_NOT_ALLOWED_TO_/);
  });
});
