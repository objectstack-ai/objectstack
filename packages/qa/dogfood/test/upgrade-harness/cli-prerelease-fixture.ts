// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26624] The 18.0 PRE-RELEASE database `cli.organization-ownership-ceremony`
// acceptance[5] upgrades (docs/qa/platform-checklist/areas/cli.json, recipe
// `cli-18-prerelease-db`): one an 18.0.0-next.* release's own CLI created and
// served. ⛔ Not a test: nothing here runs in the dogfood suite.
//
//   tsx cli-prerelease-fixture.ts restore  --to /tmp/RUN/n5.db
//   tsx cli-prerelease-fixture.ts generate [--checkout DIR] [--ref REF] [--out DIR]
//
// `restore` is what a checklist run replays: it loads the committed text dump
// (`fixture-18.0.0-next.5/`) into two NEW SQLite files, the primary and the
// telemetry sibling `os dev` keeps beside a file primary (`n5.db` and
// `n5.telemetry.db`, packages/cli/src/utils/telemetry-datasource.ts). No build.
//
// `generate` remakes that dump, and is the only way it is made:
//
// 1. Resolves `--ref` (default `@objectstack/cli@18.0.0-next.5`) to its commit
//    and gets a BUILT checkout of it — `--checkout DIR`, proved to be that
//    commit with a clean tracked tree, or a temporary `git worktree` it installs
//    and builds (`turbo run build --filter=@objectstack/example-showcase^...`).
//    ⛔ Never an npm install of the published CLI: it resolves 18.1+
//    dependencies, and the database it makes is born 18.1 (QA run #25812).
// 2. Boots THAT checkout's `os dev --seed-admin` from its showcase directory
//    over a fresh file database, mail on SMTP at a closed local port with
//    queued delivery, and `OS_EMAIL_RETRIES=10`, so every queued mail fails
//    fast and waits in `sys_job_queue` for its next attempt.
// 3. Uses it through the release's own HTTP doors (`useTheRelease` below),
//    each answer checked, then stops the boot (SIGTERM to its process group).
// 4. Takes the census acceptance[5] reads, REFUSES a database missing any of
//    it, and writes `database.sql`, `telemetry.sql` and `manifest.json`.
//
// ⛔ Not byte-reproducible: ids, timestamps, tokens and hashes are minted per
// run. What is reproducible is the census, and the provenance `manifest.json`
// records (`ref`, `sha`).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { dumpSqliteToSql, loadSqlIntoSqlite } from './sqlite-text-dump.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const DEFAULT_REF = '@objectstack/cli@18.0.0-next.5';
const FIXTURE = resolve(HERE, 'fixture-18.0.0-next.5');

/** The people the database holds; a run signs in with these after the upgrade. */
export const PRERELEASE_PEOPLE = {
  admin: { email: 'admin@objectos.ai', password: 'admin123' },
  memberA: { email: 'n5.member-a@verify.test', password: 'Fixture!Next5-A1' },
  memberB: { email: 'n5.member-b@verify.test', password: 'Fixture!Next5-B1' },
  invitee: { email: 'n5.invitee@verify.test' },
} as const;

const TASKS = { admin: 'Fixture admin task (18.0.0-next.5)', member: 'Fixture member task (18.0.0-next.5)' };

function fail(message: string, code = 1): never {
  console.error(`cli-prerelease-fixture: ${message}`);
  process.exit(code);
}

/** The two files a fixture directory restores into: the primary, then its telemetry sibling. */
function siblingOf(primary: string): string {
  return /\.db$/i.test(primary) ? primary.replace(/\.db$/i, '.telemetry.db') : `${primary}.telemetry.db`;
}

function restore(to: string, from: string): void {
  if (!existsSync(join(from, 'database.sql'))) fail(`${from} holds no database.sql`, 2);
  for (const file of [to, siblingOf(to)]) if (existsSync(file)) fail(`${file} exists; the restore writes NEW files only, so a run never upgrades the original`, 2);
  mkdirSync(dirname(to), { recursive: true });
  loadSqlIntoSqlite(readFileSync(join(from, 'database.sql'), 'utf8'), to);
  loadSqlIntoSqlite(readFileSync(join(from, 'telemetry.sql'), 'utf8'), siblingOf(to));
  const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'));
  console.log(`cli-prerelease-fixture: restored ${to} and ${siblingOf(to)} — born under ${manifest.ref} (${manifest.sha.slice(0, 12)})`);
}

/** A port nothing listens on once this resolves. */
function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

const git = (args: string[], cwd = REPO_ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function run(cmd: string, args: string[], cwd: string): void {
  console.error(`$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` exited ${r.status ?? r.signal}`);
}

interface Door {
  call(method: string, path: string, body?: unknown, token?: string): Promise<any>;
}

function doorsOf(base: string): Door {
  return {
    async call(method, path, body, token) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: base };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      if (res.status !== 200 && res.status !== 201) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 400)}`);
      console.error(`  ${method} ${path} → ${res.status}`);
      return text ? JSON.parse(text) : null;
    },
  };
}

/** Use a fresh pre-release showcase the way an operator and two members would. */
async function useTheRelease(door: Door, smtpPort: number): Promise<void> {
  const { admin, memberA, memberB, invitee } = PRERELEASE_PEOPLE;
  const adminTok = (await door.call('POST', '/api/v1/auth/sign-in/email', admin)).token;
  const org = (await door.call('GET', '/api/v1/auth/organization/list', undefined, adminTok))[0];
  await door.call('POST', '/api/v1/auth/organization/set-active', { organizationId: org.id }, adminTok);

  // The global `mail` settings, written twice: SMTP at a port nothing listens
  // on, with queued delivery, so every mail below waits in sys_job_queue.
  await door.call('PUT', '/api/settings/mail', {
    provider: 'smtp', smtp_host: '127.0.0.1', smtp_port: smtpPort, smtp_secure: false,
    from_email: 'qa-fixture@example.test', queue_delivery: true,
  }, adminTok);
  await door.call('PUT', '/api/settings/mail', { from_name: 'QA fixture 18.0.0-next.5' }, adminTok);

  // A member invited and signed up; a second made by admin create-user.
  const invitation = await door.call('POST', '/api/v1/auth/organization/invite-member', { email: memberA.email, role: 'member', organizationId: org.id }, adminTok);
  const aTok = (await door.call('POST', '/api/v1/auth/sign-up/email', { ...memberA, name: 'Member A' })).token;
  await door.call('POST', '/api/v1/auth/organization/accept-invitation', { invitationId: invitation.id }, aTok);
  await door.call('POST', '/api/v1/auth/admin/create-user', { ...memberB, name: 'Member B', role: 'user' }, adminTok);

  // Identity mail: a password reset and a verification resend. Then a pending
  // organization invitation, whose mail is not identity mail.
  await door.call('POST', '/api/v1/auth/request-password-reset', { email: memberB.email, redirectTo: '/reset-password' });
  await door.call('POST', '/api/v1/auth/send-verification-email', { email: memberA.email, callbackURL: '/' });
  await door.call('POST', '/api/v1/auth/organization/invite-member', { email: invitee.email, role: 'member', organizationId: org.id }, adminTok);

  // The declared webhook's mirror row, activated the way the release's Setup does.
  const hook = (await door.call('GET', '/api/v1/data/sys_webhook?name=showcase_task_changed', undefined, adminTok)).records[0];
  await door.call('PATCH', `/api/v1/data/sys_webhook/${hook.id}`, { active: true }, adminTok);

  // An admin task and a member task.
  const project = (await door.call('GET', '/api/v1/data/showcase_project', undefined, adminTok)).records[0];
  await door.call('POST', '/api/v1/data/showcase_task', { title: TASKS.admin, project: project.id }, adminTok);
  await door.call('POST', '/api/v1/auth/organization/set-active', { organizationId: org.id }, aTok);
  await door.call('POST', '/api/v1/data/showcase_task', { title: TASKS.member, project: project.id }, aTok);
}

/** What acceptance[5] reads, taken off the stopped database; throws on a gap. */
function census(file: string, telemetry: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const all = (sql: string) => db.prepare(sql).all() as Array<Record<string, any>>;
    const tables: Record<string, number> = {};
    for (const { name } of all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
      tables[name] = Number(all(`SELECT count(*) AS n FROM "${name}"`)[0].n);
    }
    const mail = all('SELECT id, related_object, status, subject FROM sys_email ORDER BY id');
    const jobs = all("SELECT id, queue, status, attempts FROM sys_job_queue WHERE queue LIKE 'email.%' ORDER BY id");
    const globalAudit = all("SELECT id, namespace FROM sys_setting_audit WHERE scope = 'global' ORDER BY id");
    const webhook = all("SELECT id, organization_id, active FROM sys_webhook WHERE name = 'showcase_task_changed'");
    const tasks = all(`SELECT id, title FROM showcase_task WHERE title IN ('${TASKS.admin}', '${TASKS.member}')`);
    const ownershipMarker = all("SELECT id FROM sys_migration WHERE id = 'adr-0131-organization-ownership'");

    const gaps: string[] = [];
    if (!mail.some((m) => m.related_object === 'sys_user')) gaps.push('no identity mail (related_object sys_user) in sys_email');
    if (!mail.some((m) => m.related_object === 'sys_invitation')) gaps.push('no organization-invitation mail in sys_email');
    if (!jobs.some((j) => j.queue === 'email.send.async' && (j.status === 'pending' || j.status === 'running'))) gaps.push('no pending or running email.send.async job');
    if (!globalAudit.some((a) => a.namespace === 'mail')) gaps.push("no global sys_setting_audit row for 'mail'");
    if (!webhook.some((w) => w.active === 1 && w.organization_id === null)) gaps.push('the declared webhook mirror row is not active');
    if (tasks.length !== 2) gaps.push(`expected the admin and member tasks, found ${tasks.length}`);
    if (ownershipMarker.length !== 0) gaps.push('the database already carries an organization-ownership marker: not a pre-release database');
    if (!existsSync(telemetry)) gaps.push(`no telemetry sibling at ${telemetry}`);
    if (gaps.length) throw new Error(`census refused the database:\n  - ${gaps.join('\n  - ')}`);
    return { tables, mail, jobs, globalAudit, webhook };
  } finally {
    db.close();
  }
}

async function generate(ref: string, checkoutArg: string | undefined, out: string): Promise<void> {
  let sha: string;
  try {
    sha = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    fail(`${ref} does not resolve to a commit here (git fetch --depth=1 origin 'refs/tags/${ref}:refs/tags/${ref}')`, 2);
  }
  let checkout: string;
  let temporary = false;
  if (checkoutArg) {
    checkout = resolve(checkoutArg);
    const head = git(['rev-parse', 'HEAD'], checkout);
    if (head !== sha) fail(`${checkout} is at ${head.slice(0, 12)}, not ${ref} (${sha.slice(0, 12)})`, 2);
    const dirty = git(['status', '--porcelain', '--untracked-files=no'], checkout);
    if (dirty) fail(`${checkout} has tracked changes:\n${dirty}`, 2);
    if (!existsSync(join(checkout, 'packages/cli/dist'))) fail(`${checkout} is not built (no packages/cli/dist)`, 2);
  } else {
    checkout = mkdtempSync(join(tmpdir(), 'cli-prerelease-ref-'));
    temporary = true;
    run('git', ['worktree', 'add', '--detach', checkout, sha], REPO_ROOT);
    run('pnpm', ['install', '--frozen-lockfile'], checkout);
    run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@objectstack/example-showcase^...', '--concurrency=2'], checkout);
  }

  const work = mkdtempSync(join(tmpdir(), 'cli-prerelease-run-'));
  const db = join(work, 'n5.db');
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const [port, smtpPort] = [await freePort(), await freePort()];
    const base = `http://localhost:${port}`;
    child = spawn(process.execPath, [join(checkout, 'packages/cli/bin/run.js'), 'dev', '--seed-admin', '-p', String(port), '-d', `file:${db}`], {
      cwd: join(checkout, 'examples/app-showcase'),
      env: { ...process.env, NO_COLOR: '1', OS_CLOUD_URL: 'off', OS_EMAIL_RETRIES: '10' },
      detached: true,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    let healthy = false;
    for (let i = 0; i < 120 && !healthy; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      healthy = await fetch(`${base}/api/v1/health`).then((r) => r.ok, () => false);
    }
    if (!healthy) throw new Error(`os dev never answered ${base}/api/v1/health`);
    console.error(`cli-prerelease-fixture: ${ref} os dev serving on ${base}`);
    await useTheRelease(doorsOf(base), smtpPort);
  } finally {
    if (child?.pid) {
      process.kill(-child.pid, 'SIGTERM');
      const exited = await new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), 30_000);
        child!.once('exit', () => (clearTimeout(t), r(true)));
      });
      if (!exited) {
        console.error('cli-prerelease-fixture: os dev outlived SIGTERM by 30 s; SIGKILL');
        process.kill(-child.pid, 'SIGKILL');
      }
    }
    if (temporary) run('git', ['worktree', 'remove', '--force', checkout], REPO_ROOT);
  }

  const taken = census(db, siblingOf(db));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'database.sql'), dumpSqliteToSql(db));
  writeFileSync(join(out, 'telemetry.sql'), dumpSqliteToSql(siblingOf(db)));
  const manifest = {
    ref, sha, generatedAt: new Date().toISOString(),
    generator: 'packages/qa/dogfood/test/upgrade-harness/cli-prerelease-fixture.ts generate',
    people: PRERELEASE_PEOPLE,
    ...taken,
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(work, { recursive: true, force: true });
  console.log(`cli-prerelease-fixture: wrote ${out} from ${ref} (${sha.slice(0, 12)}): ${taken.mail.length} mails, ${taken.jobs.length} mail jobs (${taken.jobs.map((j) => j.status).join(', ')}), ${taken.globalAudit.length} global setting-audit rows`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { to: { type: 'string' }, ref: { type: 'string' }, checkout: { type: 'string' }, out: { type: 'string' } },
});
const mode = positionals[0];
if (mode === 'restore') {
  if (!values.to) fail('restore needs --to FILE (a new SQLite file; its telemetry sibling is written beside it)', 2);
  restore(resolve(values.to), FIXTURE);
} else if (mode === 'generate') {
  await generate(values.ref ?? DEFAULT_REF, values.checkout, resolve(values.out ?? FIXTURE));
  process.exit(0);
} else {
  fail('usage: cli-prerelease-fixture.ts restore --to FILE | generate [--checkout DIR] [--ref REF] [--out DIR]', 2);
}
