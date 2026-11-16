// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os audit verify --org` (ADR-0154 D9) over a sealed object whose
 * organization lives in the tenant column the registry injects, ADR-0131's
 * `organization_id`, named by `lifecycle.seal.chainField` (ADR-0154 D10, as
 * its note on the key records). The object declares no `tenant_id`.
 *
 * A child process seals the ledger with plugin-audit's own sealer, composed
 * with the crypto provider `os serve` would choose (the local data key the
 * spawned runs share), as `verify.integration.test.ts` does. Then the real
 * command, spawned from its source entry:
 *
 *   1. sealing wrote one checkpoint per organization;
 *   2. `--org org_x` reports org_x's chain and its two rows, and no other
 *      chain, and exits 0;
 *   3. a row of org_x edited through the database, below every hook, reads
 *      `modified` in org_x's chain under `--org org_x` (exit 1), while
 *      `--org org_y` still verifies (exit 0).
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
const LEDGER = 'os34164_ai_ledger';

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
    // One fixed data key for the sealing child and every command run.
    OS_SECRET_KEY: '34ab'.repeat(16),
    OS_TELEMETRY_DB: '0',
    NO_COLOR: '1',
    ...overrides,
  };
}

/**
 * The sealing child: the project's stack, the platform objects and
 * plugin-audit composed with the local data key's provider. It writes rows of
 * a settled window, two of org_x and one of org_y, each naming its
 * organization in `organization_id` only, and seals them with the plugin's own
 * sealer.
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
await audit.sealer.stop(); // the passes run here, not on the loop's clock
const H = 3600000;
const settled = Math.floor(Date.now() / H) * H - 3 * H;
const iso = (ms) => new Date(ms).toISOString();
const k = ql.getDriverForObject(process.env.LEDGER).knex;
await k(process.env.LEDGER).insert([
  { id: 'x1', created_at: iso(settled + 60000), organization_id: 'org_x', action: 'tool_call', payload: '{"tool":"a"}' },
  { id: 'x2', created_at: iso(settled + 120000), organization_id: 'org_x', action: 'tool_call', payload: '{"tool":"b"}' },
  { id: 'y1', created_at: iso(settled + 150000), organization_id: 'org_y', action: 'tool_call', payload: '{"tool":"c"}' },
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

const sealedObject = {
  name: LEDGER,
  label: 'AI audit ledger',
  // Only the tenant column is injected: no audit family, no ownership anchors.
  ownership: 'none',
  systemFields: { audit: false },
  fields: {
    id: { type: 'text' },
    created_at: { type: 'datetime' },
    action: { type: 'text' },
    payload: { type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'], chainField: 'organization_id' } },
};

function writeArtifact(project: string): void {
  mkdirSync(join(project, 'dist'), { recursive: true });
  writeFileSync(
    join(project, 'dist', 'objectstack.json'),
    JSON.stringify({ manifest: { id: 'com.example.os34164', name: 'Sealed AI ledger', version: '0.0.0', type: 'app' }, datasources: [], objects: [sealedObject] }),
  );
}

function seal(project: string, db: string): { checkpoints: number } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SEAL_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json'), FIXTURE_PROJECT: project, FIXTURE_DB: db, LEDGER }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  const line = String(r.stderr).split('\n').find((l) => l.startsWith('[fixture] sealed '));
  if (r.status !== 0 || !line) throw new Error(`the sealing child did not run (status ${r.status})\n${String(r.stderr).slice(-3000)}`);
  return JSON.parse(line.slice('[fixture] sealed '.length));
}

/** One `os audit verify --org <org> --json --database-url file:<db>` run, in `project`. */
function verify(project: string, db: string, org: string): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const args = [CLI, 'audit', 'verify', '--org', org, '--json', '--database-url', `file:${db}`];
    const child = spawn(process.execPath, args, {
      cwd: project,
      env: childEnv({ OS_ARTIFACT_PATH: join(project, 'dist', 'objectstack.json') }),
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

interface Report {
  ok: boolean;
  scope: { orgs: string[] | null };
  chains: Array<{ object: string; chain: string; checkpoints: number; counts: Record<string, number> }>;
  rows: Array<{ object: string; chain: string; row: string; verdict: string }>;
  faults: unknown[];
}

/** The `--json` document of a run; a run that printed none fails with its output. */
function reportOf(run: Run): Report {
  const at = run.stdout.indexOf('{');
  if (at < 0) throw new Error(`no JSON document (exit ${run.code})\nstdout: ${run.stdout.slice(-2000)}\nstderr: ${run.stderr.slice(-2000)}`);
  const doc = JSON.parse(run.stdout.slice(at)) as { report?: Report };
  if (!doc.report) throw new Error(`no report in the JSON document (exit ${run.code})\n${run.stdout.slice(-2000)}`);
  return doc.report;
}

let dir: string;
let db: string;
let sealed: { checkpoints: number };
const runs: Record<'clean' | 'tampered' | 'otherOrg', Run> = {} as never;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-34164-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  db = join(dir, 'data', 'main.db');
  writeArtifact(dir);
  sealed = seal(dir, db);
  runs.clean = await verify(dir, db, 'org_x');
  const hot = new Database(db);
  try {
    hot.prepare(`UPDATE ${LEDGER} SET payload = ? WHERE id = 'x1'`).run('{"tool":"z"}');
  } finally {
    hot.close();
  }
  runs.tampered = await verify(dir, db, 'org_x');
  runs.otherOrg = await verify(dir, db, 'org_y');
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os audit verify --org on an object chained by organization_id (ADR-0154 D9, D10 note)', () => {
  it('sealed one checkpoint per organization', () => {
    expect(sealed.checkpoints).toBe(2);
  });

  it("reports the scoped organization's chain and its rows, and no other chain (exit 0)", () => {
    const report = reportOf(runs.clean);
    expect(report.scope.orgs).toEqual(['org_x']);
    expect(report.faults).toEqual([]);
    expect(report.chains.map((c) => [c.object, c.chain, c.checkpoints, c.counts.unmodified])).toEqual([[LEDGER, 'org:org_x', 1, 2]]);
    expect(report.ok).toBe(true);
    expect(runs.clean.code).toBe(0);
  });

  it("reads a row of the scoped organization edited in the database modified, in that organization's chain (exit 1)", () => {
    const report = reportOf(runs.tampered);
    expect(report.rows.map((r) => [r.chain, r.row, r.verdict])).toEqual([['org:org_x', 'x1', 'modified']]);
    expect(runs.tampered.code).toBe(1);
  });

  it("leaves another organization's chain verifying (exit 0)", () => {
    const report = reportOf(runs.otherOrg);
    expect(report.chains.map((c) => [c.chain, c.counts.unmodified])).toEqual([['org:org_y', 1]]);
    expect(runs.otherOrg.code).toBe(0);
  });
});
