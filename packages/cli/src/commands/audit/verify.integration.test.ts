// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os audit verify` (ADR-0154 D9) end to end: the real command, spawned from
 * its source entry over a project whose ledger object declares
 * `lifecycle.seal` and archives to a declared `archive` datasource.
 *
 * A child process seals the ledger with plugin-audit's own sealer, composed
 * with the crypto provider `os serve` would choose (the local data key the
 * spawned runs share), and the real Archiver then moves one sealed row to the
 * archive. The command opens the seeds and the signing key itself, through
 * `oneShotCrypto`:
 *
 *   1. untouched, the ledger verifies (exit 0), the archived row read
 *      unmodified, and the trusted key's fingerprint is printed;
 *   2. a row edited and a row deleted through the database, below every hook,
 *      read `modified` and `missing`, their untouched sibling `unmodified`, and
 *      the run exits 1;
 *   3. a usage error, a declared archive this boot cannot reach, and a run
 *      with no data key to open the stored checkpoints, exit 2 with no verdict;
 *   4. a project that seals nothing exits 0 and says so.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 480_000;
const RUN_BUDGET_MS = 120_000;
const LEDGER = 'os31908_ledger';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/** This process's environment for a child, minus the families `test/helpers/serve-process.ts` strips. */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  const unset: Record<string, undefined> = {};
  for (const key of OVERRIDING_ENV) unset[key] = undefined;
  return {
    ...env,
    ...unset,
    // One fixed data key for the sealing child and every command run: the
    // seeds and the signing key's private half are sealed and opened under it.
    OS_SECRET_KEY: '0e2e'.repeat(16),
    OS_TELEMETRY_DB: '0',
    NO_COLOR: '1',
    ...overrides,
  };
}

/**
 * The sealing child: the project's stack, the platform objects and
 * plugin-audit composed with the local data key's provider. It writes rows of
 * a settled window (two in an organization's chain, one in the deployment's)
 * and one two days old, seals them with the plugin's own sealer, and then runs
 * the real lifecycle sweep, whose Archiver moves the two-day-old row to the
 * `archive` datasource (`archive.after: 1d`).
 */
const SEAL_CHILD = `
const rt = await import('@objectstack/runtime');
const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
const { AuditPlugin } = await import('@objectstack/plugin-audit');
const { LocalCryptoProvider } = await import('@objectstack/service-settings');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await kernel.use(new PlatformObjectsPlugin());
const cryptoProvider = new LocalCryptoProvider({ mode: 'production', env: { ...process.env, OS_CRYPTO_AUTOKEY: undefined } });
const audit = new AuditPlugin({ cryptoProvider });
await kernel.use(audit);
await runtime.start();
const ql = kernel.getService('objectql');
if (!ql.getDriverByName('archive')) {
  // The host registers the archive driver under the datasource's name, as the
  // datasource-connection service does for a connected declaration.
  const { SqlDriver } = await import('@objectstack/driver-sql');
  const cold = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_ARCHIVE }, useNullAsDefault: true });
  Object.defineProperty(cold, 'name', { value: 'archive' });
  await cold.connect();
  ql.registerDriver(cold);
}
await audit.sealer.stop(); // the passes run here, not on the loop's clock
const H = 3600000;
const settled = Math.floor(Date.now() / H) * H - 3 * H;
const iso = (ms) => new Date(ms).toISOString();
const k = ql.getDriverForObject(process.env.LEDGER).knex;
await k(process.env.LEDGER).insert([
  { id: 'v1', created_at: iso(settled + 60000), tenant_id: 'org_a', action: 'update', payload: '{"from":1}' },
  { id: 'v2', created_at: iso(settled + 120000), tenant_id: 'org_a', action: 'delete', payload: 'gone' },
  { id: 'v3', created_at: iso(settled + 150000), tenant_id: 'org_a', action: 'update', payload: 'kept' },
  { id: 'v4', created_at: iso(settled + 180000), tenant_id: null, action: 'config', payload: 'x' },
  { id: 'old', created_at: iso(Date.now() - 2 * 24 * H), tenant_id: 'org_a', action: 'update', payload: 'archived' },
]);
const checkpoints = await audit.sealer.runPass();
const report = await kernel.getService('lifecycle').sweep();
const entry = report.swept.find((s) => s.object === process.env.LEDGER);
await kernel.shutdown();
process.stderr.write('[fixture] sealed ' + JSON.stringify({ checkpoints, archived: entry ? entry.archived : null }) + '\\n');
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function writeArtifact(project: string, datasources: unknown[], objects: unknown[]): void {
  mkdirSync(join(project, 'dist'), { recursive: true });
  writeFileSync(
    join(project, 'dist', 'objectstack.json'),
    JSON.stringify({ manifest: { id: 'com.example.os31908', name: 'Sealed ledger', version: '0.0.0', type: 'app' }, datasources, objects }),
  );
}

const sealedObject = {
  name: LEDGER,
  label: 'Sealed ledger',
  systemFields: false,
  fields: {
    id: { type: 'text' },
    created_at: { type: 'datetime' },
    tenant_id: { type: 'text' },
    action: { type: 'text' },
    payload: { type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '1d' }, archive: { after: '1d', to: 'archive' }, seal: { valueFields: ['payload'] } },
};

function seal(project: string, db: string, archive: string): { checkpoints: number; archived: number | null } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SEAL_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json'), FIXTURE_PROJECT: project, FIXTURE_DB: db, FIXTURE_ARCHIVE: archive, LEDGER }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  const line = String(r.stderr).split('\n').find((l) => l.startsWith('[fixture] sealed '));
  if (r.status !== 0 || !line) throw new Error(`the sealing child did not run (status ${r.status})\n${String(r.stderr).slice(-3000)}`);
  return JSON.parse(line.slice('[fixture] sealed '.length));
}

/** One `os audit verify <extra…> --database-url file:<db>` run, in `project`. */
function verify(project: string, db: string, extra: string[], env: Record<string, string | undefined> = {}): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [CLI, 'audit', 'verify', ...extra, '--database-url', `file:${db}`],
      { cwd: project, env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json'), ...env }), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os audit verify did not finish within ${RUN_BUDGET_MS}ms`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}

let dir: string;
let mainDb: string;
let archiveDb: string;
let sealed: { checkpoints: number; archived: number | null };
let archivedIds: string[];
const runs: Record<'clean' | 'cleanHuman' | 'tampered' | 'badDate' | 'reversed' | 'noKey' | 'unreachable' | 'nothing', Run> = {} as never;
const dirs: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-31908-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'data'), { recursive: true });
  mainDb = join(dir, 'data', 'main.db');
  archiveDb = join(dir, 'data', 'archive.db');
  writeArtifact(dir, [{ name: 'archive', driver: 'sqlite', config: { filename: archiveDb }, autoConnect: true }], [sealedObject]);

  sealed = seal(dir, mainDb, archiveDb);
  const cold = new Database(archiveDb, { readonly: true });
  try {
    archivedIds = (cold.prepare(`SELECT id FROM ${LEDGER} ORDER BY id`).all() as Array<{ id: string }>).map((r) => r.id);
  } finally {
    cold.close();
  }

  runs.clean = await verify(dir, mainDb, ['--json']);
  runs.cleanHuman = await verify(dir, mainDb, []);
  runs.badDate = await verify(dir, mainDb, ['--from', 'yesterday', '--json']);
  runs.reversed = await verify(dir, mainDb, ['--from', '2026-11-02', '--to', '2026-11-01', '--json']);

  // No data key at all: no `OS_SECRET_KEY`, and a home with no key file.
  const keyless = mkdtempSync(join(tmpdir(), 'os-31908-home-'));
  dirs.push(keyless);
  runs.noKey = await verify(dir, mainDb, ['--json'], { OS_SECRET_KEY: undefined, HOME: keyless });

  // A database-level actor, below every hook: one row edited, one deleted.
  const hot = new Database(mainDb);
  try {
    hot.prepare(`UPDATE ${LEDGER} SET payload = ? WHERE id = 'v1'`).run('{"from":2}');
    hot.prepare(`DELETE FROM ${LEDGER} WHERE id = 'v2'`).run();
  } finally {
    hot.close();
  }
  runs.tampered = await verify(dir, mainDb, ['--json']);

  // A declared archive this boot cannot reach: a Postgres server on a port
  // nothing listens on (an unopenable SQLite file steps down to in-memory
  // under the source entry's development posture instead of failing).
  const unreachable = mkdtempSync(join(tmpdir(), 'os-31908-unreachable-'));
  dirs.push(unreachable);
  writeArtifact(unreachable, [
    { name: 'archive', driver: 'postgres', config: { host: '127.0.0.1', port: 1, database: 'archive', username: 'os31908' }, autoConnect: true },
  ], [sealedObject]);
  runs.unreachable = await verify(unreachable, join(unreachable, 'main.db'), ['--json']);

  // A project that seals nothing.
  const plain = mkdtempSync(join(tmpdir(), 'os-31908-plain-'));
  dirs.push(plain);
  writeArtifact(plain, [], [{ name: 'os31908_plain', fields: { name: { type: 'text' } } }]);
  runs.nothing = await verify(plain, join(plain, 'main.db'), ['--json']);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const doc = (run: Run): any => JSON.parse(run.stdout);
const verdicts = (run: Run): Record<string, string> =>
  Object.fromEntries(doc(run).report.rows.map((r: { row: string; verdict: string; sealed: boolean }) => [r.row, r.sealed ? r.verdict : `${r.verdict}!`]));

describe('os audit verify over a sealed ledger and its archive (ADR-0154 D9)', () => {
  it('0. the fixture: the plugin sealed two chains of the settled window and one of the old row, and the Archiver moved the old row', () => {
    expect(sealed).toEqual({ checkpoints: 3, archived: 1 });
    expect(archivedIds).toEqual(['old']);
  });

  it('1. the untouched ledger verifies, the archived row read unmodified, under the one key it trusts: exit 0', () => {
    const run = runs.clean;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    const { report } = doc(run);
    expect(report).toMatchObject({ ok: true, sealed: true, objects: [LEDGER], faults: [], rows: [] });
    expect(report.totals.unmodified).toBe(5);
    expect(report.keys.trusted).toHaveLength(1);
    expect(report.keys.trusted[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(report.keys.untrusted).toEqual([]);
  });

  it('1b. the human report prints the trusted fingerprint to publish, and says the ledger verifies', () => {
    const run = runs.cleanHuman;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(run.stdout).toContain(doc(runs.clean).report.keys.trusted[0]);
    expect(run.stdout).toContain('The sealed ledger verifies');
  });

  it('2. an edited row reads modified, a deleted one missing, their untouched sibling unmodified: exit 1', () => {
    const run = runs.tampered;
    expect(run.code, run.stderr.slice(-2000)).toBe(1);
    expect(verdicts(run)).toEqual({ v1: 'modified', v2: 'missing' });
    const orgA = doc(run).report.chains.find((c: { chain: string }) => c.chain === 'org:org_a');
    expect(orgA.counts).toMatchObject({ unmodified: 2, modified: 1, missing: 1 });
    expect(doc(run).report.ok).toBe(false);
  });

  it('3. a usage error exits 2 before anything boots', () => {
    expect(runs.badDate.code).toBe(2);
    expect(doc(runs.badDate)).toMatchObject({ error: 'usage' });
    expect(doc(runs.badDate).message).toMatch(/--from 'yesterday' is not an ISO-8601/);
    expect(runs.reversed.code).toBe(2);
    expect(doc(runs.reversed).message).toMatch(/must be before --to/);
  });

  it('3b. a declared archive this boot cannot reach exits 2 with no verdict: every archived row would read missing', () => {
    const run = runs.unreachable;
    expect(run.code, run.stderr.slice(-2000)).toBe(2);
    expect(doc(run)).toMatchObject({ error: 'archive_not_connected' });
    expect(doc(run).message).toContain("Archive datasource 'archive' (os31908_ledger) is not connected on this boot");
  });

  it('3c. a run with no data key exits 2 with no verdict: the checkpoints it would judge cannot be opened', () => {
    const run = runs.noKey;
    expect(run.code, run.stderr.slice(-2000)).toBe(2);
    expect(doc(run)).toMatchObject({ error: 'crypto_provider_refused' });
    expect(doc(run).message).toMatch(/^The ledger holds checkpoints, and this run cannot open their seeds or signing keys/);
  });

  it('4. a project that seals nothing exits 0 and says so', () => {
    const run = runs.nothing;
    expect(run.code, run.stderr.slice(-2000)).toBe(0);
    expect(doc(run).report).toMatchObject({ ok: true, sealed: false, objects: [] });
  });
});
