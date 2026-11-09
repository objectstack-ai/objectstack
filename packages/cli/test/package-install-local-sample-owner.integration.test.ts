// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 60 — spawns the real producer once per single-cause fixture: two `os start` boots of the tsx source entry on one home, run in sequence, the second reading what the first boot's ledger heals; local reading 44.6 s on the card's box (no CI reading yet) x 1.25, rounded up

/**
 * #30324 (ruling 6670861426) — an installed package's sample rows are owned by
 * the person who seeded them, and then follow the platform's ordinary rules.
 *
 * ## The defect, measured at this door on `main` b77c160a
 *
 * An inline install (`POST /api/v1/marketplace/install-local`) of a package
 * with one `private` object, one `controlled_by_parent` detail and an
 * `isDefault` set at `readScope: 'own'` seeded 4 rows, every one with
 * `owner_id` and `created_by` NULL. The seed loader writes as the system with
 * no user, and the boot seed's first-admin hand-over never reaches an
 * install's seed. So the rows were owned by nobody: invisible to every `own`
 * grant, editable by nobody below Modify All.
 *
 * ## The ruling, and what each `it` reads
 *
 * The maintainer: 「HotCRM 是私有共享，记录的主人是管理员，同事照样看不到，
 * 这个按照平台同意的权限规则就可以。」 A sample row is written with `owner_id`
 * and `created_by` = the person who ran the install, and is then an ordinary
 * record. So this file pins, on the real stack (security, sharing, the seed
 * loader, the ledger):
 *
 *  - the install's rows are owned and created by the installer;
 *  - a colleague holding the package's default set reads none of them under
 *    `private` sharing, exactly as for any other record the installer owns
 *    (accepted behaviour, pinned so a change to it is a decision);
 *  - the installer edits and deletes them as their owner;
 *  - the purge's sample-row identification (#21822, content-keyed) is
 *    unchanged: it deletes the sample rows and not the colleague's own record;
 *  - a reseed's rows are owned by the person who reseeds;
 *  - on a restart over emptied tables, the boot heal's rows are owned by the
 *    installer the ledger records (the one person a boot has).
 *
 * The per-organization replay names the organization's founder; it needs a
 * walled multi-organization deployment and is pinned at the door in
 * `packages/cloud-connection/src/marketplace-install-local-seed-owner.test.ts`.
 *
 * ## Spawn shape
 *
 * The sibling `package-install-local-uninstall-cleanups.integration.test.ts`
 * shape: the tsx source entry, one process group per `os start`, every
 * workspace package (`@objectstack/cloud-connection` included) resolved through
 * its `exports` to `dist/`, so an ablation of its source reaches this file only
 * after that package is rebuilt. Both boots run in `beforeAll`; the `it`s only
 * read what the phases recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  probeThroughChild,
  readKernelAssignedPort,
} from './helpers/serve-process.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;

const APP_ID = 'com.example.sampledeals';
const DEAL = 'sample_deals_deal';
const NOTE = 'sample_deals_note';
const SET = 'sample_deals_user';
const ROUTE = '/api/v1/marketplace/install-local';
/** The development dev-admin seed: the operator, and the installer, on every boot. */
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const COLLEAGUE = { email: 'colleague30324@example.com', password: 'Colleague-30324-first!', name: 'Colleague One' };
const COLLEAGUE_PASSWORD = 'Colleague-30324-changed!';
const SAMPLE_DEALS = ['Sample Deal A', 'Sample Deal B', 'Sample Deal C'];
const REAL_DEAL = 'Colleague real deal';

/** One `private` object, its `controlled_by_parent` detail, a default set at `readScope: 'own'`, and sample rows of both. */
const ARTIFACT = {
  manifest: { id: APP_ID, namespace: 'sample_deals', version: '0.1.0', type: 'app', name: 'Sample Deals' },
  objects: [
    {
      name: DEAL, label: 'Deal', sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
    },
    {
      name: NOTE, label: 'Deal Note', sharingModel: 'controlled_by_parent',
      fields: {
        name: { type: 'text', label: 'Name' },
        deal: { type: 'master_detail', label: 'Deal', reference: DEAL, required: true },
      },
    },
  ],
  permissions: [{
    name: SET, label: 'Sample Deals User', isDefault: true,
    objects: {
      [DEAL]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: false, modifyAllRecords: false, readScope: 'own' },
      [NOTE]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false, viewAllRecords: false, modifyAllRecords: false },
    },
  }],
  data: [
    { object: DEAL, externalId: 'name', records: SAMPLE_DEALS.map((name, i) => ({ name, amount: (i + 1) * 100 })) },
    { object: NOTE, externalId: 'name', records: [{ name: 'Sample Note A1', deal: 'Sample Deal A' }] },
  ],
};

const groups: ChildProcess[] = [];
const dirs: string[] = [];

interface LiveStart {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function bootStart(cwd: string, home: string): Promise<LiveStart> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'start', '-p', KERNEL_ASSIGNED_PORT, '--home', home, '--auth-secret', E2E_SECRET_KEY, '--no-ui'], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header.
      env: childEnv({ NO_COLOR: '1', OS_CLOUD_URL: 'off', OS_LOG_LEVEL: 'warn', OS_SECRET_KEY: E2E_SECRET_KEY }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: `os start` supervises a `serve` grandchild.
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot({ child, base: `http://localhost:${verdict}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`os start never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound: a kernel-assigned one (#24342).
      if (READY.test(out)) settle(readKernelAssignedPort(out, 'os start'));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`os start exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

interface Answer { status: number; body: any }

/** One exchange against the running `os start`, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: LiveStart, method: string, path: string, token: string, body?: unknown): Promise<Answer> {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'package-install-local-sample-owner',
      what: `${method} ${path}`,
    },
    async () => {
      const r = await fetch(`${live.base}${path}`, {
        method,
        headers: {
          origin: live.base,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body: parsed };
    },
  );
}

interface Session { token: string; userId: string }

async function signIn(live: LiveStart, who: { email: string; password: string }): Promise<Session> {
  const res = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: who.email, password: who.password });
  const token = res.body?.token;
  const userId = res.body?.user?.id;
  if (res.status !== 200 || typeof token !== 'string' || typeof userId !== 'string') {
    throw new Error(`sign-in ${who.email} answered ${res.status}: ${JSON.stringify(res.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return { token, userId };
}

/**
 * A colleague the administrator creates (self sign-up is closed under the
 * default `invite_only` posture), past the first-sign-in password change the
 * created account owes, holding the package's default set.
 */
async function colleagueHolding(live: LiveStart, admin: Session): Promise<{ session: Session; granted: Answer }> {
  const created = await http(live, 'POST', '/api/v1/auth/admin/create-user', admin.token, { ...COLLEAGUE, role: 'user' });
  if (created.status !== 200) throw new Error(`create-user answered ${created.status}: ${JSON.stringify(created.body)}`);
  const first = await signIn(live, COLLEAGUE);
  const changed = await http(live, 'POST', '/api/v1/auth/change-password', first.token, {
    currentPassword: COLLEAGUE.password, newPassword: COLLEAGUE_PASSWORD, revokeOtherSessions: false,
  });
  if (changed.status !== 200) throw new Error(`change-password answered ${changed.status}: ${JSON.stringify(changed.body)}`);
  const session = await signIn(live, { email: COLLEAGUE.email, password: COLLEAGUE_PASSWORD });
  const granted = await http(live, 'POST', '/api/v1/data/sys_user_permission_set', admin.token, { user_id: session.userId, permission_set: SET });
  return { session, granted };
}

/** The rows of a `GET /api/v1/data/:object` list answer, whichever envelope it came in. */
function rowsOf(answer: Answer): any[] {
  const b = answer.body?.data ?? answer.body;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.records)) return b.records;
  if (Array.isArray(b?.items)) return b.items;
  return [];
}

interface OwnedRow { id: string; name: string; owner_id: string | null; created_by: string | null }
const owned = (a: Answer): OwnedRow[] =>
  rowsOf(a).map((r) => ({ id: r.id, name: r.name, owner_id: r.owner_id ?? null, created_by: r.created_by ?? null }));
const byName = (rows: OwnedRow[]) => [...rows].sort((x, y) => x.name.localeCompare(y.name));

/** What both boots recorded, phase by phase; the `it`s read it. */
interface Recorded {
  install?: Answer;
  admin?: Session;
  installedDeals?: OwnedRow[];
  installedNotes?: OwnedRow[];
  granted?: Answer;
  colleagueDeals?: Answer;
  colleagueNotes?: Answer;
  colleagueById?: Answer;
  colleagueCreate?: Answer;
  colleagueAfterCreate?: Answer;
  adminPatch?: Answer;
  adminPatched?: Answer;
  adminDelete?: Answer;
  purge?: Answer;
  afterPurge?: OwnedRow[];
  reseed?: Answer;
  reseededDeals?: OwnedRow[];
  /** Every row deleted by id before the restart, so the boot heal finds every seeded table empty. */
  emptied?: Answer[];
  /** Second boot: the healed rows, read by the administrator. */
  healedDeals?: OwnedRow[];
  healedNotes?: OwnedRow[];
  healedAdmin?: Session;
}
const rec: Recorded = {};

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'install-local-sample-owner-'));
  dirs.push(root);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd, { recursive: true });
  const home = join(root, 'home');

  // ── boot 1: install, read as both people, edit, purge, reseed, empty ──────
  const a = await bootStart(cwd, home);
  const admin = await signIn(a, ADMIN);
  rec.admin = admin;
  rec.install = await http(a, 'POST', ROUTE, admin.token, { manifest: ARTIFACT });
  rec.installedDeals = byName(owned(await http(a, 'GET', `/api/v1/data/${DEAL}`, admin.token)));
  rec.installedNotes = owned(await http(a, 'GET', `/api/v1/data/${NOTE}`, admin.token));

  const colleague = await colleagueHolding(a, admin);
  rec.granted = colleague.granted;
  rec.colleagueDeals = await http(a, 'GET', `/api/v1/data/${DEAL}`, colleague.session.token);
  rec.colleagueNotes = await http(a, 'GET', `/api/v1/data/${NOTE}`, colleague.session.token);
  const sampleA = rec.installedDeals.find((r) => r.name === 'Sample Deal A');
  const sampleB = rec.installedDeals.find((r) => r.name === 'Sample Deal B');
  if (!sampleA || !sampleB) throw new Error(`precondition: the install seeded no sample deals — ${JSON.stringify(rec.install)}\n--- output ---\n${a.output().slice(-3000)}`);
  rec.colleagueById = await http(a, 'GET', `/api/v1/data/${DEAL}/${sampleA.id}`, colleague.session.token);
  rec.colleagueCreate = await http(a, 'POST', `/api/v1/data/${DEAL}`, colleague.session.token, { name: REAL_DEAL, amount: 5 });
  rec.colleagueAfterCreate = await http(a, 'GET', `/api/v1/data/${DEAL}`, colleague.session.token);

  rec.adminPatch = await http(a, 'PATCH', `/api/v1/data/${DEAL}/${sampleA.id}`, admin.token, { amount: 111 });
  rec.adminPatched = await http(a, 'GET', `/api/v1/data/${DEAL}/${sampleA.id}`, admin.token);
  rec.adminDelete = await http(a, 'DELETE', `/api/v1/data/${DEAL}/${sampleB.id}`, admin.token);

  rec.purge = await http(a, 'POST', `${ROUTE}/${APP_ID}/purge-sample-data`, admin.token, {});
  rec.afterPurge = owned(await http(a, 'GET', `/api/v1/data/${DEAL}`, admin.token));

  rec.reseed = await http(a, 'POST', `${ROUTE}/${APP_ID}/reseed-sample-data`, admin.token, {});
  rec.reseededDeals = byName(owned(await http(a, 'GET', `/api/v1/data/${DEAL}`, admin.token)))
    .filter((r) => r.name !== REAL_DEAL);

  // Empty both seeded tables by id — not a purge, which would tell the heal
  // the emptiness is wanted — so the next boot heals them.
  rec.emptied = [];
  for (const object of [NOTE, DEAL]) {
    for (const row of owned(await http(a, 'GET', `/api/v1/data/${object}`, admin.token))) {
      rec.emptied.push(await http(a, 'DELETE', `/api/v1/data/${object}/${row.id}`, admin.token));
    }
  }
  await stopGroup(a.child);

  // ── boot 2: the same home; the rehydrate finds every seeded table empty ───
  const b = await bootStart(cwd, home);
  const again = await signIn(b, ADMIN);
  rec.healedAdmin = again;
  rec.healedDeals = byName(owned(await http(b, 'GET', `/api/v1/data/${DEAL}`, again.token)));
  rec.healedNotes = owned(await http(b, 'GET', `/api/v1/data/${NOTE}`, again.token));
  await stopGroup(b.child);
}, 3 * BOOT_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#30324: an installed package\'s sample rows are owned by the person who seeded them', () => {
  it('the install\'s rows carry the installer as owner and creator', () => {
    expect(rec.install?.status, JSON.stringify(rec.install?.body)).toBe(200);
    const me = rec.admin!.userId;
    expect(rec.installedDeals!.map((r) => r.name)).toEqual(SAMPLE_DEALS);
    for (const row of [...rec.installedDeals!, ...rec.installedNotes!]) {
      expect(row).toMatchObject({ owner_id: me, created_by: me });
    }
    expect(rec.installedNotes!.map((r) => r.name)).toEqual(['Sample Note A1']);
  });

  it('ACCEPTED: under `private` sharing a colleague holding the default set reads none of them — the ordinary rule, as for any record the installer owns', () => {
    expect(rec.granted?.status, JSON.stringify(rec.granted?.body)).toBe(201);
    expect(rec.colleagueDeals?.status).toBe(200);
    expect(rowsOf(rec.colleagueDeals!)).toEqual([]);
    expect(rec.colleagueNotes?.status).toBe(200);
    expect(rowsOf(rec.colleagueNotes!)).toEqual([]);
    expect(rec.colleagueById?.status).toBe(404);
    // …and their own record is theirs, under the same rule.
    expect(rec.colleagueCreate?.status).toBe(201);
    expect(rowsOf(rec.colleagueAfterCreate!).map((r) => r.name)).toEqual([REAL_DEAL]);
  });

  it('the installer edits and deletes them as their owner', () => {
    expect(rec.adminPatch?.status, JSON.stringify(rec.adminPatch?.body)).toBe(200);
    const patched = rec.adminPatched?.body?.data ?? rec.adminPatched?.body?.record ?? rec.adminPatched?.body;
    expect(patched?.amount).toBe(111);
    expect(rec.adminDelete?.status, JSON.stringify(rec.adminDelete?.body)).toBe(200);
  });

  it('the purge still finds its sample rows by content (#21822): they go, the colleague\'s own record stays', () => {
    expect(rec.purge?.status, JSON.stringify(rec.purge?.body)).toBe(200);
    // Deal A, Deal C and the note: Deal B was deleted above, so nothing matches it.
    expect(rec.purge?.body?.data).toMatchObject({ deleted: 3, errors: 0 });
    expect(rec.afterPurge!.map((r) => r.name)).toEqual([REAL_DEAL]);
  });

  it('a reseed\'s rows are owned by the person who reseeds', () => {
    expect(rec.reseed?.status, JSON.stringify(rec.reseed?.body)).toBe(200);
    expect(rec.reseededDeals!.map((r) => r.name)).toEqual(SAMPLE_DEALS);
    for (const row of rec.reseededDeals!) expect(row).toMatchObject({ owner_id: rec.admin!.userId, created_by: rec.admin!.userId });
  });

  it('a restart over emptied tables heals them, owned by the installer the ledger records', () => {
    expect(rec.emptied!.length).toBeGreaterThan(0);
    for (const a of rec.emptied!) expect(a.status).toBe(200);
    // The same dev-admin account on both boots: the person the install recorded.
    expect(rec.healedAdmin!.userId).toBe(rec.admin!.userId);
    expect(rec.healedDeals!.map((r) => r.name)).toEqual(SAMPLE_DEALS);
    for (const row of [...rec.healedDeals!, ...rec.healedNotes!]) {
      expect(row).toMatchObject({ owner_id: rec.admin!.userId, created_by: rec.admin!.userId });
    }
  });
});
