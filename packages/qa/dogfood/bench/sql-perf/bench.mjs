#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL performance baseline (epic "SQL performance", M0): boot the fixture app in
 * `./app` on a real SQL database through `os dev`, bulk-load it at a chosen
 * scale, and time a fixed set of HTTP scenarios as an admin and as a read-scoped
 * member. Per scenario it records client p50/p95, the server's own total, and
 * the number of SQL statements the request ran (the `db` mark of the
 * `Server-Timing` header, which the SQL driver counts per query).
 *
 *   node packages/qa/dogfood/bench/sql-perf/bench.mjs --dialect sqlite --scale 100000
 *   node packages/qa/dogfood/bench/sql-perf/bench.mjs --dialect pg --scale 100000 \
 *     --pg-url postgres://postgres@127.0.0.1:5432/postgres
 *
 * Prerequisite: the CLI closure is built (`pnpm --filter '@objectstack/cli...' build`).
 * Every phase has a deadline (`--boot-timeout-ms`, `--request-timeout-ms`,
 * `--seed-timeout-ms`); a phase that overruns fails the run loudly instead of
 * hanging. The server is always torn down, by process group, on exit.
 *
 * Output: `<out>/<dialect>-<scale>.json` (every sample) and `.md` (the table).
 * See README.md next to this file for the scenario list and how to read it.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, 'app');
const PKG_DIR = resolve(HERE, '../..');
const OS_BIN = resolve(PKG_DIR, 'node_modules/.bin/os');
// knex and the two database clients are driver-sql's own dependencies; resolve
// them from there so this fixture adds no dependency to the package.
// (Its `exports` map does not expose `package.json`, so the workspace link is read directly.)
const driverRequire = createRequire(realpathSync(join(PKG_DIR, 'node_modules/@objectstack/driver-sql/package.json')));

// ── arguments ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    dialect: 'sqlite',
    scale: 100_000,
    iterations: 20,
    warmup: 3,
    pgUrl: process.env.OS_BENCH_PG_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres',
    workDir: resolve(process.env.TMPDIR ?? '/tmp', 'os-sql-perf-bench'),
    out: undefined,
    bootTimeoutMs: 240_000,
    requestTimeoutMs: 120_000,
    seedTimeoutMs: 1_800_000,
    cascadeDeletes: 5,
    only: undefined,
    shares: 0,
    dbLatencyMs: 0,
    grantsCacheTtlMs: undefined,
    sqlLog: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const val = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--dialect': out.dialect = val(); break;
      case '--scale': out.scale = Number(val()); break;
      case '--iterations': out.iterations = Number(val()); break;
      case '--warmup': out.warmup = Number(val()); break;
      case '--pg-url': out.pgUrl = val(); break;
      case '--work-dir': out.workDir = resolve(val()); break;
      case '--out': out.out = resolve(val()); break;
      case '--boot-timeout-ms': out.bootTimeoutMs = Number(val()); break;
      case '--request-timeout-ms': out.requestTimeoutMs = Number(val()); break;
      case '--seed-timeout-ms': out.seedTimeoutMs = Number(val()); break;
      case '--cascade-deletes': out.cascadeDeletes = Number(val()); break;
      case '--only': out.only = val().split(','); break;
      case '--shares': out.shares = Number(val()); break;
      case '--db-latency-ms': out.dbLatencyMs = Number(val()); break;
      case '--grants-cache-ttl-ms': out.grantsCacheTtlMs = Number(val()); break;
      case '--sql-log': out.sqlLog = true; break;
      case '--help': case '-h':
        console.log('usage: bench.mjs --dialect sqlite|pg --scale N [--iterations 20] [--warmup 3] [--pg-url URL] [--work-dir DIR] [--out DIR] [--only scenario,...] [--shares N] [--db-latency-ms N] [--grants-cache-ttl-ms N] [--sql-log]');
        process.exit(0);
        break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!['sqlite', 'pg'].includes(out.dialect)) throw new Error(`--dialect must be sqlite or pg, got ${out.dialect}`);
  if (!Number.isInteger(out.scale) || out.scale < 1000) throw new Error('--scale must be an integer >= 1000');
  if (!Number.isInteger(out.shares) || out.shares < 0) throw new Error('--shares must be an integer >= 0');
  if (!Number.isFinite(out.dbLatencyMs) || out.dbLatencyMs < 0) throw new Error('--db-latency-ms must be >= 0');
  if (out.dbLatencyMs > 0 && out.dialect !== 'pg') throw new Error('--db-latency-ms needs --dialect pg (SQLite is in-process: there is no connection to delay)');
  if (out.grantsCacheTtlMs !== undefined && (!Number.isInteger(out.grantsCacheTtlMs) || out.grantsCacheTtlMs < 0)) throw new Error('--grants-cache-ttl-ms must be an integer >= 0');
  // A run with a non-default leg writes its own result files, never over the baseline's.
  out.suffix = [
    out.shares ? `shares${out.shares}` : '',
    out.dbLatencyMs ? `rtt${out.dbLatencyMs}` : '',
    out.grantsCacheTtlMs !== undefined ? `gc${out.grantsCacheTtlMs}` : '',
    out.sqlLog ? 'sqllog' : '',
  ].filter(Boolean).map((p) => `-${p}`).join('');
  out.out ??= join(out.workDir, 'results');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const log = (...m) => console.log(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...m);

function withDeadline(promise, ms, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── shape of the data set ─────────────────────────────────────────────────
const SHAPE = {
  regions: 20,
  products: 200,
  accounts: Math.max(10, Math.round(args.scale / 100)),
  opportunities: Math.max(100, Math.round(args.scale / 10)),
  lineItems: args.scale,
  memberEvery: 10, // every 10th account is owned by the member
  // The roll-up pairs (R10) are a fixed size, not scaled: what a child write
  // costs depends on the summaries and the distinct parents it touches, and on
  // the children per parent the aggregate reads, not on the table size.
  rollupParents: 200,
  rollupItemsPerParent: 50,
};
const STATUSES = ['open', 'shipped', 'invoiced', 'cancelled'];
const STAGES = ['prospecting', 'proposal', 'negotiation', 'won', 'lost'];
const INDUSTRIES = ['tech', 'finance', 'retail', 'health', 'energy'];
const FAMILIES = ['hardware', 'software', 'services', 'training'];
const pad = (n) => String(n).padStart(8, '0');
const id = {
  region: (i) => `rg${pad(i)}`, product: (i) => `pr${pad(i)}`, account: (i) => `ac${pad(i)}`, opportunity: (i) => `op${pad(i)}`, line: (i) => `li${pad(i)}`,
  share: (i) => `sh${pad(i)}`, rollup: (n, i) => `r${n}p${pad(i)}`, rollupItem: (n, i) => `r${n}i${pad(i)}`,
};
const ROLLUPS = [0, 1, 2]; // summary fields on bench_roll<n>: 0 (control), 1, 2
// Deterministic PRNG (mulberry32) so every run seeds the same rows.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const accountOf = (opp) => Math.floor(opp / (SHAPE.opportunities / SHAPE.accounts));
const oppOf = (line) => Math.floor(line / (SHAPE.lineItems / SHAPE.opportunities));
const memberOwnsAccount = (acc) => acc % SHAPE.memberEvery === 0;

// ── server lifecycle ──────────────────────────────────────────────────────
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function bootServer(databaseUrl, label, extraEnv = {}) {
  const port = await freePort();
  const logFile = join(args.workDir, `server-${label}.log`);
  const { openSync } = await import('node:fs');
  const fd = openSync(logFile, 'w');
  const child = spawn(OS_BIN, ['dev', '--no-watch', '-p', String(port)], {
    cwd: APP_DIR,
    detached: true, // own process group, so teardown reaches every descendant
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      OS_DATABASE_URL: databaseUrl,
      OS_SERVER_TIMING: 'true', // the Server-Timing header on every response, member included
      OS_LOG_LEVEL: process.env.OS_LOG_LEVEL ?? 'warn',
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=4096',
      ...extraEnv,
    },
  });
  const server = { child, port, base: `http://127.0.0.1:${port}/api/v1`, origin: `http://localhost:${port}`, logFile, exited: false };
  child.on('exit', () => { server.exited = true; });
  liveServers.add(server);
  const started = Date.now();
  const { readFileSync } = await import('node:fs');
  for (;;) {
    if (server.exited) throw new Error(`server exited during boot; see ${logFile}`);
    const text = readFileSync(logFile, 'utf8');
    if (text.includes('Compile failed')) throw new Error(`fixture compile failed; see ${logFile}`);
    if (text.includes('Server is ready')) break;
    if (Date.now() - started > args.bootTimeoutMs) throw new Error(`server not ready within ${args.bootTimeoutMs} ms; see ${logFile}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`server ${label} ready on :${port} in ${Date.now() - started} ms`);
  return server;
}

const liveServers = new Set();

// ── network leg (R8): a TCP proxy that adds a fixed round trip ───────────
/**
 * Stands between the server and PostgreSQL and holds every chunk for half the
 * requested round trip in each direction, so each statement the server waits
 * on pays `rttMs` more than on the local socket. It runs inside this process
 * (it dies with the bench; there is no PID to clean up) and counts the chunks
 * it forwards, so a run can show its traffic really went through it. Same-delay
 * timers fire in creation order in Node, so the byte stream keeps its order.
 */
async function startLatencyProxy(targetUrl, rttMs) {
  const target = new URL(targetUrl);
  const half = rttMs / 2;
  const stats = { connections: 0, chunksToDb: 0, chunksFromDb: 0 };
  const sockets = new Set();
  const server = createServer((client) => {
    stats.connections++;
    const upstream = connect(Number(target.port || 5432), target.hostname);
    for (const s of [client, upstream]) { s.setNoDelay(true); sockets.add(s); s.on('close', () => sockets.delete(s)); }
    const forward = (src, dst, key) => src.on('data', (buf) => { stats[key]++; setTimeout(() => { if (!dst.destroyed) dst.write(buf); }, half); });
    forward(client, upstream, 'chunksToDb');
    forward(upstream, client, 'chunksFromDb');
    const close = () => setTimeout(() => { client.destroy(); upstream.destroy(); }, half);
    client.on('end', close); upstream.on('end', close);
    client.on('error', close); upstream.on('error', close);
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const url = new URL(targetUrl);
  url.hostname = '127.0.0.1';
  url.port = String(server.address().port);
  return {
    url: url.toString(),
    stats,
    close: () => new Promise((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); }),
  };
}

/** Median `select 1` round trip on one connection: the injected latency, measured rather than assumed. */
async function measureRoundTrip(databaseUrl, n = 21) {
  const { Client } = driverRequire('pg');
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  const ms = [];
  try {
    await c.query('select 1');
    for (let i = 0; i < n; i++) { const t0 = performance.now(); await c.query('select 1'); ms.push(performance.now() - t0); }
  } finally { await c.end(); }
  return round(median(ms));
}
async function stopServer(server) {
  if (!server || server.exited) { liveServers.delete(server); return; }
  try { process.kill(-server.child.pid, 'SIGTERM'); } catch { /* already gone */ }
  const t0 = Date.now();
  while (!server.exited && Date.now() - t0 < 15_000) await new Promise((r) => setTimeout(r, 200));
  if (!server.exited) { try { process.kill(-server.child.pid, 'SIGKILL'); } catch { /* gone */ } }
  liveServers.delete(server);
}
function killAllSync() {
  for (const s of liveServers) { try { process.kill(-s.child.pid, 'SIGKILL'); } catch { /* gone */ } }
}
process.on('exit', killAllSync);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killAllSync(); process.exit(130); });

// ── HTTP ──────────────────────────────────────────────────────────────────
/** One request; returns status, body, client ms, and the parsed Server-Timing marks. */
async function call(server, token, method, path, body, { detail = false } = {}) {
  const headers = { Origin: server.origin, 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (detail) headers['X-OS-Debug-Timing'] = 'json';
  const t0 = performance.now();
  const res = await fetch(server.base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(args.requestTimeoutMs),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  const timing = parseServerTiming(res.headers.get('server-timing') ?? '');
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  let sql;
  const d = res.headers.get('x-os-debug-timing-detail');
  if (d) { try { sql = JSON.parse(d).db; } catch { sql = undefined; } }
  return { status: res.status, json, text, ms, timing, sql };
}

function parseServerTiming(header) {
  const out = {};
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const entry = {};
    for (const p of params) {
      const [k, v] = p.split('=');
      entry[k.trim()] = v?.replace(/^"|"$/g, '');
    }
    out[name.trim()] = entry;
  }
  return out;
}
const dbQueries = (timing) => {
  const m = /^(\d+)/.exec(timing?.db?.desc ?? '');
  return m ? Number(m[1]) : undefined;
};

async function signIn(server, email, password) {
  const r = await call(server, undefined, 'POST', '/auth/sign-in/email', { email, password });
  if (r.status !== 200 || !r.json?.token) throw new Error(`sign-in ${email} failed: ${r.status} ${r.text.slice(0, 300)}`);
  return { token: r.json.token, userId: r.json.user?.id };
}

const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const MEMBER = { email: 'bench-member@bench.test', first: 'bench-member-pass-1', password: 'bench-member-pass-2' };

/** First boot: the admin exists (dev seed); mint the member through the admin route. */
async function provisionMember(server, adminToken) {
  const created = await call(server, adminToken, 'POST', '/auth/admin/create-user', {
    email: MEMBER.email, password: MEMBER.first, name: 'Bench Member', role: 'user',
  });
  if (created.status !== 200) throw new Error(`create member failed: ${created.status} ${created.text.slice(0, 300)}`);
  const first = await signIn(server, MEMBER.email, MEMBER.first);
  const changed = await call(server, first.token, 'POST', '/auth/change-password', {
    currentPassword: MEMBER.first, newPassword: MEMBER.password, revokeOtherSessions: false,
  });
  if (changed.status !== 200) throw new Error(`member password change failed: ${changed.status} ${changed.text.slice(0, 300)}`);
}

/** One row per object through the API, so the bulk load copies the system columns the runtime really writes. */
async function templateRows(server, admin, member) {
  const post = async (who, object, body) => {
    const r = await call(server, who.token, 'POST', `/data/${object}`, body);
    if (r.status !== 200 && r.status !== 201) throw new Error(`template ${object} failed: ${r.status} ${r.text.slice(0, 300)}`);
    return r.json.record ?? r.json;
  };
  const region = await post(admin, 'bench_region', { name: 'template' });
  const product = await post(admin, 'bench_product', { name: 'template', family: 'hardware' });
  const memberAccount = await post(member, 'bench_account', { name: 'template', region: region.id });
  const adminAccount = await post(admin, 'bench_account', { name: 'template-admin', region: region.id });
  const opportunity = await post(member, 'bench_opportunity', { name: 'template', account: memberAccount.id, stage: 'won', amount: 1 });
  const line = await post(member, 'bench_line_item', { name: 'template', opportunity: opportunity.id, product: product.id, quantity: 1, unit_price: 1, status: 'open' });
  return { region, product, memberAccount, adminAccount, opportunity, line };
}

// ── bulk load ─────────────────────────────────────────────────────────────
function knexFor(databaseUrl) {
  const knex = driverRequire('knex');
  if (args.dialect === 'sqlite') {
    return knex({ client: 'better-sqlite3', connection: { filename: databaseUrl.replace(/^file:/, '') }, useNullAsDefault: true });
  }
  return knex({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 2 } });
}

async function bulkLoad(databaseUrl, t) {
  const db = knexFor(databaseUrl);
  const orgId = t.memberAccount.organization_id;
  const adminId = t.adminAccount.owner_id;
  const memberId = t.memberAccount.owner_id;
  if (t.adminAccount.organization_id !== orgId) {
    log(`WARNING: admin rows land in organization ${t.adminAccount.organization_id}, member rows in ${orgId}; seeding everything into the member's`);
  }
  const t0Ms = Date.UTC(2025, 0, 1);
  const spanMs = 730 * 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  const sys = (i, ownerIsMember) => {
    const created = iso(t0Ms + Math.floor((i * 7919) % spanMs));
    const who = ownerIsMember ? memberId : adminId;
    return { created_at: created, updated_at: created, organization_id: orgId, created_by: who, updated_by: who, owner_id: who };
  };
  const tables = [
    'bench_line_item', 'bench_opportunity', 'bench_account', 'bench_product', 'bench_region',
    ...ROLLUPS.flatMap((n) => [`bench_roll${n}_item`, `bench_roll${n}`]),
  ];
  for (const table of tables) await db(table).del();
  await db('sys_record_share').where({ object_name: 'bench_account' }).del();

  // SQLite: one prepared statement per table inside a transaction (knex's
  // multi-row insert compiles to a compound SELECT, which SQLite caps at 500
  // terms). PostgreSQL: knex multi-row VALUES, 1000 rows (13k binds) a batch.
  const sqlite = args.dialect === 'sqlite' ? new (driverRequire('better-sqlite3'))(databaseUrl.replace(/^file:/, '')) : undefined;
  async function load(table, count, row) {
    const started = Date.now();
    if (sqlite) {
      const cols = Object.keys(row(0));
      const stmt = sqlite.prepare(`insert into "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`);
      sqlite.transaction(() => { for (let i = 0; i < count; i++) { const o = row(i); stmt.run(cols.map((c) => o[c])); } })();
    } else {
      const batch = 1000;
      await db.transaction(async (trx) => {
        let rows = [];
        for (let i = 0; i < count; i++) {
          rows.push(row(i));
          if (rows.length === batch) { await trx(table).insert(rows); rows = []; }
        }
        if (rows.length) await trx(table).insert(rows);
      });
    }
    log(`  ${table}: ${count} rows in ${Date.now() - started} ms`);
  }
  const r = rng(42);
  await load('bench_region', SHAPE.regions, (i) => ({ id: id.region(i), ...sys(i, false), name: `Region ${i}`, code: `R${i}` }));
  await load('bench_product', SHAPE.products, (i) => ({ id: id.product(i), ...sys(i, false), name: `Product ${i}`, family: FAMILIES[i % FAMILIES.length] }));
  await load('bench_account', SHAPE.accounts, (i) => ({
    id: id.account(i), ...sys(i, memberOwnsAccount(i)), name: `Account ${i}`, region: id.region(i % SHAPE.regions),
    industry: INDUSTRIES[i % INDUSTRIES.length], annual_revenue: Math.floor(r() * 1e7),
  }));
  await load('bench_opportunity', SHAPE.opportunities, (i) => {
    const acc = accountOf(i);
    return {
      id: id.opportunity(i), ...sys(i, memberOwnsAccount(acc)), name: `Opportunity ${i}`, account: id.account(acc),
      stage: STAGES[Math.floor(r() * STAGES.length)], amount: Math.floor(r() * 100_000),
      close_date: iso(t0Ms + Math.floor(r() * spanMs)).slice(0, 10),
    };
  });
  await load('bench_line_item', SHAPE.lineItems, (i) => {
    const opp = oppOf(i);
    return {
      id: id.line(i), ...sys(i, memberOwnsAccount(accountOf(opp))), name: `Line ${i}`, opportunity: id.opportunity(opp),
      product: id.product(i % SHAPE.products), quantity: 1 + Math.floor(r() * 20), unit_price: Math.floor(r() * 1000),
      status: STATUSES[Math.floor(r() * STATUSES.length)],
    };
  });
  // R10: the roll-up pairs, parents seeded with the values their summaries
  // would hold, so a recompute writes a real change and never a backfill.
  const per = SHAPE.rollupItemsPerParent;
  for (const n of ROLLUPS) {
    const qty = (i) => 1 + (i % 7);
    const totals = new Array(SHAPE.rollupParents).fill(0);
    for (let i = 0; i < SHAPE.rollupParents * per; i++) totals[Math.floor(i / per)] += qty(i);
    await load(`bench_roll${n}`, SHAPE.rollupParents, (i) => ({
      id: id.rollup(n, i), ...sys(i, false), name: `Roll-up ${n}/${i}`,
      ...(n >= 1 ? { total_quantity: totals[i] } : {}), ...(n >= 2 ? { item_count: per } : {}),
    }));
    await load(`bench_roll${n}_item`, SHAPE.rollupParents * per, (i) => ({
      id: id.rollupItem(n, i), ...sys(i, false), name: `Item ${n}/${i}`, parent: id.rollup(n, Math.floor(i / per)), quantity: qty(i), amount: 10,
    }));
  }

  // R9: `--shares N` user grants on accounts the member does NOT own, written
  // as the sharing service stores a manual grant (`sys_record_share`), so the
  // member's read scope is "owned OR shared". Its columns are read from the
  // table schema sync created; a NOT NULL column this row does not fill fails
  // the run here instead of being guessed.
  let shared = [];
  if (args.shares > 0) {
    const notOwned = [];
    for (let i = 0; i < SHAPE.accounts; i++) if (!memberOwnsAccount(i)) notOwned.push(i);
    if (args.shares > notOwned.length) throw new Error(`--shares ${args.shares} exceeds the ${notOwned.length} accounts the member does not own at --scale ${args.scale}`);
    // Spread over the whole table (every k-th non-owned account), not its head.
    const step = notOwned.length / args.shares;
    shared = Array.from({ length: args.shares }, (_, k) => notOwned[Math.floor(k * step)]);
    const columns = await db('sys_record_share').columnInfo();
    const now = iso(Date.UTC(2026, 0, 1));
    const shareRow = (k) => {
      const row = {
        id: id.share(k), object_name: 'bench_account', record_id: id.account(shared[k]),
        recipient_type: 'user', recipient_id: memberId, access_level: 'read', source: 'manual',
        granted_by: adminId, created_at: now, updated_at: now,
        organization_id: orgId, created_by: adminId, updated_by: adminId, owner_id: adminId,
      };
      return Object.fromEntries(Object.entries(row).filter(([c]) => c in columns));
    };
    const filled = new Set(Object.keys(shareRow(0)));
    const unfilled = Object.entries(columns).filter(([c, info]) => !filled.has(c) && info.nullable === false && info.defaultValue == null).map(([c]) => c);
    if (unfilled.length) throw new Error(`sys_record_share has NOT NULL columns the share seed does not fill: ${unfilled.join(', ')}`);
    await load('sys_record_share', args.shares, shareRow);
  }

  if (sqlite) { sqlite.exec('ANALYZE'); sqlite.close(); } else await db.raw('ANALYZE');
  const indexes = args.dialect === 'sqlite'
    ? await db.raw("select tbl_name as table_name, name as index_name, sql as definition from sqlite_master where type = 'index' and (tbl_name like 'bench_%' or tbl_name = 'sys_record_share') order by tbl_name, name")
    : (await db.raw("select tablename as table_name, indexname as index_name, indexdef as definition from pg_indexes where (tablename like 'bench_%' or tablename = 'sys_record_share') order by tablename, indexname")).rows;
  await db.destroy();
  const memberOwned = Array.from({ length: SHAPE.accounts }, (_, i) => i).filter(memberOwnsAccount).length;
  return {
    orgId, adminId, memberId, indexes,
    shares: {
      seeded: args.shares, memberOwnedAccounts: memberOwned, expectedVisibleAccounts: memberOwned + shared.length,
      firstSharedAccount: shared.length ? id.account(shared[0]) : undefined,
      lastSharedAccount: shared.length ? id.account(shared[shared.length - 1]) : undefined,
    },
  };
}

async function preparePgDatabase() {
  const { Client } = driverRequire('pg');
  const dbName = `os_sqlperf_${args.scale}`;
  const admin = new Client({ connectionString: args.pgUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(args.pgUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

// ── scenarios ─────────────────────────────────────────────────────────────
const enc = (o) => encodeURIComponent(JSON.stringify(o));
function scenarios(ctx) {
  const memberOpp = id.opportunity(0); // account 0 is the member's
  const page = {
    related: [{ object: 'bench_line_item', field: 'opportunity', top: 10, sort: [{ field: 'created_at', order: 'desc' }], expand: ['product'] }],
    fieldAccess: true,
  };
  const list = (filter, extra = '') => `/data/bench_line_item?filter=${enc(filter)}&sort=-created_at&top=50${extra}`;
  const base = [
    // 1. list reads with filters and sorts
    { name: 'list_filter_sort', who: 'admin', method: 'GET', path: list({ status: 'open', quantity: { $gte: 10 } }) },
    { name: 'list_filter_sort', who: 'member', method: 'GET', path: list({ status: 'open', quantity: { $gte: 10 } }) },
    { name: 'list_deep_page', who: 'admin', method: 'GET', path: `${list({ status: 'open' })}&skip=${Math.floor(args.scale / 8)}` },
    // 2. cross-object filters (the id-list-then-$in lowering)
    { name: 'cross_object_filter_small', who: 'admin', method: 'GET', path: list({ product: { family: 'hardware' } }), note: 'product.family matches 50 product ids' },
    { name: 'cross_object_filter_small', who: 'member', method: 'GET', path: list({ product: { family: 'hardware' } }) },
    { name: 'cross_object_filter_large', who: 'admin', method: 'GET', path: list({ opportunity: { stage: 'won' } }), note: `opportunity.stage=won matches ~${Math.round(SHAPE.opportunities / 5)} ids; the cap is 1000` },
    // 3. dataset aggregates
    { name: 'aggregate_group_status', who: 'admin', method: 'POST', path: '/data/bench_line_item/query', body: { groupBy: ['status'], aggregations: [{ function: 'sum', field: 'quantity', alias: 'q' }, { function: 'count', alias: 'n' }] } },
    { name: 'aggregate_group_status', who: 'member', method: 'POST', path: '/data/bench_line_item/query', body: { groupBy: ['status'], aggregations: [{ function: 'sum', field: 'quantity', alias: 'q' }, { function: 'count', alias: 'n' }] } },
    { name: 'aggregate_measure_filter', who: 'admin', method: 'POST', path: '/data/bench_line_item/query', body: { groupBy: ['status'], aggregations: [{ function: 'sum', field: 'quantity', alias: 'big', filter: { quantity: { $gte: 10 } } }, { function: 'count', alias: 'n' }] }, note: 'a per-measure filter routes engine.aggregate to the in-memory path' },
    { name: 'analytics_cube_status', who: 'admin', method: 'POST', path: '/analytics/query', body: { cube: 'bench_line_item', measures: ['count'], dimensions: ['status'] } },
    { name: 'analytics_cube_status', who: 'member', method: 'POST', path: '/analytics/query', body: { cube: 'bench_line_item', measures: ['count'], dimensions: ['status'] } },
    { name: 'analytics_cross_object_dim', who: 'admin', method: 'POST', path: '/analytics/query', body: { cube: 'bench_line_item', measures: ['count'], dimensions: ['opportunity.stage'] }, note: 'a dimension through a lookup' },
    { name: 'analytics_month_tz', who: 'admin', method: 'POST', path: '/analytics/query', body: { cube: 'bench_opportunity', measures: ['count'], timeDimensions: [{ dimension: 'close_date', granularity: 'month' }], timezone: 'Asia/Shanghai' }, note: 'a non-UTC date bucket routes engine.aggregate to the in-memory path' },
    // 4. record page with related lists
    { name: 'record_page', who: 'admin', method: 'POST', path: `/data/bench_opportunity/${memberOpp}/page`, body: page },
    { name: 'record_page', who: 'member', method: 'POST', path: `/data/bench_opportunity/${memberOpp}/page`, body: page },
    // 5. read-scoped reads as a non-admin (and the admin control)
    { name: 'scoped_list_unfiltered', who: 'admin', method: 'GET', path: '/data/bench_line_item?sort=-created_at&top=50' },
    { name: 'scoped_list_unfiltered', who: 'member', method: 'GET', path: '/data/bench_line_item?sort=-created_at&top=50' },
    { name: 'scoped_account_list', who: 'member', method: 'GET', path: '/data/bench_account?sort=-created_at&top=50' },
    // 6. per-request fixed cost (R8): a public object, one page and its count,
    // so everything past those two statements is identity and permission work.
    { name: 'public_list_tiny', who: 'admin', method: 'GET', path: '/data/bench_region?top=1' },
    { name: 'public_list_tiny', who: 'member', method: 'GET', path: '/data/bench_region?top=1' },
    // 7. child writes under roll-up summaries (R10), as the admin.
    ...rollupScenarios(),
  ];
  // 8. the paged list without its total (R12): every paged-list scenario above
  // again with `count=false`, which skips the `count(*)` the list door runs
  // beside each page. A pair's difference is what that total costs; the twin's
  // rows/total cell shows no total, which is the proof the opt-out was honoured.
  const twins = base
    .filter((s) => s.method === 'GET' && /[?&]top=\d+/.test(s.path))
    .map((s) => ({ ...s, name: `${s.name}_nocount`, path: `${s.path}&count=false` }));
  return [...base, ...twins].filter((s) => !args.only || args.only.includes(s.name));
}

/**
 * R10: the same batch child write on the three roll-up pairs (0, 1, 2 summary
 * fields), spread over 1 and over 10 distinct parents. A body is a function of
 * the call number, so no two calls write the same values (an update that
 * changes nothing proves nothing about the recompute).
 */
function rollupScenarios() {
  const batch = 50;
  const per = SHAPE.rollupItemsPerParent;
  const out = [];
  for (const parents of [1, 10]) {
    for (const n of ROLLUPS) {
      // Inserts land on parents 100.. so they never grow the update leg's parents.
      out.push({
        name: `rollup${n}_insert_p${parents}`, who: 'admin', method: 'POST', path: `/data/bench_roll${n}_item/createMany`,
        note: `createMany of ${batch} children over ${parents} parent(s); ${n} summary field(s) on the parent`,
        body: (call) => Array.from({ length: batch }, (_, k) => ({ name: `new ${call}/${k}`, parent: id.rollup(n, 100 + (k % parents)), quantity: 1 + ((call + k) % 5), amount: 10 })),
      });
      // Updates touch `batch / parents` seeded children of each of parents 0..parents-1.
      const each = batch / parents;
      out.push({
        name: `rollup${n}_update_p${parents}`, who: 'admin', method: 'POST', path: `/data/bench_roll${n}_item/updateMany`,
        note: `updateMany of ${batch} children (quantity) over ${parents} parent(s); ${n} summary field(s) on the parent`,
        body: (call) => ({ records: Array.from({ length: batch }, (_, k) => ({ id: id.rollupItem(n, Math.floor(k / each) * per + (k % each)), data: { quantity: 1 + ((call + k) % 9) } })) }),
      });
    }
  }
  for (const n of ROLLUPS) {
    out.push({
      name: `rollup${n}_insert_one`, who: 'admin', method: 'POST', path: `/data/bench_roll${n}_item`,
      note: `one child insert; ${n} summary field(s) on the parent`,
      body: (call) => ({ name: `one ${call}`, parent: id.rollup(n, 150), quantity: 1 + (call % 5), amount: 10 }),
    });
  }
  return out;
}

/** The table each captured statement reads or writes first, counted: where a request's statements go. */
function statementsByTable(queries) {
  const out = {};
  for (const q of queries ?? []) {
    const text = String(q.label ?? q.sql ?? q ?? '');
    const m = /\b(?:from|into|update)\s+["`]?([A-Za-z0-9_]+)["`]?/i.exec(text);
    const key = `${/^\s*(\w+)/.exec(text)?.[1]?.toLowerCase() ?? '?'} ${m?.[1] ?? '?'}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

const pct = (sorted, p) => (sorted.length === 0 ? undefined : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
const round = (n) => (n === undefined ? undefined : Math.round(n * 10) / 10);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return pct(s, 50); };

/**
 * `--sql-log`: every statement of ONE request, for the member too. The server
 * runs with knex's `DEBUG=knex:query`, which writes each statement (bindings
 * stripped) to the server log; requests run one at a time, so the lines the log
 * gained during this call are this call's. The detail header lists only the 20
 * slowest statements, and only to an admin. The run's timings carry the log's
 * own cost, so a `--sql-log` run is for shapes and counts, not milliseconds.
 */
async function captureStatements(server, token, sc, payload) {
  const { readFileSync, statSync } = await import('node:fs');
  const before = statSync(server.logFile).size;
  const r = await call(server, token, sc.method, sc.path, payload);
  await new Promise((res) => setTimeout(res, 100)); // let the child's stderr reach the file
  const text = readFileSync(server.logFile).subarray(before).toString('utf8');
  const statements = [];
  for (const line of text.split('\n')) {
    const m = /knex:query (.*?)(?: undefined)?(?: \+\d+m?s)?$/.exec(line);
    if (m) statements.push(m[1].trim());
  }
  return { status: r.status, serverCount: dbQueries(r.timing), statements };
}

async function runScenario(server, tokens, sc) {
  const token = tokens[sc.who];
  let calls = 0;
  const body = () => (typeof sc.body === 'function' ? sc.body(calls++) : sc.body);

  // The SQL shapes, once, admin only (the detail header is never disclosed to a member).
  let shapes;
  if (sc.who === 'admin') {
    const probe = await call(server, token, sc.method, sc.path, body(), { detail: true });
    shapes = probe.sql;
    if (probe.status >= 400) log(`  ${sc.name} [${sc.who}] probe answered ${probe.status}: ${probe.text.slice(0, 300)}`);
  }
  for (let i = 0; i < args.warmup; i++) await call(server, token, sc.method, sc.path, body());
  // Captured warm, after the warmup, so it is the shape the timed calls run.
  let captured;
  if (args.sqlLog) {
    const c = await captureStatements(server, token, sc, body());
    const binds = c.statements.map((t) => (t.match(/\?|\$\d+/g) ?? []).length);
    captured = { status: c.status, serverCount: c.serverCount, logged: c.statements.length, maxBinds: Math.max(0, ...binds), byTable: statementsByTable(c.statements), statements: c.statements };
    if (c.serverCount !== c.statements.length) log(`  ${sc.name} [${sc.who}] the log holds ${c.statements.length} statements, Server-Timing counted ${c.serverCount} (the difference is background work that ran during the call)`);
  }
  const samples = [];
  for (let i = 0; i < args.iterations; i++) {
    const r = await call(server, token, sc.method, sc.path, body());
    samples.push({ status: r.status, ms: r.ms, serverMs: Number(r.timing.total?.dur ?? NaN), dbMs: Number(r.timing.db?.dur ?? NaN), queries: dbQueries(r.timing), rows: Array.isArray(r.json?.records) ? r.json.records.length : Array.isArray(r.json?.data?.rows) ? r.json.data.rows.length : undefined, total: r.json?.total, error: r.status >= 400 ? (r.json?.code ?? r.json?.error?.code ?? r.text.slice(0, 160)) : undefined });
  }
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const result = {
    name: sc.name, who: sc.who, method: sc.method, path: sc.path, body: typeof sc.body === 'function' ? sc.body(0) : sc.body, note: sc.note,
    status: [...new Set(samples.map((s) => s.status))].join('/'),
    error: samples.find((s) => s.error)?.error,
    p50: round(pct(ms, 50)), p95: round(pct(ms, 95)),
    serverP50: round(median(samples.map((s) => s.serverMs).filter(Number.isFinite))),
    dbMsP50: round(median(samples.map((s) => s.dbMs).filter(Number.isFinite))),
    queries: median(samples.map((s) => s.queries).filter((q) => q !== undefined)),
    rows: samples[0]?.rows, total: samples[0]?.total,
    shapes: shapes ? { count: shapes.count, totalMs: shapes.totalMs, slowest20ByTable: statementsByTable(shapes.queries), queries: shapes.queries } : undefined,
    captured,
    samples,
  };
  log(`  ${sc.name} [${sc.who}] ${result.status} p50=${result.p50}ms p95=${result.p95}ms queries=${result.queries}${result.error ? ` error=${result.error}` : ''}`);
  return result;
}

/** Write path: delete an opportunity with its line items (cascade), as the admin, one at a time. */
async function runCascadeDeletes(server, tokens) {
  const samples = [];
  const perOpp = Math.round(SHAPE.lineItems / SHAPE.opportunities);
  for (let i = 0; i < args.cascadeDeletes; i++) {
    const opp = id.opportunity(SHAPE.opportunities - 1 - i); // an admin-owned tail opportunity
    const r = await call(server, tokens.admin, 'DELETE', `/data/bench_opportunity/${opp}`);
    samples.push({ status: r.status, ms: r.ms, serverMs: Number(r.timing.total?.dur ?? NaN), queries: dbQueries(r.timing), error: r.status >= 400 ? r.text.slice(0, 160) : undefined });
  }
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const result = {
    name: 'cascade_delete_opportunity', who: 'admin', method: 'DELETE', path: '/data/bench_opportunity/:id',
    note: `each opportunity holds ${perOpp} line items (deleteBehavior: cascade)`,
    status: [...new Set(samples.map((s) => s.status))].join('/'), error: samples.find((s) => s.error)?.error,
    p50: round(pct(ms, 50)), p95: round(pct(ms, 95)), serverP50: round(median(samples.map((s) => s.serverMs).filter(Number.isFinite))),
    queries: median(samples.map((s) => s.queries).filter((q) => q !== undefined)), samples,
  };
  log(`  cascade_delete_opportunity [admin] ${result.status} p50=${result.p50}ms queries=${result.queries}`);
  return result;
}

function markdown(report) {
  const lines = [];
  lines.push(`# SQL performance baseline — ${report.dialect}, ${report.shape.lineItems} line items`);
  lines.push('');
  lines.push(`commit \`${report.commit}\` · ${report.startedAt} · iterations ${report.iterations} (warmup ${report.warmup}) · seed ${report.seedMs} ms`);
  lines.push(`shape: ${report.shape.regions} regions · ${report.shape.products} products · ${report.shape.accounts} accounts · ${report.shape.opportunities} opportunities · ${report.shape.lineItems} line items · member owns every ${report.shape.memberEvery}th account`);
  const { shares, network, grantsCache } = report.legs;
  const byId = shares.firstSharedGet ? `; by id: first shared ${shares.firstSharedGet.status}, last shared ${shares.lastSharedGet.status}${shares.lastSharedGet.code ? ` ${shares.lastSharedGet.code}` : ''}` : '';
  lines.push(`legs: shares ${shares.seeded} (member owns ${shares.memberOwnedAccounts} accounts, expected visible ${shares.expectedVisibleAccounts}, reads ${shares.memberVisibleAccounts ?? 'n/a'}${byId}) · grants cache ${grantsCache.ttlMs}${grantsCache.bootLine ? ` (\`${grantsCache.bootLine.replace(/`/g, '')}\`)` : ''} · network ${network ? `+${network.injectedRttMs} ms RTT: select 1 direct ${network.directSelect1Ms} ms, proxied ${network.proxiedSelect1Ms} ms, ${network.proxyStats?.chunksToDb} chunks to the database` : 'none (local socket)'}`);
  lines.push('');
  lines.push('| scenario | who | status | p50 ms | p95 ms | server p50 ms | db ms p50 | SQL statements | rows/total |');
  lines.push('|:--|:--|:--|--:|--:|--:|--:|--:|:--|');
  for (const r of report.results) {
    lines.push(`| ${r.name} | ${r.who} | ${r.status}${r.error ? ` ${r.error}` : ''} | ${r.p50 ?? ''} | ${r.p95 ?? ''} | ${r.serverP50 ?? ''} | ${r.dbMsP50 ?? ''} | ${r.queries ?? ''} | ${r.rows ?? ''}${r.total !== undefined ? `/${r.total}` : ''} |`);
  }
  lines.push('');
  if (report.results.some((r) => r.captured)) {
    lines.push('## Where the statements go (`--sql-log`: every statement of one request, by verb and first table)');
    lines.push('');
    for (const r of report.results) {
      if (!r.captured) continue;
      const parts = Object.entries(r.captured.byTable).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`);
      lines.push(`- ${r.name} [${r.who}]: ${r.captured.logged} logged (Server-Timing ${r.captured.serverCount}), at most ${r.captured.maxBinds} binds in one statement — ${parts.join(', ')}`);
    }
    lines.push('');
  }
  lines.push('');
  lines.push('## Indexes on the fixture tables after schema sync');
  lines.push('');
  for (const ix of report.indexes) lines.push(`- \`${ix.table_name}\` · \`${ix.index_name}\`${ix.definition ? ` · ${String(ix.definition).replace(/`/g, '')}` : ''}`);
  return lines.join('\n') + '\n';
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(OS_BIN)) throw new Error(`no os binary at ${OS_BIN}; run pnpm install`);
  mkdirSync(args.workDir, { recursive: true });
  mkdirSync(args.out, { recursive: true });
  const startedAt = new Date().toISOString();
  const { execSync } = await import('node:child_process');
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim(); } catch { /* not a checkout */ }

  let databaseUrl;
  if (args.dialect === 'sqlite') {
    const file = join(args.workDir, `bench-${args.scale}.sqlite`);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    databaseUrl = `file:${file}`;
  } else {
    databaseUrl = await withDeadline(preparePgDatabase(), 60_000, 'creating the PostgreSQL database');
  }
  log(`dialect=${args.dialect} scale=${args.scale} work=${args.workDir}`);

  // Boot 1: schema sync, dev admin, member, one template row per object.
  let server = await bootServer(databaseUrl, `${args.dialect}-${args.scale}-sync`);
  let template;
  try {
    const admin = await signIn(server, ADMIN.email, ADMIN.password);
    await provisionMember(server, admin.token);
    const member = await signIn(server, MEMBER.email, MEMBER.password);
    template = await templateRows(server, admin, member);
  } finally {
    await stopServer(server);
  }

  // Bulk load with the server down, then ANALYZE.
  const seedStarted = Date.now();
  log('bulk load');
  const loaded = await withDeadline(bulkLoad(databaseUrl, template), args.seedTimeoutMs, 'the bulk load');
  const seedMs = Date.now() - seedStarted;

  // Boot 2: measure — through the latency proxy (R8) and with the grants
  // cache TTL (R8) when the run asks for them.
  const measureEnv = {};
  if (args.grantsCacheTtlMs !== undefined) measureEnv.OS_AUTHZ_GRANTS_CACHE_TTL_MS = String(args.grantsCacheTtlMs);
  if (args.sqlLog) { measureEnv.DEBUG = 'knex:query'; measureEnv.DEBUG_COLORS = 'no'; }
  let proxy;
  let network;
  if (args.dbLatencyMs > 0) {
    proxy = await startLatencyProxy(databaseUrl, args.dbLatencyMs);
    network = {
      injectedRttMs: args.dbLatencyMs,
      method: 'in-process TCP proxy between the server and PostgreSQL, holding each chunk rttMs/2 in each direction',
      directSelect1Ms: await measureRoundTrip(databaseUrl),
      proxiedSelect1Ms: await measureRoundTrip(proxy.url),
    };
    log(`latency proxy: select 1 direct ${network.directSelect1Ms} ms, through the proxy ${network.proxiedSelect1Ms} ms (injected ${args.dbLatencyMs} ms)`);
  }
  const label = `${args.dialect}-${args.scale}${args.suffix}-measure`;
  server = await bootServer(proxy ? proxy.url : databaseUrl, label, measureEnv);
  // Prove the cache posture from the server's own boot line, not from the flag.
  const { readFileSync } = await import('node:fs');
  const cacheLine = readFileSync(server.logFile, 'utf8').split('\n').find((l) => l.includes('[authz-cache]'));
  const grantsCache = { ttlMs: args.grantsCacheTtlMs ?? 'unset (server default)', bootLine: cacheLine?.trim().slice(0, 240) ?? null };
  if (args.grantsCacheTtlMs > 0 && !cacheLine?.includes('ENABLED')) log(`WARNING: --grants-cache-ttl-ms ${args.grantsCacheTtlMs} but the server printed no "grants cache ENABLED" line; see ${server.logFile}`);
  const results = [];
  try {
    const tokens = {
      admin: (await signIn(server, ADMIN.email, ADMIN.password)).token,
      member: (await signIn(server, MEMBER.email, MEMBER.password)).token,
    };
    for (const sc of scenarios({})) {
      try {
        results.push(await runScenario(server, tokens, sc));
      } catch (e) {
        results.push({ name: sc.name, who: sc.who, path: sc.path, status: 'unmeasured', error: String(e?.message ?? e) });
        log(`  ${sc.name} [${sc.who}] UNMEASURED: ${e?.message ?? e}`);
      }
    }
    // R9: read the first and the last account shared to the member, by id. Both
    // are granted the same way, so both should answer 200.
    if (loaded.shares.firstSharedAccount) {
      for (const [key, acc] of [['firstSharedGet', loaded.shares.firstSharedAccount], ['lastSharedGet', loaded.shares.lastSharedAccount]]) {
        const r = await call(server, tokens.member, 'GET', `/data/bench_account/${acc}`);
        loaded.shares[key] = { account: acc, status: r.status, code: r.status >= 400 ? (r.json?.code ?? r.json?.error?.code) : undefined };
        log(`  shared account ${acc} read by the member by id: ${r.status}`);
      }
    }
    if (!args.only || args.only.includes('cascade_delete_opportunity')) {
      try { results.push(await runCascadeDeletes(server, tokens)); } catch (e) {
        results.push({ name: 'cascade_delete_opportunity', who: 'admin', status: 'unmeasured', error: String(e?.message ?? e) });
      }
    }
  } finally {
    await stopServer(server);
    if (proxy) { network.proxyStats = { ...proxy.stats }; await proxy.close(); }
  }

  // R9: did the member see what the seeded shares grant? Owned + shared accounts.
  const accountList = results.find((r) => r.name === 'scoped_account_list' && r.who === 'member');
  const shares = { ...loaded.shares, memberVisibleAccounts: accountList?.total };
  if (accountList && accountList.total !== shares.expectedVisibleAccounts) {
    log(`VISIBLE ROWS MISMATCH: the member reads ${accountList.total} accounts; it owns ${shares.memberOwnedAccounts} and holds ${shares.seeded} read shares (expected ${shares.expectedVisibleAccounts})`);
  }

  const report = { dialect: args.dialect, scale: args.scale, commit, startedAt, iterations: args.iterations, warmup: args.warmup, seedMs, shape: SHAPE, legs: { shares, network: network ?? null, grantsCache }, indexes: loaded.indexes, results };
  const base = join(args.out, `${args.dialect}-${args.scale}${args.suffix}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown(report));
  log(`wrote ${base}.json and ${base}.md`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error(`[bench] FAILED: ${e?.stack ?? e}`); killAllSync(); process.exit(1); },
);
