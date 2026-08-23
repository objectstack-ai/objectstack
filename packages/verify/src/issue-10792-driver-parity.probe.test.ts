// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// MEASUREMENT PROBE for #10792 — DRIVER PARITY, round two. Not a pin.
//
// Round one (branch claude/issue-10792-remove-user-txn-session-probe) measured
// the erasure-transaction session block ONLY on sqlite-wasm and left the
// every-transaction-capable-deployment claim INFERRED for Postgres/MySQL. This
// probe closes that gap: it re-runs the key arms against a REAL Postgres and a
// REAL MySQL server, side by side with a freshly-measured sqlite-wasm, in ONE
// harness whose only variable is the datasource driver.
//
// It boots a faithful copy of `bootStack`'s default-opts linear path — the SAME
// plugin set, same order, same AuthPlugin (the better-auth admin plugin is what
// serves /admin/remove-user, gated on OS_SCIM_ENABLED) — parametrised on the
// datasource driver. Everything else is dialect-independent, so a difference
// between arms is a difference the driver caused.
//
// Select the dialect with PROBE_DIALECT = sqlite-wasm | postgres | mysql | sqlite-sql.
// Select what runs with PROBE_MODE = route | mechanism | both (default: both).
// Caps (ms): PROBE_ERASURE_CAP_MS (admin remove-user, default 140000),
//            PROBE_SHORT_CAP_MS (other erasure fires, default 40000),
//            PROBE_TXN_CAP_MS (in-transaction request, default 30000).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';

// Every plugin class below is a DECLARED dependency of @objectstack/verify (it
// is what harness.ts imports); driver-sql / driver-sqlite-wasm are resolved at
// RUNTIME by the datasource factory (createDefaultDatasourceDriverFactory), the
// same seam `objectstack dev`/`serve` use — no direct driver import here.
import { ObjectKernel, AppPlugin, DefaultDatasourcePlugin, createDispatcherPlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { SettingsServicePlugin, LocalCryptoProvider } from '@objectstack/service-settings';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';

const DIALECT = process.env.PROBE_DIALECT ?? 'sqlite-wasm';
const MODE = process.env.PROBE_MODE ?? 'both';
const ERASURE_CAP = Number(process.env.PROBE_ERASURE_CAP_MS ?? 140_000);
const SHORT_CAP = Number(process.env.PROBE_SHORT_CAP_MS ?? 40_000);
const TXN_CAP = Number(process.env.PROBE_TXN_CAP_MS ?? 30_000);
const OUT = process.env.PROBE_OUT ?? `/tmp/probe-10792-${DIALECT}.txt`;

const SYS = { isSystem: true } as const;
const rec = (line: string) => {
  // eslint-disable-next-line no-console
  console.log(line);
  try { appendFileSync(OUT, line + '\n'); } catch { /* best effort */ }
};

// ── datasource cell ──────────────────────────────────────────────────────────
interface Cell { driver: string; config: Record<string, unknown>; label: string }
const CELLS: Record<string, Cell> = {
  'sqlite-wasm': { driver: 'sqlite-wasm', config: { filename: ':memory:' }, label: 'sqlite-wasm (driver-sqlite-wasm, in-process)' },
  'sqlite-sql': { driver: 'sqlite', config: { filename: ':memory:' }, label: 'sqlite (driver-sql, better-sqlite3, pool max=1)' },
  postgres: { driver: 'postgres', config: { url: process.env.OS_TEST_POSTGRES_URL ?? 'postgres://postgres@127.0.0.1:5432/probe10792' }, label: 'postgres (driver-sql, client pg)' },
  mysql: { driver: 'mysql', config: { url: process.env.OS_TEST_MYSQL_URL ?? 'mysql://root:root@127.0.0.1:3306/probe10792' }, label: 'mysql (driver-sql, client mysql2)' },
};

const API_PREFIX = '/api/v1';
const DEFAULT_ADMIN_EMAIL = 'admin@objectos.ai';
const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_AUTH_SECRET = 'objectstack-verify-secret';
const ORIGIN = 'http://localhost:3000';

interface InjectableApp { request(input: string, init?: RequestInit): Promise<Response> }

// Minimal app — the auth seam under test does not depend on app objects, and a
// small app keeps schema-sync on a fresh PG/MySQL fast and uniform. Same shape
// verify's own harness.posture.test.ts uses.
const MINIMAL_APP = {
  manifest: { id: 'com.example.probe10792', namespace: 'probe10792', version: '0.0.1', type: 'app', name: 'Probe 10792' },
  objects: [],
};

/** Faithful copy of bootStack's DEFAULT-opts linear path, datasource parametrised. */
async function bootProbeStack(cell: Cell) {
  process.env.NODE_ENV = 'development';
  const kernel = new ObjectKernel();

  await kernel.use(new ObjectQLPlugin());
  // THE ONLY VARIABLE: the default datasource. Every other line matches bootStack.
  await kernel.use(new DefaultDatasourcePlugin({ driver: cell.driver, config: cell.config }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(MINIMAL_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new SettingsServicePlugin());
  await kernel.use(new AnalyticsServicePlugin());
  await kernel.use(new AuthPlugin({ secret: DEFAULT_AUTH_SECRET, autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(MINIMAL_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  try {
    const engine = await kernel.getServiceAsync<{ setCryptoProvider?: (p: unknown) => void }>('objectql');
    if (engine && typeof engine.setCryptoProvider === 'function') engine.setCryptoProvider(new LocalCryptoProvider());
  } catch { /* fail-closed like prod */ }

  const httpServer = await kernel.getServiceAsync<{ getRawApp(): InjectableApp; close?(): Promise<void> }>('http-server');
  const app = httpServer.getRawApp();
  const raw = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${path}`, init);
  const api = (path: string, init?: RequestInit) => raw(`${API_PREFIX}${path}`, init);

  const signIn = async (email = DEFAULT_ADMIN_EMAIL, password = DEFAULT_ADMIN_PASSWORD): Promise<string> => {
    const res = await api('/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error(`signIn failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('signIn: no token');
    return data.token;
  };
  const signUp = async (email: string, password = 'Member-Pass-123', name?: string): Promise<string> => {
    const res = await api('/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: name ?? email.split('@')[0] }) });
    if (!res.ok) throw new Error(`signUp failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('signUp: no token');
    return data.token;
  };
  const apiAs = (token: string, method: string, path: string, body?: unknown) =>
    api(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const stop = async () => {
    try { await httpServer.close?.(); } catch { /* best effort */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (kernel as any).shutdown?.(); } catch { /* best effort */ }
  };
  return { kernel, api, apiAs, signIn, signUp, stop };
}

interface Timed { label: string; ms: number; status: number | 'CAPPED'; code?: string; body: string }
async function readAnswer(res: Response): Promise<{ status: number; code?: string; body: string }> {
  const body = await res.text();
  let code: string | undefined;
  try { const p = JSON.parse(body); code = p?.error?.code ?? p?.code; } catch { /* non-JSON */ }
  return { status: res.status, code, body: body.slice(0, 120) };
}

describe(`#10792 driver-parity probe — ${CELLS[DIALECT]?.label ?? DIALECT}`, () => {
  let stack: Awaited<ReturnType<typeof bootProbeStack>>;
  let ql: any;
  let priorScim: string | undefined;

  let seededPlatformAdminTok = '';
  let memberTok = '';
  let legacyAdminTok = '';
  let legacyAdminId = '';
  const targets: string[] = [];

  const cell = CELLS[DIALECT];

  // A fire timed with a bounded race. If the underlying request outlives the
  // cap it is a BLOCK — recorded as CAPPED with the cap value; the pending
  // request is left to be reaped by stack.stop() (pool teardown).
  const timedFire = async (label: string, run: () => Promise<Response>, capMs: number): Promise<Timed> => {
    const t0 = Date.now();
    const capped = Symbol('capped');
    const res = await Promise.race([
      run().then((r) => r).catch((e) => e as Error),
      new Promise<typeof capped>((r) => setTimeout(() => r(capped), capMs)),
    ]);
    const ms = Date.now() - t0;
    if (res === capped) {
      const t: Timed = { label, ms, status: 'CAPPED', body: `still blocked at cap ${capMs}ms` };
      rec(`${label.padEnd(40)} ${String(ms).padStart(7)}ms  -> CAPPED (still blocked at ${capMs}ms)`);
      return t;
    }
    if (res instanceof Error) {
      const t: Timed = { label, ms, status: -1 as any, body: `threw ${res.name}: ${res.message}`.slice(0, 120) };
      rec(`${label.padEnd(40)} ${String(ms).padStart(7)}ms  -> THREW ${res.name}: ${res.message}`.slice(0, 160));
      return t;
    }
    const a = await readAnswer(res);
    const t: Timed = { label, ms, status: a.status, code: a.code, body: a.body };
    rec(`${label.padEnd(40)} ${String(ms).padStart(7)}ms  -> ${a.status} ${a.code ?? ''} ${a.body}`);
    return t;
  };

  beforeAll(async () => {
    if (!cell) throw new Error(`unknown PROBE_DIALECT=${DIALECT}`);
    try { writeFileSync(OUT, `===== #10792 DRIVER-PARITY PROBE — ${cell.label} =====\n`); } catch { /* best effort */ }
    rec(`mode=${MODE} caps: erasure=${ERASURE_CAP} short=${SHORT_CAP} txn=${TXN_CAP}`);
    priorScim = process.env.OS_SCIM_ENABLED;
    // The better-auth admin plugin (serves /admin/remove-user, /admin/set-role,
    // /admin/update-user, /admin/list-users) is gated on OS_SCIM_ENABLED — the
    // same boot the dogfood sweep and round one used.
    process.env.OS_SCIM_ENABLED = 'true';

    stack = await bootProbeStack(cell);
    ql = await stack.kernel.getServiceAsync('objectql');
    rec(`boot OK — engine default driver = ${ql.getDefaultDriverName?.() ?? '?'}`);

    seededPlatformAdminTok = await stack.signIn(); // seeded dev admin (platform admin, NO legacy scalar)
    memberTok = await stack.signUp('p10792d.member@example.com', 'Member-Pass-123');

    await stack.signUp('p10792d.legacyadmin@example.com', 'Legacy-Pass-123');
    const [la] = await ql.find('sys_user', { where: { email: 'p10792d.legacyadmin@example.com' }, limit: 1 }, { context: SYS });
    legacyAdminId = String(la.id);
    // ADR-0068 D2 stopped synthesizing this scalar; the vendor admin plugin
    // authorizes on it, so the fixture places it (system context is admitted).
    await ql.update('sys_user', { id: legacyAdminId, role: 'admin' }, { context: SYS });
    const [chk] = await ql.find('sys_user', { where: { id: legacyAdminId }, limit: 1 }, { context: SYS });
    rec(`fixture legacy-admin sys_user.role = ${JSON.stringify(chk.role)}`);
    legacyAdminTok = await stack.signIn('p10792d.legacyadmin@example.com', 'Legacy-Pass-123');

    for (let i = 0; i < 4; i++) {
      const email = `p10792d.target${i}@example.com`;
      await stack.signUp(email, 'Target-Pass-123');
      const [t] = await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS });
      targets.push(String(t.id));
    }
    rec(`targets: ${targets.length} created`);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED; else process.env.OS_SCIM_ENABLED = priorScim;
    rec('===== END =====');
  });

  it('CONTROLS — the admitted admin passes every neighbouring /admin/ route (fast)', async () => {
    rec('--- controls (fired first, before any erasure fire) ---');
    await timedFire('legacyadmin get-session (ctrl)', () => stack.apiAs(legacyAdminTok, 'GET', '/auth/get-session'), SHORT_CAP);
    await timedFire('legacyadmin admin/list-users (ctrl)', () => stack.apiAs(legacyAdminTok, 'GET', '/auth/admin/list-users?limit=1'), SHORT_CAP);
    await timedFire('legacyadmin admin/update-user (ctrl)', () => stack.apiAs(legacyAdminTok, 'POST', '/auth/admin/update-user', { userId: targets[0], data: { name: 'Renamed' } }), SHORT_CAP);
    await timedFire('legacyadmin admin/set-role (ctrl)', () => stack.apiAs(legacyAdminTok, 'POST', '/auth/admin/set-role', { userId: targets[0], role: 'user' }), SHORT_CAP);
    await timedFire('member admin/update-user (403?)', () => stack.apiAs(memberTok, 'POST', '/auth/admin/update-user', { userId: targets[0], data: { name: 'X' } }), SHORT_CAP);
    await timedFire('seeded-platadmin admin/list-users', () => stack.apiAs(seededPlatformAdminTok, 'GET', '/auth/admin/list-users?limit=1'), SHORT_CAP);
    expect(true).toBe(true);
  }, 300_000);

  it('MECHANISM — a better-auth request served INSIDE an open engine transaction', async () => {
    if (MODE === 'route') { rec('--- mechanism arm skipped (PROBE_MODE=route) ---'); return; }
    rec('--- mechanism: open ql.transaction, read + serve a request inside it ---');
    // Baseline outside a transaction.
    await timedFire('OUTSIDE txn get-session', () => stack.apiAs(legacyAdminTok, 'GET', '/auth/get-session'), SHORT_CAP);

    let insideUserFind = 'not-run';
    let insideSessionFind = 'not-run';
    let insideGetSession = 'not-run';
    let threw = '';
    const cap = <T,>(label: string, p: Promise<T>): Promise<T | string> =>
      Promise.race([p.then((v) => v).catch((e) => `THREW ${(e as any)?.message}` as any), new Promise<string>((r) => setTimeout(() => r(`CAPPED(${TXN_CAP}ms) ${label}`), TXN_CAP))]);
    try {
      await ql.transaction(async () => {
        const t0 = Date.now();
        const uf = await cap('sys_user find', ql.find('sys_user', { where: { id: legacyAdminId }, limit: 1 }, { context: SYS }));
        insideUserFind = typeof uf === 'string' ? uf : `rows=${(uf as any[]).length} (${Date.now() - t0}ms)`;
        const t1 = Date.now();
        const sf = await cap('sys_session find', ql.find('sys_session', { where: { user_id: legacyAdminId } }, { context: SYS }));
        insideSessionFind = typeof sf === 'string' ? sf : `rows=${(sf as any[]).length} (${Date.now() - t1}ms)`;
        const t2 = Date.now();
        const gs = await cap('get-session', stack.apiAs(legacyAdminTok, 'GET', '/auth/get-session'));
        insideGetSession = typeof gs === 'string' ? `${gs} (${Date.now() - t2}ms)` : `${(gs as Response).status} (${Date.now() - t2}ms)`;
      });
    } catch (err) { threw = `${(err as any)?.name}: ${(err as any)?.message}`.slice(0, 160); }
    rec(`INSIDE txn  sys_user find      -> ${insideUserFind}`);
    rec(`INSIDE txn  sys_session find   -> ${insideSessionFind}`);
    rec(`INSIDE txn  get-session (auth) -> ${insideGetSession}`);
    if (threw) rec(`INSIDE txn  threw             -> ${threw}`);
    expect(true).toBe(true);
  }, 300_000);

  it('ROUTE — the erasure routes, timed (status AND elapsed)', async () => {
    if (MODE === 'mechanism') { rec('--- route arm skipped (PROBE_MODE=mechanism) ---'); return; }
    rec('--- erasure routes (fire AFTER controls) ---');
    // THE headline: a caller the vendor gate admits, on /admin/remove-user.
    await timedFire('legacyadmin admin/remove-user', () => stack.apiAs(legacyAdminTok, 'POST', '/auth/admin/remove-user', { userId: targets[2] }), ERASURE_CAP);
    const survivors = await ql.find('sys_user', { where: { id: targets[2] }, limit: 1 }, { context: SYS }).catch(() => ['(read blocked)']);
    rec(`after legacyadmin remove-user, target row present = ${survivors.length > 0}`);

    await timedFire('member admin/remove-user', () => stack.apiAs(memberTok, 'POST', '/auth/admin/remove-user', { userId: targets[3] }), SHORT_CAP);
    await timedFire('anon admin/remove-user', () => stack.api('/auth/admin/remove-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targets[3] }) }), SHORT_CAP);
    await timedFire('member delete-user (pw)', () => stack.apiAs(memberTok, 'POST', '/auth/delete-user', { password: 'Member-Pass-123' }), SHORT_CAP);
    expect(true).toBe(true);
  }, 400_000);
});
