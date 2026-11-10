#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * qa-fixture — the platform checklist's four recurring fixtures, one command each.
 *
 *   node scripts/qa/qa-fixture.mjs contributor-member [--base-url URL] [--email ADDR] [--task]
 *   node scripts/qa/qa-fixture.mjs walled-boot [--posture isolated|group] [--organization SLUG | --no-organization] [--port N] [--dir DIR]
 *   node scripts/qa/qa-fixture.mjs external-database [--port N] [--dir DIR]
 *   node scripts/qa/qa-fixture.mjs broken-upstream-app [--variant missing-script|config-fault] [--dir DIR]
 *   node scripts/qa/qa-fixture.mjs restore-upstream --dir DIR
 *   node scripts/qa/qa-fixture.mjs teardown --dir DIR
 *
 * Common flags: `--base-url` (default `http://localhost:$OS_PORT`, else :3000),
 * `--admin-email` / `--admin-password` (default the `--seed-admin` pair,
 * admin@objectos.ai / admin123).
 *
 * ## What each one provisions, and which ledger entry it replays
 *
 * Each of these used to be prose a runner re-derived every run, and the
 * 2026-11-10 full-platform run (QA run #32135) recorded all four as the fixture
 * debt that keeps high-value items `blocked(fixture)`. The ledger stays the
 * authority on WHY each call is shaped the way it is; this script only replays
 * it, and names the entry it replays:
 *
 * - `contributor-member` — the area recipe `search:qa-contributor-bound-member`
 *   (`docs/qa/platform-checklist/areas/search.json`), steps 1–5 in order, against
 *   a RUNNING stock boot: invite, invited sign-up, the `showcase_contributor`
 *   position row, the subset proof (zero seeded invoices, INV-1003 not served)
 *   and an own-row invoice. `--task` adds one showcase_task assigned to the
 *   member (records-forms.calendar-interactions steps[2]). Prints the persona's
 *   credentials and ids.
 * - `walled-boot` — RUNNER.md's "A walled boot is a fixture of its own": boots the
 *   showcase from this tree through `os dev` on its own port and file DB with
 *   `OS_TENANCY_POSTURE`, `OS_PLATFORM_OWNER_EMAIL` and
 *   `OS_AUTH_MEMBERSHIP_POLICY` exported, waits for health and the ready banner,
 *   and proves the wall took: no DEGRADED banner, and `GET /api/v1/auth/config`
 *   answers `features.multiOrgEnabled: true`, the posture asked for and
 *   `degradedTenancy: false`. Then the operator creates an organization and
 *   makes it current (`--no-organization` skips it), so its printed session
 *   token can mint walled personas through admin create-user at once.
 * - `external-database` — the credentialed PostgreSQL that
 *   `integration-system.datasource-credential-refusal-matrix` knownGaps[2]
 *   describes: a scratch cluster with scram-sha-256 auth on 127.0.0.1 (TCP only),
 *   a login role WITH a password and a database it owns. It NEEDS either a
 *   database the runner brings (`OS_TEST_EXTERNAL_DB_URL`) or a local PostgreSQL
 *   install it can run as the `postgres` system user; with neither it refuses,
 *   exit 2, naming both inputs. Passwords are generated per run, written only
 *   under the run's own directory (mode 0600) and printed once — ⛔ never into
 *   this repository.
 * - `broken-upstream-app` — the scratch app
 *   `integration-system.connector-degraded-recovery` fixtures.requires[0] asks
 *   for: a copy of `examples/app-showcase` outside the tree whose stdio MCP
 *   connector's upstream is unreachable (`missing-script`: the fixture script is
 *   parked beside the copy, the variant steps[4] undoes with `restore-upstream`)
 *   or misconfigured (`config-fault`: the transport kind is one no provider
 *   knows). It prints the boot command; the item times the boot itself.
 *
 * Every fixture that leaves a process or a directory behind writes
 * `fixture.json` into its directory, and `teardown --dir DIR` undoes exactly
 * that: it stops only the process groups and the cluster that file recorded
 * (never a process found by name — AGENTS.md, multi-agent discipline §8) and
 * deletes the directory, refusing one that holds no `fixture.json`.
 *
 * ## Output and exit codes
 *
 * Progress goes to stderr; the result is ONE JSON object on stdout. Exit 0: the
 * fixture is provisioned and proved. Exit 1: a step answered something the
 * ledger entry says it must not — the message names the step and the answer, and
 * the ledger entry is where to read why. Exit 2: an input or prerequisite is
 * missing, nothing was started.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, chownSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, symlinkSync, writeFileSync, openSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SHOWCASE = resolve(REPO, 'examples/app-showcase');

class Refusal extends Error {}
class StepFailure extends Error {}

function log(line) {
  process.stderr.write(`qa-fixture: ${line}\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Refusal(`unexpected argument "${arg}"`);
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) flags[key] = inline;
    else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) flags[key] = rest[++i];
    else flags[key] = true;
  }
  return { command, flags };
}

function baseUrlOf(flags) {
  return String(flags['base-url'] || `http://localhost:${process.env.OS_PORT || 3000}`).replace(/\/$/, '');
}

function adminOf(flags) {
  return {
    email: String(flags['admin-email'] || 'admin@objectos.ai'),
    password: String(flags['admin-password'] || 'admin123'),
  };
}

function freshSecret() {
  return randomBytes(18).toString('base64url');
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

async function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function call(base, method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json', Origin: base };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    throw new Refusal(`nothing answers at ${base} (${err.cause?.code || err.message}): boot the showcase first, or pass --base-url`);
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}

function expectStatus(step, answer, ...statuses) {
  if (!statuses.includes(answer.status)) {
    throw new StepFailure(`${step}: answered ${answer.status}, expected ${statuses.join(' or ')} — ${answer.text.slice(0, 400)}`);
  }
  return answer;
}

/** The rows of a data-API list answer, whichever envelope key carries them. */
function rowsOf(answer) {
  const j = answer.json ?? {};
  const rows = j.data?.records ?? j.records ?? j.data?.items ?? j.items ?? (Array.isArray(j.data) ? j.data : undefined) ?? j.value;
  if (!Array.isArray(rows)) throw new StepFailure(`a list answer carried no rows array: ${answer.text.slice(0, 300)}`);
  return rows;
}

/** The record of a data-API single-record answer. */
function recordOf(answer) {
  const j = answer.json ?? {};
  return j.data?.record ?? j.record ?? j.data ?? j;
}

async function signIn(base, email, password) {
  const answer = expectStatus(`sign in as ${email}`, await call(base, 'POST', '/api/v1/auth/sign-in/email', { body: { email, password } }), 200);
  const token = answer.headers.get('set-auth-token');
  if (!token) throw new StepFailure(`sign in as ${email}: 200 without a set-auth-token header`);
  return token;
}

// ── contributor-member ───────────────────────────────────────────────────────

async function contributorMember(flags) {
  const base = baseUrlOf(flags);
  const admin = adminOf(flags);
  const email = String(flags.email || `qa-contributor-${stamp()}@verify.test`);
  const password = freshSecret();
  log(`replaying search:qa-contributor-bound-member against ${base} for ${email}`);

  const adminToken = await signIn(base, admin.email, admin.password);
  const session = expectStatus('read the admin session', await call(base, 'GET', '/api/v1/auth/get-session', { token: adminToken }), 200);
  let organizationId = session.json?.session?.activeOrganizationId;
  if (!organizationId) {
    const orgs = expectStatus('list the admin organizations', await call(base, 'GET', '/api/v1/auth/organization/list', { token: adminToken }), 200);
    organizationId = (Array.isArray(orgs.json) ? orgs.json : [])[0]?.id;
  }
  if (!organizationId) throw new StepFailure('the admin has no organization to invite into (a stock boot holds the Default Organization)');

  // requires[3]: the invite the invite_only default admits the sign-up by.
  const invite = expectStatus('requires: invite the address', await call(base, 'POST', '/api/v1/auth/organization/invite-member', {
    token: adminToken, body: { email, role: 'member', organizationId },
  }), 200, 201);
  const invitationId = invite.json?.id ?? invite.json?.invitation?.id ?? invite.json?.data?.id;
  if (!invitationId) throw new StepFailure(`requires: the invite answered no id — ${invite.text.slice(0, 300)}`);

  // Step 1: the invited sign-up.
  const signUp = expectStatus('step 1: invited sign-up', await call(base, 'POST', '/api/v1/auth/sign-up/email', {
    body: { email, password, name: 'QA Contributor', invitationId },
  }), 200, 201);
  const userIdFromSignUp = signUp.json?.user?.id;

  // Step 2: the principal's sys_user id, as admin.
  const users = rowsOf(expectStatus('step 2: resolve sys_user', await call(base, 'GET', `/api/v1/data/sys_user?email=${encodeURIComponent(email)}`, { token: adminToken }), 200));
  if (users.length !== 1) throw new StepFailure(`step 2: sys_user by email answered ${users.length} rows, expected 1`);
  const userId = users[0].id ?? userIdFromSignUp;

  // Step 3: the position row that makes the persona a subset reader.
  const position = expectStatus('step 3: bind showcase_contributor', await call(base, 'POST', '/api/v1/data/sys_user_position', {
    token: adminToken, body: { user_id: userId, position: 'showcase_contributor', organization_id: organizationId },
  }), 200, 201);
  const positionRowId = recordOf(position)?.id;

  // Step 4: prove the subset before anything is scored on it.
  const memberToken = await signIn(base, email, password);
  const memberInvoices = rowsOf(expectStatus('step 4: member lists showcase_invoice (403 = the binding did not take)',
    await call(base, 'GET', '/api/v1/data/showcase_invoice?$top=200', { token: memberToken }), 200));
  const seededVisible = memberInvoices.filter((r) => /^INV-10(0[1-9]|1[0-2])$/.test(String(r.name)));
  if (seededVisible.length !== 0) {
    throw new StepFailure(`step 4: the member reads ${seededVisible.length} of the twelve seeded invoices, expected none (a VAMA-carrying set resolved)`);
  }
  const inv1003 = rowsOf(expectStatus('step 4: admin finds INV-1003', await call(base, 'GET', '/api/v1/data/showcase_invoice?name=INV-1003', { token: adminToken }), 200))[0];
  if (!inv1003) throw new StepFailure('step 4: the admin cannot find the seeded INV-1003');
  const hidden = await call(base, 'GET', `/api/v1/data/showcase_invoice/${encodeURIComponent(inv1003.id)}`, { token: memberToken });
  if (hidden.status === 200) throw new StepFailure('step 4: the member reads INV-1003 (linus@example.com\'s), expected it invisible');

  // Step 5: an own row, on a seeded account that has not churned.
  const accounts = rowsOf(expectStatus('step 5: admin reads an active account', await call(base, 'GET', '/api/v1/data/showcase_account?status=active&$top=1', { token: adminToken }), 200));
  if (!accounts[0]) throw new StepFailure('step 5: no active showcase_account to invoice');
  const own = expectStatus('step 5: member creates an own invoice', await call(base, 'POST', '/api/v1/data/showcase_invoice', {
    token: memberToken, body: { name: `QA-${stamp()}`, account: accounts[0].id, owner: email },
  }), 200, 201);
  const ownInvoiceId = recordOf(own)?.id;
  expectStatus('step 5: member re-reads the own invoice', await call(base, 'GET', `/api/v1/data/showcase_invoice/${encodeURIComponent(ownInvoiceId)}`, { token: memberToken }), 200);

  // `--task`: one showcase_task assigned to the member, due in three days, for
  // records-forms.calendar-interactions steps[2] (task_own_rows selects
  // `assignee == current_user.email`, examples/app-showcase/src/security/permission-sets.ts).
  // The admin creates it, as the step's later reassignment is the admin's too.
  let assignedTask = null;
  if (flags.task) {
    const projects = rowsOf(expectStatus('task: admin reads a project', await call(base, 'GET', '/api/v1/data/showcase_project?$top=1', { token: adminToken }), 200));
    if (!projects[0]) throw new StepFailure('task: no showcase_project to file the task under (project is required)');
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const task = expectStatus('task: admin creates a task assigned to the member', await call(base, 'POST', '/api/v1/data/showcase_task', {
      token: adminToken, body: { title: `QA calendar task ${stamp()}`, project: projects[0].id, assignee: email, due_date: due },
    }), 200, 201);
    const taskId = recordOf(task)?.id;
    expectStatus('task: the member reads its assigned task', await call(base, 'GET', `/api/v1/data/showcase_task/${encodeURIComponent(taskId)}`, { token: memberToken }), 200);
    assignedTask = { object: 'showcase_task', id: taskId, due_date: due };
  }

  return {
    fixture: 'contributor-member',
    replays: 'docs/qa/platform-checklist/areas/search.json fixtures.qa-contributor-bound-member',
    baseUrl: base,
    persona: { email, password, userId, bearer: memberToken },
    organizationId,
    invitationId,
    positionRowId,
    invisibleRow: { object: 'showcase_invoice', name: 'INV-1003', id: inv1003.id },
    ownInvoiceId,
    assignedTask,
    teardown: 'discard the run\'s own file DB, or delete the sys_user_position row and the own invoice (the recipe\'s teardown)',
  };
}

// ── walled-boot ──────────────────────────────────────────────────────────────

function newRunDir(flags, prefix) {
  if (flags.dir) {
    const dir = resolve(String(flags.dir));
    if (existsSync(dir) && readdirSync(dir).length) throw new Refusal(`--dir ${dir} is not empty`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeState(dir, state) {
  writeFileSync(join(dir, 'fixture.json'), `${JSON.stringify(state, null, 2)}\n`);
}

async function waitForHealth(base, child, logFile, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let exited = null;
  child.once('exit', (code, signal) => { exited = { code, signal }; });
  while (Date.now() < deadline) {
    if (exited) {
      const head = readFileSync(logFile, 'utf8').split('\n').slice(0, 20).join('\n');
      throw new StepFailure(`the boot exited (${exited.code ?? exited.signal}) before it answered health. First log lines:\n${head}`);
    }
    try {
      const res = await fetch(`${base}/api/v1/health`);
      if (res.status === 200) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new StepFailure(`no health 200 at ${base} within ${budgetMs / 1000}s — read ${logFile}`);
}

async function walledBoot(flags) {
  const posture = String(flags.posture || 'isolated');
  if (!['isolated', 'group'].includes(posture)) throw new Refusal(`--posture must be isolated or group, not "${posture}"`);
  if (!existsSync(join(REPO, 'packages/cli/dist'))) {
    throw new Refusal('packages/cli has no dist: run `pnpm build` first (RUNNER.md, "A cold tree cannot boot the app")');
  }
  const admin = adminOf(flags);
  const port = Number(flags.port || (await freePort()));
  const dir = newRunDir(flags, 'qa-walled-');
  const base = `http://localhost:${port}`;
  const logFile = join(dir, 'boot.log');
  const env = {
    ...process.env,
    OS_PORT: String(port),
    OS_STORAGE_LOCAL_ROOT: join(dir, 'storage'),
    OS_TENANCY_POSTURE: posture,
    OS_PLATFORM_OWNER_EMAIL: admin.email,
    OS_AUTH_MEMBERSHIP_POLICY: String(flags['membership-policy'] || 'invite-only'),
  };
  const argv = ['-C', SHOWCASE, 'exec', 'objectstack', 'dev', '--ui', '--seed-admin', '-p', String(port), '-d', `file:${join(dir, 'data.db')}`];
  log(`booting the showcase walled (${posture}) on :${port}, DB and log under ${dir}`);
  const out = openSync(logFile, 'a');
  const child = spawn('pnpm', argv, { env, detached: true, stdio: ['ignore', out, out] });
  writeState(dir, { kind: 'walled-boot', pids: [child.pid], port, posture, createdAt: new Date().toISOString() });
  child.unref();
  await waitForHealth(base, child, logFile, Number(flags.timeout || 300) * 1000);

  // Health answers before the ready banner is flushed (platform-core.boot-health
  // steps[3]), so the banner is waited for before it is read.
  const bannerBy = Date.now() + 60_000;
  while (!/Server is ready/.test(readFileSync(logFile, 'utf8')) && Date.now() < bannerBy) await new Promise((r) => setTimeout(r, 500));
  const bootLog = readFileSync(logFile, 'utf8');
  if (!/Server is ready/.test(bootLog)) throw new StepFailure(`health answered but no ready banner within 60s — read ${logFile}`);
  if (/DEGRADED/.test(bootLog)) throw new StepFailure(`the boot is DEGRADED, never score a walled clause on it — read ${logFile}`);

  const config = expectStatus('read /api/v1/auth/config', await call(base, 'GET', '/api/v1/auth/config'), 200);
  const features = config.json?.features ?? config.json?.data?.features ?? {};
  if (features.multiOrgEnabled !== true || features.tenancyPosture !== posture || features.degradedTenancy !== false) {
    throw new StepFailure(
      `the boot answers health but /api/v1/auth/config reads multiOrgEnabled ${features.multiOrgEnabled}, tenancyPosture `
      + `${features.tenancyPosture}, degradedTenancy ${features.degradedTenancy}: the wall did not take — read ${logFile}`,
    );
  }
  const operatorToken = await signIn(base, admin.email, admin.password);

  // "Walled personas come from the admin door": Create User joins the new user to
  // the operator's CURRENT organization and refuses an operator with none
  // (400 NO_ACTIVE_ORGANIZATION), so the operator's session gets one made current
  // — the same create + set-active pair packages/qa/dogfood's wall-* suites send.
  // `--no-organization` leaves the operator with none, for a clause about that state.
  let organization = null;
  if (!flags['no-organization']) {
    const slug = String(flags.organization || `qa-walled-${stamp()}`);
    const created = expectStatus(
      'create the operator\'s organization (POST /api/v1/auth/organization/create)',
      await call(base, 'POST', '/api/v1/auth/organization/create', { token: operatorToken, body: { name: slug, slug } }),
      200, 201,
    );
    expectStatus(
      'make it current (POST /api/v1/auth/organization/set-active)',
      await call(base, 'POST', '/api/v1/auth/organization/set-active', { token: operatorToken, body: { organizationSlug: slug } }),
      200,
    );
    const session = expectStatus('read the operator session', await call(base, 'GET', '/api/v1/auth/get-session', { token: operatorToken }), 200);
    const activeId = session.json?.session?.activeOrganizationId;
    const createdId = created.json?.id ?? created.json?.data?.id;
    if (!activeId || (createdId && activeId !== createdId)) {
      throw new StepFailure(`set-active answered 200 but the operator session's activeOrganizationId reads ${activeId}, not ${createdId}`);
    }
    organization = { id: activeId, slug };
  }

  return {
    fixture: 'walled-boot',
    replays: 'docs/qa/platform-checklist/RUNNER.md, "A walled boot is a fixture of its own"',
    baseUrl: base,
    port,
    posture,
    membershipPolicy: env.OS_AUTH_MEMBERSHIP_POLICY,
    operator: admin,
    operatorToken,
    organization,
    pid: child.pid,
    dir,
    log: logFile,
    seeds: (bootLog.match(/Seeds:\s+(.*)/) ?? [])[1]?.trim() ?? 'no Seeds: row',
    next: organization
      ? 'mint walled personas with POST /api/v1/auth/admin/create-user, presenting operatorToken: each joins the organization above as member (RUNNER.md, "Walled personas come from the admin door"); for a second organization, create it and set-active on the same token before the next create'
      : 'the operator holds no current organization (--no-organization): admin/create-user answers 400 NO_ACTIVE_ORGANIZATION until organization/create + set-active (RUNNER.md, "Walled personas come from the admin door")',
    teardown: `node scripts/qa/qa-fixture.mjs teardown --dir ${dir}`,
  };
}

// ── external-database ────────────────────────────────────────────────────────

function pgBinDir() {
  const root = '/usr/lib/postgresql';
  if (!existsSync(root)) return undefined;
  const versions = readdirSync(root).filter((v) => existsSync(join(root, v, 'bin', 'initdb'))).sort((a, b) => Number(b) - Number(a));
  return versions[0] ? join(root, versions[0], 'bin') : undefined;
}

function postgresUser() {
  const passwd = existsSync('/etc/passwd') ? readFileSync('/etc/passwd', 'utf8') : '';
  const line = passwd.split('\n').find((l) => l.startsWith('postgres:'));
  if (!line) return undefined;
  const [, , uid, gid] = line.split(':');
  return { uid: Number(uid), gid: Number(gid) };
}

function runAsPostgres(bin, args, pg, opts = {}) {
  const asPostgres = process.getuid?.() === pg.uid;
  const cmd = asPostgres ? bin : 'runuser';
  const argv = asPostgres ? args : ['-u', 'postgres', '--', bin, ...args];
  const r = spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new StepFailure(`${bin.split('/').pop()} ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 600)}`);
  return r.stdout;
}

function datasourceBody(name, conn) {
  return {
    name,
    driver: 'postgres',
    config: { host: conn.host, port: conn.port, database: conn.database, username: conn.user },
    secret: conn.password,
  };
}

async function externalDatabase(flags) {
  const brought = process.env.OS_TEST_EXTERNAL_DB_URL;
  if (brought) {
    let url;
    try { url = new URL(brought); } catch { throw new Refusal('OS_TEST_EXTERNAL_DB_URL is not a URL: postgres://USER:PASSWORD@HOST:PORT/DATABASE'); }
    if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Refusal(`OS_TEST_EXTERNAL_DB_URL must be a postgres:// URL, not ${url.protocol}`);
    if (!url.username || !url.password) throw new Refusal('OS_TEST_EXTERNAL_DB_URL names no user and password: the fixture is a CREDENTIALED database');
    const conn = {
      host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    };
    if (!conn.database) throw new Refusal('OS_TEST_EXTERNAL_DB_URL names no database');
    log('using the database OS_TEST_EXTERNAL_DB_URL names; nothing is started');
    return {
      fixture: 'external-database', source: 'OS_TEST_EXTERNAL_DB_URL', connection: conn,
      datasourceBody: datasourceBody('qa_ext_pg', conn),
      bind: 'POST /api/v1/datasources with datasourceBody: the password rides in the top-level `secret`, never in `config` (knownGaps[2])',
      teardown: 'none: the database is the runner\'s own',
    };
  }

  const bin = pgBinDir();
  const pg = postgresUser();
  const canRun = bin && pg && (process.getuid?.() === 0 || process.getuid?.() === pg.uid);
  if (!canRun) {
    throw new Refusal(
      'no credentialed external database. Either set OS_TEST_EXTERNAL_DB_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE '
      + '(a database you control; nothing is started, the URL is only read), or run where PostgreSQL is installed under '
      + '/usr/lib/postgresql/VERSION/bin with a `postgres` system user, as root or as that user, so a scratch cluster can be '
      + `provisioned (found: initdb ${bin ? 'yes' : 'no'}, postgres user ${pg ? 'yes' : 'no'}, running as uid ${process.getuid?.()}). `
      + 'Nothing was started.',
    );
  }

  // Every parent of the data directory must be traversable by `postgres`, so the
  // run directory sits under /tmp, never under a session scratchpad (knownGaps[2]).
  const dir = newRunDir(flags, 'qa-pg-');
  chmodSync(dir, 0o755);
  const port = Number(flags.port || (await freePort()));
  const superPassword = freshSecret();
  const conn = { host: '127.0.0.1', port, database: 'qa_ext', user: 'qa_ext', password: freshSecret() };
  const data = join(dir, 'data');
  const pwfile = join(dir, 'superuser.pw');
  writeFileSync(pwfile, `${superPassword}\n`, { mode: 0o600 });
  if (process.getuid?.() === 0) { chownSync(dir, pg.uid, pg.gid); chownSync(pwfile, pg.uid, pg.gid); }
  writeState(dir, { kind: 'external-database', pids: [], pgBin: bin, pgData: data, port, createdAt: new Date().toISOString() });

  log(`initdb (scram-sha-256) into ${data}`);
  runAsPostgres(join(bin, 'initdb'), ['-D', data, '-A', 'scram-sha-256', '-U', 'postgres', `--pwfile=${pwfile}`, '--no-sync'], pg);
  log(`starting PostgreSQL on 127.0.0.1:${port} (TCP only)`);
  runAsPostgres(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-w', '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, 'start'], pg);

  const psql = (sql, db = 'postgres', user = 'postgres', password = superPassword) => {
    const r = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', db, '-c', sql],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: password } });
    if (r.status !== 0) throw new StepFailure(`psql (${user}@${db}) failed: ${(r.stderr || '').slice(0, 400)}`);
    return r.stdout;
  };
  psql(`CREATE ROLE ${conn.user} LOGIN PASSWORD '${conn.password}'`);
  psql(`CREATE DATABASE ${conn.database} OWNER ${conn.user}`);
  // A small owned table, so an introspection leg has something to read.
  psql('CREATE TABLE public.qa_widgets (id integer PRIMARY KEY, name text NOT NULL); '
    + "INSERT INTO public.qa_widgets VALUES (1, 'alpha'), (2, 'beta')", conn.database, conn.user, conn.password);
  // The proof: the password is required, and it is the one printed.
  const refused = spawnSync('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', conn.user, '-d', conn.database, '-w', '-c', 'select 1'],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '' } });
  if (refused.status === 0) throw new StepFailure('the cluster admitted the login role with no password: it is not a credentialed database');
  psql('select count(*) from public.qa_widgets', conn.database, conn.user, conn.password);
  writeFileSync(join(dir, 'connection.json'), `${JSON.stringify(conn, null, 2)}\n`, { mode: 0o600 });

  return {
    fixture: 'external-database',
    replays: 'docs/qa/platform-checklist/areas/integration-system.json integration-system.datasource-credential-refusal-matrix fixtures.knownGaps[2]',
    source: `scratch PostgreSQL (${bin})`,
    connection: conn,
    datasourceBody: datasourceBody('qa_ext_pg', conn),
    bind: 'POST /api/v1/datasources with datasourceBody: the password rides in the top-level `secret`, never in `config`; a failed connect states its cause only in the create response\'s statusReason (knownGaps[2])',
    dir,
    teardown: `node scripts/qa/qa-fixture.mjs teardown --dir ${dir}`,
  };
}

// ── broken-upstream-app ──────────────────────────────────────────────────────

const MCP_SCRIPT = 'scripts/mcp-fixture.mjs';
const CONNECTORS_FILE = 'src/system/connectors/index.ts';
const STDIO_TRANSPORT = "transport: { kind: 'stdio', command: 'node', args: ['./scripts/mcp-fixture.mjs'] },";
const COPY_SKIP = new Set(['node_modules', '.objectstack', 'dist', 'test-results', 'playwright-report', '.turbo']);

function brokenUpstreamApp(flags) {
  const variant = String(flags.variant || 'missing-script');
  if (!['missing-script', 'config-fault'].includes(variant)) throw new Refusal(`--variant must be missing-script or config-fault, not "${variant}"`);
  if (!existsSync(join(SHOWCASE, 'node_modules'))) throw new Refusal('examples/app-showcase has no node_modules: run `pnpm install` first');
  const dir = newRunDir(flags, 'qa-broken-upstream-');
  const app = join(dir, 'app');
  log(`copying examples/app-showcase to ${app} (no node_modules, no build output)`);
  cpSync(SHOWCASE, app, {
    recursive: true,
    filter: (src) => !COPY_SKIP.has(src.slice(SHOWCASE.length + 1).split('/')[0]) && !src.endsWith('/e2e/.auth'),
  });
  // The copy resolves its workspace dependencies through the tree's own install,
  // and its tsconfig `paths` (written relative to examples/app-showcase) through
  // the tree's own packages.
  symlinkSync(join(SHOWCASE, 'node_modules'), join(app, 'node_modules'), 'dir');
  const tsconfig = join(app, 'tsconfig.json');
  writeFileSync(tsconfig, readFileSync(tsconfig, 'utf8').replaceAll('"../../', `"${REPO}/`));

  let undo;
  if (variant === 'missing-script') {
    renameSync(join(app, MCP_SCRIPT), join(dir, 'mcp-fixture.mjs.parked'));
    undo = `node scripts/qa/qa-fixture.mjs restore-upstream --dir ${dir}`;
  } else {
    const file = join(app, CONNECTORS_FILE);
    const src = readFileSync(file, 'utf8');
    if (src.split(STDIO_TRANSPORT).length !== 2) {
      throw new StepFailure(`config-fault: ${CONNECTORS_FILE} no longer carries the stdio transport line this variant rewrites; re-read DevToolsMcpConnector`);
    }
    writeFileSync(file, src.replace(STDIO_TRANSPORT, "transport: { kind: 'carrier_pigeon', command: 'node', args: ['./scripts/mcp-fixture.mjs'] },"));
    undo = 'none: the config-fault twin is refused at boot by design; prepare a missing-script copy for the recovery leg';
  }
  if (variant === 'missing-script' && existsSync(join(app, MCP_SCRIPT))) throw new StepFailure('missing-script: the fixture script is still in the copy');
  const port = Number(flags.port || 0) || undefined;
  writeState(dir, { kind: 'broken-upstream-app', pids: [], variant, createdAt: new Date().toISOString() });
  const portArg = port ? String(port) : 'PORT';
  return {
    fixture: 'broken-upstream-app',
    replays: 'docs/qa/platform-checklist/areas/integration-system.json integration-system.connector-degraded-recovery fixtures.requires',
    variant,
    app,
    // --log-level info: the retry-interval line steps[3] times is info-level.
    boot: `cd ${app} && OS_PORT=${portArg} pnpm exec objectstack dev --ui --seed-admin --log-level info -p ${portArg} -d file:${join(dir, 'data.db')}`,
    restore: undo,
    dir,
    teardown: `node scripts/qa/qa-fixture.mjs teardown --dir ${dir} (stop the boot you started first)`,
  };
}

function restoreUpstream(flags) {
  if (!flags.dir) throw new Refusal('restore-upstream needs --dir, the directory broken-upstream-app printed');
  const dir = resolve(String(flags.dir));
  const state = readState(dir);
  if (state.kind !== 'broken-upstream-app' || state.variant !== 'missing-script') {
    throw new Refusal(`${dir} holds a ${state.kind}${state.variant ? ` (${state.variant})` : ''} fixture, not a missing-script broken-upstream app`);
  }
  const parked = join(dir, 'mcp-fixture.mjs.parked');
  if (!existsSync(parked)) throw new Refusal(`${parked} is gone: the upstream was already restored, nothing to do`);
  renameSync(parked, join(dir, 'app', MCP_SCRIPT));
  return { fixture: 'broken-upstream-app', restored: join(dir, 'app', MCP_SCRIPT), dir };
}

// ── teardown ─────────────────────────────────────────────────────────────────

function readState(dir) {
  const file = join(dir, 'fixture.json');
  if (!existsSync(file)) throw new Refusal(`${dir} holds no fixture.json: not a directory this script provisioned, nothing was touched`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function teardown(flags) {
  if (!flags.dir) throw new Refusal('teardown needs --dir, the directory the fixture printed');
  const dir = resolve(String(flags.dir));
  const state = readState(dir);
  const stopped = [];
  for (const pid of state.pids ?? []) {
    if (!alive(pid)) continue;
    try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
    for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 500));
    if (alive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); } }
    stopped.push(pid);
  }
  if (state.kind === 'external-database' && existsSync(join(state.pgData, 'postmaster.pid'))) {
    const pg = postgresUser();
    runAsPostgres(join(state.pgBin, 'pg_ctl'), ['-D', state.pgData, '-m', 'fast', '-w', 'stop'], pg);
    stopped.push('postgres');
  }
  if (statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true });
  return { fixture: state.kind, stopped, removed: dir };
}

// ── dispatch ─────────────────────────────────────────────────────────────────

const COMMANDS = {
  'contributor-member': contributorMember,
  'walled-boot': walledBoot,
  'external-database': externalDatabase,
  'broken-upstream-app': brokenUpstreamApp,
  'restore-upstream': restoreUpstream,
  teardown,
};

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const run = COMMANDS[command];
  if (!run) throw new Refusal(`unknown fixture "${command ?? ''}": one of ${Object.keys(COMMANDS).join(', ')}`);
  const result = await run(flags);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err) => {
  if (err instanceof Refusal) {
    log(`REFUSED — ${err.message}`);
    process.exit(2);
  }
  log(`FAILED — ${err instanceof StepFailure ? err.message : err.stack}`);
  process.exit(1);
});
