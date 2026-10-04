// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21529] `os migrate resume`, `os migrate recorded-by` and `os migrate
 * value-shapes` answer a project whose database does not exist yet with empty
 * work and exit 0, the answer each gives a booted database with nothing to do.
 *
 * ## The measured defect
 *
 * Each command's default mode boots read-only: the SQL driver defers every
 * table's DDL, and a missing sqlite file is opened as an empty in-memory
 * stand-in. Each then read the very tables its boot had just deferred, so on a
 * fresh project (measured at the public door, base `49161683fb`):
 *
 *  - `resume --json` exited 1 with "The database refused to run this query for
 *    object 'sys_migration_journal'";
 *  - `recorded-by --json` exited 1 the same way for `sys_metadata_history`;
 *  - `value-shapes --json` exited 1 with every covered object "unreadable" and
 *    the gate closed, over data that does not exist;
 *  - and every one of those boots also logged "Migration journal scan failed"
 *    from `MigrationRecoveryPlugin`'s scan of the same absent journal.
 *
 * ## The answer pinned
 *
 * "Not asked": the read-only boot already measured which tables are absent
 * (the deferred sync lists them as `create_table`, decided by `hasTable`), so
 * a command does not read them. The documented exit for empty work is 0 — an
 * `os migrate` subcommand's `--json` success exits 0 (the platform checklist's
 * migrate item), and for `value-shapes` a clean scan exits 0
 * (`content/docs/deployment/cli.mdx`) — and it is the exit each command gives
 * the booted control below.
 *
 * Per command, on the absent database: exit 0, the empty-work document, no
 * read of its own tables refused, no journal-scan warning, no file created.
 * Human mode says the table is not there yet rather than implying it looked.
 *
 * ## The control
 *
 * A booted database holding one row of work for each command: a journalled
 * run that never concluded, a history row still carrying the sentinel, and an
 * app record with a covered field. Each command READS it and reports it. A
 * fix that answered empty work without looking would fail here.
 *
 * Every spawn runs in the hook; a case only reads what a run printed.
 *
 * ## [#21552] The rest of the family
 *
 * The same shape, closed out for the six read-only doors #21529's ruling did
 * not name: `os migrate account-issuer`, `audit-metadata-bodies` and `meta
 * --stored`, `os secret orphans` and `rewrap`, `os storage orphans`. Each used
 * to exit 1 on a project whose database does not exist yet, from its own first
 * read of a table its read-only boot had deferred. Five now ask
 * `SchemaStack.tableAbsent` before the read; `account-issuer` cannot (its boot
 * composes no auth plugin, so `sys_account` is never listed as a table to
 * create) and recognises the missing-table refusal for that table only.
 *
 * Pinned in the second half of this file: the six on the absent database
 * (`--json` and human), a booted database holding one row of work for each
 * (the control: the door READS the table and reports the row), and the four
 * doors that already exited 0 on the absent database, which still do.
 *
 * [#21573] `os migrate unmapped-columns` joined the roster later, born with
 * the same answer: it asks `tableAbsent` before the differ. Its control row is
 * a retired field's column on `os21529_contact`, holding a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** The source entry, as `test/helpers/serve-process.ts` spawns it; `src/` cannot import that helper. */
const CLI = resolve(HERE, '../../../bin/run-dev.js');

const HOOK_TIMEOUT_MS = 480_000;
const RUN_BUDGET_MS = 120_000;

const ARTIFACT = {
  manifest: { id: 'com.example.os21529', name: 'Absent database', version: '0.0.0', type: 'app' },
  objects: [
    { name: 'os21529_account', fields: { name: { type: 'text' } } },
    // A lookup is a covered value class, so `value-shapes` walks this object.
    {
      name: 'os21529_contact',
      fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'os21529_account' } },
    },
  ],
};

/** The interrupted run the control's journal holds. */
const RUN_ID = 'run_21529_control';

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

/**
 * This process's environment for a child, minus the families
 * `test/helpers/serve-process.ts` `childEnv()` strips (its header says why).
 * An `undefined` override unsets a variable.
 */
function childEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_') || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  const unset: Record<string, undefined> = {};
  for (const key of OVERRIDING_ENV) unset[key] = undefined;
  return { ...env, ...unset, ...overrides };
}

/**
 * The control's database: a served-shape boot (DDL performed) of the same data
 * stack the commands compose, then one row of work for each command.
 */
const SEED_CHILD = `
const rt = await import('@objectstack/runtime');
const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
  armLifecycleSweep: false,
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await kernel.use(new PlatformObjectsPlugin());
await runtime.start();
const ql = kernel.getService('objectql');
const SYSTEM = { context: { isSystem: true } };
await ql.insert('sys_metadata_history', {
  id: 'h_21529', event_seq: 1, name: 'os21529_note', type: 'object', version: 1,
  operation_type: 'create', recorded_by: 'system', recorded_at: new Date().toISOString(),
}, SYSTEM);
await ql.insert('sys_migration_journal', {
  run_id: process.env.FIXTURE_RUN, seq: 0, kind: 'run_started', plan_hash: 'h',
  detail: JSON.stringify({ planId: 'plan_21529' }),
}, SYSTEM);
await ql.insert('sys_migration_journal', {
  run_id: process.env.FIXTURE_RUN, seq: 1, kind: 'chunk_started', chunk_index: 0,
}, SYSTEM);
const account = await ql.insert('os21529_account', { name: 'Acme' }, SYSTEM);
await ql.insert('os21529_contact', { name: 'Ann', account: account.id }, SYSTEM);
await kernel.shutdown();
process.stderr.write('[fixture] seeded\\n');
process.exit(0);
`;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;
let absentDb: string;
let bootedDb: string;

function runCommand(command: string, extra: string[], dbFile: string): Promise<Run> {
  return runCli(['migrate', command, ...extra], dbFile);
}

/** One `os <argv…> --database-url file:<dbFile>` run, in the fixture project. */
function runCli(argv: string[], dbFile: string): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [CLI, ...argv, '--database-url', `file:${dbFile}`],
      {
        cwd: dir,
        env: childEnv({
          NO_COLOR: '1',
          OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
          // The fixed key `serve-process.ts` hands its children, so no boot
          // mints and persists a crypto key into this runner's home directory.
          OS_SECRET_KEY: '0e2e'.repeat(16),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`os ${argv.join(' ')} did not finish within ${RUN_BUDGET_MS}ms\n${stderr}`));
    }, RUN_BUDGET_MS);
    child.on('error', (err) => { clearTimeout(timer); rejectRun(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

const COMMANDS = ['resume', 'recorded-by', 'value-shapes'] as const;
type CommandName = (typeof COMMANDS)[number];

/** The tables each command reads for its answer — the ones its boot defers on a fresh project. */
const OWN_TABLES: Record<CommandName, readonly string[]> = {
  resume: ['sys_migration_journal'],
  'recorded-by': ['sys_metadata_history'],
  // The objects with a covered field: the scan walks each.
  'value-shapes': ['os21529_contact', 'sys_metadata', 'sys_view_definition'],
};

const absentJson = {} as Record<CommandName, Run>;
const absentHuman = {} as Record<CommandName, Run>;
const bootedJson = {} as Record<CommandName, Run>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-21529-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
  absentDb = join(dir, 'data', 'absent.db');
  bootedDb = join(dir, 'data', 'booted.db');

  const seed = spawnSync(process.execPath, ['--input-type=module', '-e', SEED_CHILD], {
    cwd: CLI_ROOT,
    env: childEnv({
      OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
      OS_SECRET_KEY: '0e2e'.repeat(16),
      FIXTURE_PROJECT: dir,
      FIXTURE_DB: bootedDb,
      FIXTURE_RUN: RUN_ID,
    }),
    encoding: 'utf8',
    timeout: RUN_BUDGET_MS,
  });
  if (seed.status !== 0 || !String(seed.stderr).includes('[fixture] seeded')) {
    throw new Error(`the control database was not seeded (status ${seed.status})\n${seed.stderr}`);
  }

  for (const command of COMMANDS) {
    absentJson[command] = await runCommand(command, ['--json'], absentDb);
    absentHuman[command] = await runCommand(command, [], absentDb);
    bootedJson[command] = await runCommand(command, ['--json'], bootedDb);
  }
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Lines, on either stream, where a read of one of `tables` was refused. */
function refusedReads(run: Run, tables: readonly string[]): string[] {
  return `${run.stdout}\n${run.stderr}`
    .split('\n')
    .filter((line) => /refused to run this query|cannot read/.test(line))
    .filter((line) => tables.some((t) => line.includes(`'${t}'`) || line.includes(`read ${t} `)));
}

function journalScanWarnings(run: Run): string[] {
  return `${run.stdout}\n${run.stderr}`.split('\n').filter((line) => /journal scan failed/i.test(line));
}

describe('[#21529] on a database that does not exist yet: empty work, exit 0', () => {
  it.each(COMMANDS)('%s: reads none of its own tables, and the boot scan does not warn', (command) => {
    for (const run of [absentJson[command], absentHuman[command]]) {
      expect(refusedReads(run, OWN_TABLES[command]), run.stderr).toEqual([]);
      expect(journalScanWarnings(run)).toEqual([]);
    }
    // Still a read-only boot: no database file was brought into existence.
    expect(existsSync(absentDb)).toBe(false);
  });

  it('resume --json: no interrupted runs, exit 0', () => {
    const run = absentJson.resume;
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ interrupted: [], count: 0 });
  });

  it('recorded-by --json: nothing to convert, exit 0', () => {
    const run = absentJson['recorded-by'];
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      planId: 'metadata.recorded-by-sentinel-to-null',
      sentinel: 'system',
      pending: 0,
      applied: false,
    });
  });

  it('value-shapes --json: a clean, complete scan of zero records, exit 0', () => {
    const run = absentJson['value-shapes'];
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload).toMatchObject({ apply: false, gatePassed: true, flag: null });
    expect(payload.scan).toMatchObject({ scannedRecords: 0, blocking: 0, truncated: false, unreadableObjects: [] });
    // The objects were in scope, and answered from the measurement rather than a read.
    expect(payload.scan.scannedObjects).toContain('os21529_contact');
    expect(run.stderr).toMatch(/have no table in this database yet[^\n]*os21529_contact/);
  });

  it('human mode says the table is not there yet, exit 0', () => {
    expect(absentHuman.resume.code, absentHuman.resume.stderr).toBe(0);
    expect(absentHuman.resume.stdout).toContain('No interrupted migration runs — this database has no sys_migration_journal table yet');
    expect(absentHuman['recorded-by'].code, absentHuman['recorded-by'].stderr).toBe(0);
    expect(absentHuman['recorded-by'].stdout).toContain('this database has no such table yet, so there is nothing to convert');
    expect(absentHuman['value-shapes'].code, absentHuman['value-shapes'].stderr).toBe(0);
    expect(absentHuman['value-shapes'].stdout).toMatch(/have no table in this database yet[^\n]*os21529_contact/);
    expect(absentHuman['value-shapes'].stdout).toContain('Scan clean');
  });
});

describe('[#21529] the control: a booted database is read, and its work is reported', () => {
  it('resume --json lists the interrupted run, exit 0', () => {
    const run = bootedJson.resume;
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload.count).toBe(1);
    expect(payload.interrupted.map((r: { runId: string }) => r.runId)).toEqual([RUN_ID]);
  });

  it('recorded-by --json counts the sentinel row, exit 0', () => {
    const run = bootedJson['recorded-by'];
    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ pending: 1, applied: false });
  });

  it('value-shapes --json walks the stored record, exit 0', () => {
    const run = bootedJson['value-shapes'];
    expect(run.code, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout);
    expect(payload.gatePassed).toBe(true);
    expect(payload.scan.scannedRecords).toBeGreaterThanOrEqual(1);
    expect(payload.scan.unreadableObjects).toEqual([]);
    expect(run.stderr).not.toMatch(/have no table in this database yet/);
  });

  it.each(COMMANDS)('%s: the boot scan does not warn here either', (command) => {
    expect(journalScanWarnings(bootedJson[command])).toEqual([]);
  });
});

// ── [#21552] The rest of the family ──────────────────────────────────────────

/**
 * The control database for the six doors: a served-shape boot (DDL performed)
 * of the plugin set those doors compose between them — platform objects, the
 * audit objects, settings, storage — then one row of work for each:
 *
 *  - `sys_account`: a two-row table in the legacy shape, with its `issuer`
 *    column. The door's boot composes no auth plugin, so the table is made
 *    here by hand, the way a deployment that ran the auth plugin left it;
 *  - `sys_audit_log` and `sys_activity`: an old audit copy of a datasource
 *    body, in cleartext, in each. `sys_activity` is rotation-managed, so its
 *    base name is a VIEW over a `sys_activity__r<key>` shard table, and the
 *    boot's deferred sync lists it as a table to create all the same;
 *  - `sys_metadata`: one stored `object` row, already on protocol;
 *  - `sys_secret`: one row no producer references;
 *  - `sys_file`: one committed attachments-scope file nothing holds.
 */
const SEED_FAMILY_CHILD = `
const rt = await import('@objectstack/runtime');
const { PlatformObjectsPlugin } = await import('@objectstack/platform-objects/plugin');
const { AuditPlugin } = await import('@objectstack/plugin-audit');
const { StorageServicePlugin } = await import('@objectstack/service-storage');
const { SettingsServicePlugin, LocalCryptoProvider } = await import('@objectstack/service-settings');
const { SqlDriver } = await import('@objectstack/driver-sql');
const stack = await rt.createStandaloneStack({
  projectRoot: process.env.FIXTURE_PROJECT,
  databaseUrl: 'file:' + process.env.FIXTURE_DB,
  skipSeedData: true,
  armLifecycleSweep: false,
});
const runtime = new rt.Runtime({ cluster: false });
const kernel = runtime.getKernel();
for (const plugin of stack.plugins) await kernel.use(plugin);
await kernel.use(new PlatformObjectsPlugin());
await kernel.use(new AuditPlugin());
await kernel.use(new SettingsServicePlugin({
  registerRoutes: false,
  cryptoProvider: new LocalCryptoProvider({ mode: 'production', env: process.env }),
}));
await kernel.use(new StorageServicePlugin({ registerRoutes: false }));
await runtime.start();
const ql = kernel.getService('objectql');
const SYSTEM = { context: { isSystem: true } };
await ql.insert('sys_metadata', {
  type: 'object', name: 'os21552_note', state: 'active',
  metadata: JSON.stringify({ name: 'os21552_note', fields: { title: { type: 'text' } } }),
}, SYSTEM);
await kernel.shutdown();

const raw = new SqlDriver({ client: 'better-sqlite3', connection: { filename: process.env.FIXTURE_DB }, useNullAsDefault: true });
const k = raw.knex;
await k.raw('CREATE TABLE sys_account (id text primary key, provider_id text, account_id text, issuer text, user_id text)');
await k('sys_account').insert([
  { id: 'acc_1', provider_id: 'github', account_id: 'g-1', issuer: 'github', user_id: 'u1' },
  { id: 'acc_2', provider_id: 'github', account_id: 'g-2', issuer: 'github', user_id: 'u2' },
]);
await k('sys_audit_log').insert({
  id: 'aud_21552', object_name: 'sys_metadata', record_id: 'm_21552', action: 'create',
  new_value: JSON.stringify({
    id: 'm_21552', name: 'ds', type: 'datasource', scope: 'platform',
    metadata: JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://db.turso.io', encryptionKey: 'cleartext-21552' } }),
  }),
});
const shard = (await k.raw("select name from sqlite_master where type = 'table' and name glob 'sys_activity__r*'"))[0];
if (!shard) throw new Error('the control has no sys_activity shard: the rotation did not run');
await k(shard.name).insert({
  id: 'act_21552', timestamp: new Date().toISOString(), type: 'create', summary: 'created', object_name: 'sys_metadata', record_id: 'm_21552',
  metadata: JSON.stringify({
    old: null,
    new: {
      id: 'm_21552', name: 'ds', type: 'datasource', scope: 'platform',
      metadata: JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://db.turso.io', encryptionKey: 'cleartext-21552-activity' } }),
    },
  }),
});
await k('sys_secret').insert({
  id: 'sec_21552', namespace: 'os21552', key: 'orphan', kms_key_id: 'local', alg: 'aes-256-gcm', version: 1, ciphertext: 'not-a-real-ciphertext',
});
await k('sys_file').insert({
  id: 'file_21552', key: 'attachments/os21552.txt', name: 'os21552.txt', size: 12, scope: 'attachments', status: 'committed',
});
// A retired field's column: in the table, in no metadata, holding a value.
await k.raw('ALTER TABLE os21529_contact ADD COLUMN legacy_note text');
await k('os21529_contact').insert({ id: 'con_21573', name: 'Ann', legacy_note: 'kept-21573' });
await raw.disconnect();
process.stderr.write('[fixture] seeded\\n');
process.exit(0);
`;

interface Door {
  /** The name a case reads as. */
  name: string;
  argv: string[];
  /** The `--json` document an empty answer carries, as a predicate over the parsed document. */
  empty: (doc: any) => void;
  /** The sentence the human face ends on when there is nothing to report. */
  humanEmpty: RegExp;
  /** The tables the door reads itself: a refused read of one must not appear. */
  tables: readonly string[];
  /** What the booted control holds for the door: read, and reported. */
  work: (doc: any) => void;
}

const DOORS: readonly Door[] = [
  {
    name: 'migrate account-issuer',
    argv: ['migrate', 'account-issuer'],
    empty: (doc) => expect(doc).toMatchObject({ scanned: 0, keys: 0, collisions: [], crossUser: 0, ok: true }),
    humanEmpty: /Pre-flight clean/,
    tables: ['sys_account'],
    work: (doc) => expect(doc).toMatchObject({ scanned: 2, keys: 2, collisions: [], ok: true }),
  },
  {
    name: 'migrate audit-metadata-bodies',
    argv: ['migrate', 'audit-metadata-bodies'],
    empty: (doc) => {
      expect(doc).toMatchObject({ apply: false, report: { scanned: 0, rewritten: 0, failures: 0 } });
      expect(Object.keys(doc.report.byObject).sort()).toEqual(['sys_activity', 'sys_audit_log', 'sys_metadata_audit']);
    },
    humanEmpty: /Nothing to rewrite/,
    tables: ['sys_audit_log', 'sys_activity', 'sys_metadata_audit'],
    work: (doc) => {
      expect(doc.report.failures).toBe(0);
      // The seeded cleartext copy is the one row to rewrite. The audit writer's own
      // copy of the control's `sys_metadata` insert is read too, and is already clean.
      expect(doc.report.byObject.sys_audit_log.scanned).toBeGreaterThanOrEqual(1);
      expect(doc.report.byObject.sys_audit_log.rewritten).toBe(1);
      // The rotation-managed table's rows are READ, though the boot listed its base name as a
      // table to create: skipping it would answer "nothing to rewrite" over this row.
      expect(doc.report.byObject.sys_activity.scanned).toBeGreaterThanOrEqual(1);
      expect(doc.report.byObject.sys_activity.rewritten).toBe(1);
    },
  },
  {
    name: 'migrate meta --stored',
    argv: ['migrate', 'meta', '--stored'],
    empty: (doc) => expect(doc).toMatchObject({ apply: false, scanned: 0, pending: 0, failed: 0, rows: [], clean: true }),
    humanEmpty: /No stored metadata to examine/,
    tables: ['sys_metadata'],
    work: (doc) => {
      expect(doc.scanned).toBeGreaterThanOrEqual(1);
      expect(doc).toMatchObject({ pending: 0, failed: 0, clean: true });
    },
  },
  {
    name: 'secret orphans',
    argv: ['secret', 'orphans', '--no-declared-datasources'],
    empty: (doc) => {
      expect(doc).toMatchObject({ mode: 'report', plan: { refusal: null, counts: { total: 0, deletable: 0 } } });
      // The union was enumerated, not gapped: an absent table holds no reference.
      for (const family of Object.values(doc.plan.families) as Array<{ status: string }>) {
        expect(family.status).toBe('enumerated');
      }
    },
    humanEmpty: /Report only — nothing was written or deleted/,
    tables: ['sys_secret', 'sys_setting', 'sys_metadata'],
    work: (doc) => expect(doc.plan.counts.total).toBe(1),
  },
  {
    name: 'secret rewrap',
    argv: ['secret', 'rewrap', '--no-declared-datasources'],
    empty: (doc) => {
      expect(doc).toMatchObject({ mode: 'dry-run', report: { refusal: null, counts: { total: 0, rewrap: 0 } } });
      for (const family of Object.values(doc.report.families) as Array<{ status: string }>) {
        expect(family.status).toBe('enumerated');
      }
    },
    humanEmpty: /Dry run — nothing was written/,
    tables: ['sys_secret', 'sys_setting', 'sys_metadata'],
    work: (doc) => expect(doc.report.counts.total).toBe(1),
  },
  {
    name: 'storage orphans',
    argv: ['storage', 'orphans'],
    empty: (doc) => expect(doc).toMatchObject({ filesScanned: 0, stranded: 0, truncated: false }),
    humanEmpty: /Nothing stranded on this deployment/,
    tables: ['sys_file', 'sys_attachment'],
    work: (doc) => expect(doc).toMatchObject({ filesScanned: 1, stranded: 1 }),
  },
  {
    // Born after #21552 with the family's answer: it asks `tableAbsent` before
    // the differ, so an absent table is empty work and is never read.
    name: 'migrate unmapped-columns',
    argv: ['migrate', 'unmapped-columns', '--object', 'os21529_contact'],
    empty: (doc) => expect(doc).toMatchObject({ object: 'os21529_contact', columns: [], count: 0, records: [] }),
    humanEmpty: /No unmapped column on os21529_contact/,
    tables: ['os21529_contact'],
    work: (doc) => {
      expect(doc.columns).toEqual([{ column: 'legacy_note', actual: 'text' }]);
      expect(doc.records).toContainEqual({ id: 'con_21573', values: { legacy_note: 'kept-21573' } });
    },
  },
];

/** The four doors that already answered the absent database with exit 0: they must still. */
const ALREADY_EXIT_ZERO: ReadonlyArray<{ name: string; argv: string[] }> = [
  { name: 'migrate files-to-references', argv: ['migrate', 'files-to-references', '--json'] },
  { name: 'migrate summary-nulls', argv: ['migrate', 'summary-nulls', '--json'] },
  { name: 'migrate multi-value-columns', argv: ['migrate', 'multi-value-columns', '--json'] },
  // `duplicates` has no `--json`: it always prints its one JSON document.
  { name: 'migrate duplicates', argv: ['migrate', 'duplicates'] },
];

describe('[#21552] the rest of the family: a project with no database yet is empty work, exit 0', () => {
  const familyAbsentJson: Record<string, Run> = {};
  const familyAbsentHuman: Record<string, Run> = {};
  const familyBootedJson: Record<string, Run> = {};
  const alreadyZero: Record<string, Run> = {};
  let familyDb: string;

  beforeAll(async () => {
    familyDb = join(dir, 'data', 'family.db');
    const seed = spawnSync(process.execPath, ['--input-type=module', '-e', SEED_FAMILY_CHILD], {
      cwd: CLI_ROOT,
      env: childEnv({
        OS_ARTIFACT_PATH: join(dir, 'dist', 'objectstack.json'),
        OS_SECRET_KEY: '0e2e'.repeat(16),
        FIXTURE_PROJECT: dir,
        FIXTURE_DB: familyDb,
      }),
      encoding: 'utf8',
      timeout: RUN_BUDGET_MS,
    });
    if (seed.status !== 0 || !String(seed.stderr).includes('[fixture] seeded')) {
      throw new Error(`the family control database was not seeded (status ${seed.status})\n${seed.stdout}\n${seed.stderr}`);
    }

    for (const door of DOORS) {
      familyAbsentJson[door.name] = await runCli([...door.argv, '--json'], absentDb);
      familyAbsentHuman[door.name] = await runCli(door.argv, absentDb);
      familyBootedJson[door.name] = await runCli([...door.argv, '--json'], familyDb);
    }
    for (const control of ALREADY_EXIT_ZERO) {
      alreadyZero[control.name] = await runCli(control.argv, absentDb);
    }
  }, HOOK_TIMEOUT_MS);

  it.each(DOORS.map((d) => [d.name, d] as const))('%s --json: empty work, exit 0, no refused read of its own tables', (name, door) => {
    const run = familyAbsentJson[name];
    expect(run.code, run.stderr).toBe(0);
    door.empty(JSON.parse(run.stdout));
    expect(refusedReads(run, door.tables), run.stderr).toEqual([]);
    // Say so: the table that was answered without a read is named, on stderr.
    expect(run.stderr).toMatch(/has no table in this database yet|have no table in this database yet/);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s (human): exit 0 on the empty-work sentence', (name, door) => {
    const run = familyAbsentHuman[name];
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toMatch(door.humanEmpty);
    expect(run.stdout).toMatch(/has no table in this database yet|have no table in this database yet/);
  });

  it('no door brought a database file into existence', () => {
    expect(existsSync(absentDb)).toBe(false);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s: the control, a booted database, is READ and its row reported', (name, door) => {
    const run = familyBootedJson[name];
    expect(run.code, run.stderr).toBe(0);
    door.work(JSON.parse(run.stdout));
    // Nothing was answered from the absence measurement: every table is there.
    expect(run.stderr).not.toMatch(/have no table in this database yet|has no table in this database yet/);
  });

  it.each(ALREADY_EXIT_ZERO.map((c) => [c.name] as const))('%s: already exited 0 on the absent database, and still does', (name) => {
    const run = alreadyZero[name];
    expect(run.code, run.stderr).toBe(0);
    expect(() => JSON.parse(run.stdout)).not.toThrow();
  });
});
