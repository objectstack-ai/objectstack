// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21733 — the card's acceptance, run against the BUILT CLI: a plain `os dev`
 * restart on a no-plugins scaffold self-heals safe drift, and provisions the
 * `telemetry` sibling, exactly as `content/docs/deployment/cli.mdx` says.
 *
 * ## The defect, measured at the public door before the fix
 *
 * A blank scaffold (one object, an org-scoped `unique` field, no plugins) boots
 * through the STANDALONE stack (`shouldBootWithLibrary` → `createStandaloneStack`),
 * whose `default` datasource never carried `autoMigrate: 'safe'` — only the
 * config-load fallback a host config takes did. So on a database whose unique
 * index an older release left non-NULL-safe:
 *
 *   | boot                                   | index after the boot          | `A.telemetry.db` |
 *   |----------------------------------------|-------------------------------|------------------|
 *   | `os dev --no-watch -d file:A.db`, ×2   | bare `(organization_id, qa_code)` | absent       |
 *   | same, `OS_MODE=off` (the host path)    | NULL-safe `COALESCE(…)`       | created          |
 *
 * while the default boot's own drift line read "auto-applied at boot under dev
 * autoMigrate: 'safe'".
 *
 * ## What each leg pins
 *
 * - boot 1 — a fresh `os dev` creates the NULL-safe index; with
 *   `OS_TELEMETRY_DB=0` it provisions no telemetry sibling (the opt-out).
 * - boot 2 — after the card's step 3 restages the bare index, a plain `os dev`
 *   restart puts the NULL-safe one back, says `auto-reconciled`, and provisions
 *   `A.telemetry.db` (default-on in dev for a file-backed SQLite primary).
 * - boot 3 — a production boot (`os serve`, `NODE_ENV` unset) on the restaged
 *   file reports the drift and leaves it: production never auto-migrates.
 *
 * The host-config path is pinned unchanged where it is decided
 * (`src/utils/storage-driver.test.ts`), and both hosts are held to one answer
 * per driver kind by `src/utils/dev-self-heal-host-parity.test.ts`; the
 * one-shot fence (`os migrate plan`, write-mode boots under
 * `NODE_ENV=development`) by `src/utils/schema-migrate.dev-self-heal-fence.integration.test.ts`.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset — the shipped entry, resolving commands
 * from `dist/`, so the boots measure the built packages (`requireBuiltCli`).
 * One process group per boot (`dev` supervises a `serve` grandchild). Every
 * boot runs in `beforeAll` and every `it` reads what it recorded: clocked cases
 * measure behaviour, never loading.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  childEnv,
  E2E_SECRET_KEY,
  portContentionError,
  portDriftError,
  randomPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
const ALL_BOOTS_TIMEOUT_MS = 3 * (BOOT_TIMEOUT_MS + 30_000);

const INDEX = 'uniq_scaf_item_organization_id_qa_code';

/** The card's blank scaffold: one object, an org-scoped unique field, no plugins, no datasources. */
const SCAFFOLD = {
  manifest: { id: 'com.example.scaf', namespace: 'scaf', version: '1.0.0', type: 'app', name: 'scaf' },
  objects: [{
    name: 'scaf_item',
    label: 'Item',
    sharingModel: 'private',
    fields: { qa_code: { type: 'text', label: 'QA code', unique: true } },
  }],
};

interface BootRecord {
  /** The index DDL `sqlite_master` holds after the boot stopped. */
  indexSql: string | undefined;
  telemetryExists: boolean;
  output: string;
}

const groups: ChildProcess[] = [];
let dir: string;
let db: string;
const record: Partial<Record<'fresh' | 'restart' | 'production', BootRecord | Error>> = {};

function readIndexSql(): string | undefined {
  const handle = new Database(db, { readonly: true });
  try {
    const row = handle.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(INDEX) as
      | { sql: string }
      | undefined;
    return row?.sql;
  } finally {
    handle.close();
  }
}

/** The card's step 3: replace the NULL-safe unique index with the bare one an older release left. */
function stageBareIndex(): void {
  const handle = new Database(db);
  try {
    handle.exec(`DROP INDEX ${INDEX}; CREATE UNIQUE INDEX ${INDEX} ON scaf_item (organization_id, qa_code);`);
  } finally {
    handle.close();
  }
}

/** Boot `os <argv>` until its ready banner, then stop the whole group and return what it printed. */
function bootUntilReady(argv: string[], port: string, env: Record<string, string | undefined>): Promise<string> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, ...argv], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
      // unset, so the built entry resolves its commands from `dist/`.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_DATABASE_URL: undefined,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MODE: undefined,
        NODE_ENV: undefined,
        ...env,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: `dev` supervises a `serve` grandchild.
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        stopGroup(child).then(() => rejectBoot(err), () => rejectBoot(err));
        return;
      }
      // Stop BEFORE the file is read: the boot's own writes are flushed on exit.
      stopGroup(child).then(() => resolveBoot(out), rejectBoot);
    };
    const timer = setTimeout(
      () => finish(new Error(`os ${argv[0]} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (READY.test(out)) finish(portDriftError(out, `os ${argv[0]}`, port));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      finish(portContentionError(out, `os ${argv[0]}`, port)
        ?? new Error(`os ${argv[0]} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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

/**
 * One boot, recorded against its own leg so a failed boot cannot hide the
 * others. Takes the boot already started, so every `bootUntilReady` call site
 * hands its child environment over as a literal the env gate can read.
 */
async function recordBoot(leg: 'fresh' | 'restart' | 'production', boot: Promise<string>): Promise<void> {
  try {
    const output = await boot;
    record[leg] = { indexSql: readIndexSql(), telemetryExists: existsSync(join(dir, 'A.telemetry.db')), output };
  } catch (error) {
    record[leg] = error instanceof Error ? error : new Error(String(error));
  }
}

function recorded(leg: 'fresh' | 'restart' | 'production'): BootRecord {
  const r = record[leg];
  if (r === undefined) throw new Error(`the ${leg} boot was never run`);
  if (r instanceof Error) throw r;
  return r;
}

const isNullSafe = (sql: string | undefined): boolean => /COALESCE\(`?organization_id`?/.test(sql ?? '');

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-21733-dev-'));
  writeDefineStackConfig(dir, SCAFFOLD);
  db = join(dir, 'A.db');

  // Boot 1: fresh, with the telemetry opt-out.
  let port = randomPort();
  await recordBoot('fresh', bootUntilReady(['dev', '--no-watch', '-d', 'file:A.db', '-p', port], port, { OS_TELEMETRY_DB: '0' }));

  // Boot 2: the card's restart, on the restaged bare index, telemetry default-on.
  if (existsSync(db)) stageBareIndex();
  port = randomPort();
  await recordBoot('restart', bootUntilReady(['dev', '--no-watch', '-d', 'file:A.db', '-p', port], port, {}));

  // Boot 3: production (`os serve`, NODE_ENV unset) on the restaged bare index.
  if (existsSync(db)) stageBareIndex();
  port = randomPort();
  await recordBoot('production', bootUntilReady(['serve', 'objectstack.config.ts', '-p', port], port, {
    OS_DATABASE_URL: 'file:A.db',
    OS_AUTH_SECRET: 'e2e-21733-production-leg-secret-not-for-real-use',
    OS_LOG_LEVEL: 'warn',
  }));
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#21733 — a plain `os dev` (standalone stack) self-heals and provisions telemetry', () => {
  it('a fresh `os dev` creates the NULL-safe index, and OS_TELEMETRY_DB=0 provisions no sibling', () => {
    const fresh = recorded('fresh');
    expect(isNullSafe(fresh.indexSql), `fresh boot index: ${fresh.indexSql}`).toBe(true);
    expect(fresh.telemetryExists, 'OS_TELEMETRY_DB=0 still created A.telemetry.db').toBe(false);
  });

  it('a plain `os dev` restart puts the staged bare unique index back NULL-safe', () => {
    const restart = recorded('restart');
    expect(isNullSafe(restart.indexSql), `the restart left the bare index: ${restart.indexSql}`).toBe(true);
    expect(restart.output).toContain('[schema-drift] auto-reconciled recreate_index on scaf_item');
  });

  it('the same restart provisions the `telemetry` sibling next to the file-backed primary', () => {
    const restart = recorded('restart');
    expect(restart.telemetryExists, 'no A.telemetry.db after a dev boot on file:A.db').toBe(true);
  });

  it('a production boot reports the staged drift and does not auto-migrate it', () => {
    const production = recorded('production');
    expect(production.output).toContain(`index '${INDEX}' tightens`);
    expect(production.output).not.toContain('[schema-drift] auto-reconciled');
    expect(isNullSafe(production.indexSql), `production auto-migrated: ${production.indexSql}`).toBe(false);
  });
});
