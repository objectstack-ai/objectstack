// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1] `os audit verify` (ADR-0154 D9) boots a stack that declares
 * `queues` and `assignmentRules`, and judges its sealed ledger.
 *
 * The engine refuses, at `kernel:ready`, a stack declaring either key with no
 * `ownership-queue` service registered (`ObjectQLPlugin`). `os audit verify`
 * boots through `bootSchemaStack`, with a data-migration plugin set and the
 * crypto provider's plugins: no sharing provider. Before that boot composed
 * the service itself (`../../utils/migrate-ownership-queue.ts`), the command
 * exited 2 (`boot_failed`) on such an app before it read a single row, so an
 * app that routes records through queues could not verify its audit ledger.
 *
 * ## The fixture
 *
 * The real command, spawned from its source entry, over a project whose
 * artifact declares one sealed ledger object, one queue and one assignment
 * rule routing a second object into it. A child process writes three ledger
 * rows of a settled window and seals them with plugin-audit's own sealer,
 * under the local data key the command later opens the checkpoints with. The
 * child stands for whatever served the ledger: it boots from a copy of the
 * artifact without the two ownership keys, because the subject here is the
 * command's boot, never the sealer's.
 *
 * Pinned: the command boots, reads the ledger and gives its normal verdict
 * (every sealed row `unmodified`, exit 0) — never `boot_failed`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 300_000;
const RUN_BUDGET_MS = 120_000;
const LEDGER = 'os34143_ledger';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/** This process's environment for a child, minus the families `test/helpers/serve-process.ts` strips. */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  for (const key of OVERRIDING_ENV) env[key] = undefined;
  return {
    ...env,
    // One fixed data key for the sealing child and the command: the seeds and
    // the signing key's private half are sealed and opened under it.
    OS_SECRET_KEY: '3414'.repeat(16),
    OS_TELEMETRY_DB: '0',
    NO_COLOR: '1',
    ...overrides,
  };
}

const ownership = {
  queues: [{ name: 'os34143_intake', label: 'Ticket intake', members: [] }],
  assignmentRules: [{
    name: 'os34143_ticket_intake',
    label: 'Ticket intake',
    object: 'os34143_ticket',
    active: true,
    entries: [{ name: 'all', assignTo: { type: 'queue', value: 'os34143_intake' } }],
  }],
};

const objects = [
  {
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
    lifecycle: { class: 'audit', retention: { maxAge: '30d' }, seal: { valueFields: ['payload'] } },
  },
  { name: 'os34143_ticket', fields: { title: { type: 'text' } } },
];

/** The sealing child: the project's stack, the platform objects and plugin-audit under the local data key. */
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
await audit.sealer.stop(); // the pass runs here, not on the loop's clock
const H = 3600000;
const settled = Math.floor(Date.now() / H) * H - 3 * H;
const iso = (ms) => new Date(ms).toISOString();
const k = kernel.getService('objectql').getDriverForObject(process.env.LEDGER).knex;
await k(process.env.LEDGER).insert([
  { id: 'q1', created_at: iso(settled + 60000), tenant_id: 'org_q', action: 'update', payload: 'one' },
  { id: 'q2', created_at: iso(settled + 120000), tenant_id: 'org_q', action: 'update', payload: 'two' },
  { id: 'q3', created_at: iso(settled + 180000), tenant_id: null, action: 'config', payload: 'three' },
]);
const checkpoints = await audit.sealer.runPass();
await kernel.shutdown();
process.stderr.write('[fixture] sealed ' + JSON.stringify({ checkpoints }) + '\\n');
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function writeArtifact(file: string, withOwnership: boolean): void {
  writeFileSync(file, JSON.stringify({
    manifest: { id: 'com.example.os34143', name: 'Queued ledger', version: '0.0.0', type: 'app' },
    objects,
    ...(withOwnership ? ownership : {}),
  }));
}

function seal(project: string, artifact: string, db: string): { checkpoints: number } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SEAL_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({ OS_ARTIFACT_PATH: artifact, FIXTURE_PROJECT: project, FIXTURE_DB: db, LEDGER }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  const line = String(r.stderr).split('\n').find((l) => l.startsWith('[fixture] sealed '));
  if (r.status !== 0 || !line) throw new Error(`the sealing child did not run (status ${r.status})\n${String(r.stderr).slice(-3000)}`);
  return JSON.parse(line.slice('[fixture] sealed '.length));
}

/** One `os audit verify --json --database-url file:<db>` run in `project`, over `artifact`. */
function verify(project: string, artifact: string, db: string): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI, 'audit', 'verify', '--json', '--database-url', `file:${db}`], {
      cwd: project,
      env: childEnv({ OS_ARTIFACT_PATH: artifact }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
let sealed: { checkpoints: number };
let run: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-34143-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  const db = join(dir, 'data', 'main.db');
  const served = join(dir, 'dist', 'objectstack.json');
  const sealing = join(dir, 'dist', 'sealing.json');
  writeArtifact(served, true);
  writeArtifact(sealing, false);
  sealed = seal(dir, sealing, db);
  run = await verify(dir, served, db);
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os audit verify on a stack that declares queues and assignmentRules (ADR-0142 D1, ADR-0154 D9)', () => {
  it('0. the fixture: the sealer wrote a checkpoint for each of the two chains', () => {
    expect(sealed).toEqual({ checkpoints: 2 });
  });

  it('1. the command boots, reads the sealed ledger and gives its verdict: every row unmodified, exit 0', () => {
    // stdout first: a refused boot's `--json` document names the refusal.
    expect(run.code, `${run.stdout.slice(0, 2000)}\n${run.stderr.slice(-2000)}`).toBe(0);
    const doc = JSON.parse(run.stdout);
    expect(doc.error).toBeUndefined();
    expect(doc.report).toMatchObject({ ok: true, sealed: true, objects: [LEDGER], faults: [], rows: [] });
    expect(doc.report.totals.unmodified).toBe(3);
  });
});
