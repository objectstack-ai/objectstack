// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// MEASUREMENT PROBE for #10792 — not a pin. Records readings; asserts only the
// apparatus (that the derivation/boot produced something to read).
//
// One boot, all arms side by side:
//   REAL ARM      — showcase stack on the sqlite-wasm SQL driver (bootStack's
//                   default datasource), i.e. a driver with beginTransaction.
//   HERMETIC ARM  — the same AuthManager over an in-memory fake engine, with
//                   (a) no `transaction` method and (b) a pass-through one.
//   ENGINE ARM    — a session read done directly through ObjectQL, inside and
//                   outside a real engine.transaction(), same run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuthManager } from '@objectstack/plugin-auth';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SysMember } from '@objectstack/platform-objects';
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.PROBE_OUT ?? '/tmp/probe-10792.txt';

const SYS = { isSystem: true };
const LOG: string[] = [];
const rec = (line: string) => {
  LOG.push(line);
  try { appendFileSync(OUT, line + '\n'); } catch { /* best effort */ }
};

interface Answer { status: number; code?: string; body: string }

// ─────────────────────────── hermetic fixture ────────────────────────────
const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000';
const DEFAULT_ORG = 'org_default';
const PASSWORD = 'S3cure!Passw0rd-10792';

const referentialRule = (): 'cascade' | 'restrict' | 'set_null' => {
  const field = (SysMember.fields as Record<string, any>).user_id;
  const declared = (field?.deleteBehavior as string | undefined) ?? 'set_null';
  if (declared === 'set_null' && field?.required === true) return 'restrict';
  return declared as 'cascade' | 'restrict' | 'set_null';
};

/** @param mode 'none' = no transaction method; 'passthrough' = calls the callback. */
const createMemoryEngine = (mode: 'none' | 'passthrough') => {
  const tables = new Map<string, any[]>();
  const rows = (n: string) => { if (!tables.has(n)) tables.set(n, []); return tables.get(n)!; };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, (v as any).$ne);
        if ('$in' in v) return ((v as any).$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > (v as any).$gt;
        if ('$gte' in v) return actual >= (v as any).$gte;
        if ('$lt' in v) return actual < (v as any).$lt;
        if ('$lte' in v) return actual <= (v as any).$lte;
        if ('$regex' in v) return new RegExp(String((v as any).$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });
  const assertMemberUnique = (name: string, candidate: any, ignoreId?: string) => {
    if (name !== 'sys_member') return;
    const clash = rows(name).some(
      (r) => r.id !== ignoreId && eq(r.organization_id, candidate.organization_id) && eq(r.user_id, candidate.user_id),
    );
    if (clash) throw new Error('insert into sys_member … UNIQUE constraint failed');
  };
  let seq = 0;
  const engine: any = {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      assertMemberUnique(name, row);
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const f = rows(name).find((r) => matches(r, q.where));
      return f ? { ...f } : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) out = [...out].sort((a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1));
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      assertMemberUnique(name, { ...row, ...patch }, row.id);
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      if (name === 'sys_user') {
        const targets = rows(name).filter((r) => matches(r, q.where));
        for (const target of targets) {
          const deps = rows('sys_member').filter((m) => eq(m.user_id, target.id));
          if (deps.length > 0) {
            const rule = referentialRule();
            if (rule === 'restrict') { const e: any = new Error('DELETE_RESTRICTED'); e.code = 'DELETE_RESTRICTED'; e.status = 409; throw e; }
            for (const dep of deps) {
              if (rule === 'cascade') await engine.delete('sys_member', { where: { id: dep.id } });
              else await engine.update('sys_member', { id: dep.id, user_id: null });
            }
          }
        }
      }
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
  if (mode === 'passthrough') {
    engine.transaction = async <T,>(cb: (c: any, i: any) => Promise<T>): Promise<T> =>
      await cb({ transaction: { id: 'tx_passthrough' } }, { owned: true });
  }
  return engine;
};

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    membershipPolicy: 'auto',
    getTenancy: () => ({
      posture: 'single', requestedPosture: 'single', isolationActive: false,
      requested: false, degraded: false, defaultOrgId: async () => DEFAULT_ORG,
    }) as any,
    plugins: { admin: true },
  } as any);

const cookieFrom = (r: Response): string =>
  (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]).filter(Boolean).join('; ');

const hPost = (m: AuthManager, path: string, body: unknown, cookie?: string) =>
  m.handleRequest(new Request(`${BASE}/api/v1/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));

const hSignUp = async (m: AuthManager, engine: any, email: string) => {
  const res = await hPost(m, '/sign-up/email', { email, password: PASSWORD, name: email });
  const user = (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
  return { status: res.status, cookie: cookieFrom(res), userId: user ? String(user.id) : undefined };
};

const readAnswer = async (res: Response): Promise<Answer> => {
  const body = await res.text();
  let code: string | undefined;
  try { const p = JSON.parse(body); code = p?.error?.code ?? p?.code; } catch { /* non-JSON */ }
  return { status: res.status, code, body: body.slice(0, 240) };
};

// ─────────────────────────────── the run ─────────────────────────────────
describe('#10792 probe — does the erasure transaction hide the caller session?', () => {
  let stack: VerifyStack;
  let priorScim: string | undefined;
  let ql: any;

  let adminToken = '';        // seeded platform admin (legacy role scalar = 'user')
  let memberToken = '';       // plain member
  let legacyAdminToken = '';  // fixture user carrying user.role === 'admin'
  let legacyAdminId = '';
  const targets: string[] = [];

  const answers: Record<string, Answer> = {};
  const fire = async (key: string, token: string | undefined, verb: string, path: string, body?: unknown) => {
    const res = token
      ? await stack.apiAs(token, verb, path, body)
      : await stack.api(path, {
          method: verb,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
    const a = await readAnswer(res);
    answers[key] = a;
    rec(`${key.padEnd(38)} -> ${a.status} ${a.code ?? ''} ${a.body}`);
    return a;
  };

  beforeAll(async () => {
    try { writeFileSync(OUT, '===== #10792 PROBE =====\n'); } catch { /* best effort */ }
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    ql = await stack.kernel.getServiceAsync('objectql');

    adminToken = await stack.signIn();
    memberToken = await stack.signUp('p10792.member@example.com', 'Member-Pass-123');

    await stack.signUp('p10792.legacyadmin@example.com', 'Legacy-Pass-123');
    const [la] = await ql.find('sys_user', { where: { email: 'p10792.legacyadmin@example.com' }, limit: 1 }, { context: SYS });
    legacyAdminId = String(la.id);
    // ADR-0068 D2 stopped synthesizing this scalar; the vendor's admin plugin
    // authorizes on it, so the fixture places it. System context — the
    // identity write guard admits `isSystem` writes.
    await ql.update('sys_user', { id: legacyAdminId, role: 'admin' }, { context: SYS });
    const [check] = await ql.find('sys_user', { where: { id: legacyAdminId }, limit: 1 }, { context: SYS });
    rec(`fixture legacy-admin sys_user.role = ${JSON.stringify(check.role)}`);
    // Fresh session AFTER the scalar landed.
    legacyAdminToken = await stack.signIn('p10792.legacyadmin@example.com', 'Legacy-Pass-123');

    for (let i = 0; i < 4; i++) {
      const email = `p10792.target${i}@example.com`;
      await stack.signUp(email, 'Target-Pass-123');
      const [t] = await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS });
      targets.push(String(t.id));
    }
    rec(`targets: ${targets.join(', ')}`);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
    try { appendFileSync(OUT, '===== END =====\n'); } catch { /* best effort */ }
  });

  it('ARM 1 — three sibling routes, one member bearer, back to back', async () => {
    await fire('member remove-user', memberToken, 'POST', '/auth/admin/remove-user', { userId: targets[0] });
    await fire('member set-role', memberToken, 'POST', '/auth/admin/set-role', { userId: targets[0], role: 'admin' });
    await fire('member update-user', memberToken, 'POST', '/auth/admin/update-user', { userId: targets[0], data: { name: 'Renamed' } });
    await fire('anon   remove-user', undefined, 'POST', '/auth/admin/remove-user', { userId: targets[0] });
    expect(Object.keys(answers).length).toBeGreaterThan(0);
  }, 300_000);

  it('ARM 2 — the platform-admin arm: a caller the vendor gate DOES admit', async () => {
    // Counter-check FIRST: the same bearer on a neighbouring, unwrapped
    // /admin/ route. If this is refused too, the fixture never passed the
    // vendor gate and the remove-user reading below means nothing.
    await fire('legacyadmin get-session', legacyAdminToken, 'GET', '/auth/get-session');
    await fire('legacyadmin update-user', legacyAdminToken, 'POST', '/auth/admin/update-user', { userId: targets[1], data: { name: 'Renamed By Legacy Admin' } });
    await fire('legacyadmin list-users', legacyAdminToken, 'GET', '/auth/admin/list-users?limit=1');
    await fire('legacyadmin set-role', legacyAdminToken, 'POST', '/auth/admin/set-role', { userId: targets[1], role: 'user' });

    // The reading this dispatch exists for.
    await fire('legacyadmin remove-user', legacyAdminToken, 'POST', '/auth/admin/remove-user', { userId: targets[2] });

    const survivors = await ql.find('sys_user', { where: { id: targets[2] }, limit: 1 }, { context: SYS });
    rec(`after remove-user, target row present = ${survivors.length > 0}`);
    expect(answers['legacyadmin remove-user']).toBeDefined();
  }, 300_000);

  it('ARM 3 — /delete-user, the other SESSION_ERASURE_PATHS member', async () => {
    await fire('member delete-user (no body)', memberToken, 'POST', '/auth/delete-user', {});
    await fire('member delete-user (pw)', memberToken, 'POST', '/auth/delete-user', { password: 'Member-Pass-123' });
    await fire('legacyadmin delete-user (pw)', legacyAdminToken, 'POST', '/auth/delete-user', { password: 'Legacy-Pass-123' });
    expect(answers['member delete-user (no body)']).toBeDefined();
  }, 300_000);

  it('ARM 4 — engine layer: a session read inside vs outside a real transaction', async () => {
    const outside = await ql.find('sys_session', { where: { user_id: legacyAdminId } }, { context: SYS });
    rec(`sys_session rows for legacy admin OUTSIDE a transaction: ${outside.length}`);

    let insideCount = -1;
    let insideErr = '';
    try {
      await ql.transaction(async () => {
        const inside = await ql.find('sys_session', { where: { user_id: legacyAdminId } }, { context: SYS });
        insideCount = inside.length;
      });
    } catch (err) {
      insideErr = `${(err as any)?.name}: ${(err as any)?.message}`.slice(0, 300);
    }
    rec(`sys_session rows for legacy admin INSIDE  a transaction: ${insideCount}${insideErr ? ` (threw ${insideErr})` : ''}`);
    expect(outside.length).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('ARM 6 — the SAME better-auth session read, inside vs outside a real transaction', async () => {
    // No product edit: the request goes through the whole real stack, but the
    // engine transaction is opened AROUND it, reproducing exactly what
    // runSubjectErasureAtomically does to the handler it wraps.
    const withTimeout = async <T,>(label: string, p: Promise<T>): Promise<T | string> =>
      await Promise.race([
        p,
        new Promise<string>((r) => setTimeout(() => r(`TIMEOUT(60s) ${label}`), 60_000)),
      ]);

    const outsideSession = await readAnswer(await stack.apiAs(legacyAdminToken, 'GET', '/auth/get-session'));
    rec(`OUTSIDE txn  get-session            -> ${outsideSession.status} ${outsideSession.body.slice(0, 80)}`);

    let insideSession = 'not-run';
    let insideList = 'not-run';
    let insideUserFind = 'not-run';
    let thrown = '';
    try {
      await ql.transaction(async () => {
        const uf = await withTimeout('sys_user find', ql.find('sys_user', { where: { id: legacyAdminId }, limit: 1 }, { context: SYS }));
        insideUserFind = typeof uf === 'string' ? uf : `rows=${(uf as any[]).length}`;

        const r1 = await withTimeout('get-session', stack.apiAs(legacyAdminToken, 'GET', '/auth/get-session'));
        if (typeof r1 === 'string') insideSession = r1;
        else { const a = await readAnswer(r1 as Response); insideSession = `${a.status} ${a.code ?? ''} ${a.body.slice(0, 80)}`; }

        const r2 = await withTimeout('list-users', stack.apiAs(legacyAdminToken, 'GET', '/auth/admin/list-users?limit=1'));
        if (typeof r2 === 'string') insideList = r2;
        else { const a = await readAnswer(r2 as Response); insideList = `${a.status} ${a.code ?? ''} ${a.body.slice(0, 80)}`; }
      });
    } catch (err) {
      thrown = `${(err as any)?.name}: ${(err as any)?.message}`.slice(0, 200);
    }
    rec(`INSIDE  txn  sys_user find          -> ${insideUserFind}`);
    rec(`INSIDE  txn  get-session            -> ${insideSession}`);
    rec(`INSIDE  txn  admin/list-users       -> ${insideList}`);
    if (thrown) rec(`INSIDE  txn  transaction threw      -> ${thrown}`);
    expect(outsideSession.status).toBe(200);
  }, 300_000);

  it('ARM 5 — hermetic control: no transaction method, and a pass-through one', async () => {
    for (const mode of ['none', 'passthrough'] as const) {
      const engine = createMemoryEngine(mode);
      engine.tables.set('sys_organization', [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }]);
      const manager = makeManager(engine);

      const admin = await hSignUp(manager, engine, 'hermetic.admin@example.com');
      const adminRow = (engine.tables.get('sys_user') ?? []).find((u: any) => String(u.id) === admin.userId);
      if (adminRow) adminRow.role = 'admin';
      const member = await hSignUp(manager, engine, 'hermetic.member@example.com');
      const victim = await hSignUp(manager, engine, 'hermetic.victim@example.com');

      const asMember = await readAnswer(await hPost(manager, '/admin/remove-user', { userId: victim.userId }, member.cookie));
      rec(`hermetic[${mode}] member remove-user -> ${asMember.status} ${asMember.code ?? ''} ${asMember.body}`);

      const asAdmin = await readAnswer(await hPost(manager, '/admin/remove-user', { userId: victim.userId }, admin.cookie));
      rec(`hermetic[${mode}] admin  remove-user -> ${asAdmin.status} ${asAdmin.code ?? ''} ${asAdmin.body}`);

      const memberSelfDelete = await readAnswer(await hPost(manager, '/delete-user', { password: PASSWORD }, member.cookie));
      rec(`hermetic[${mode}] member delete-user -> ${memberSelfDelete.status} ${memberSelfDelete.code ?? ''} ${memberSelfDelete.body}`);
    }
    expect(true).toBe(true);
  }, 300_000);
});
