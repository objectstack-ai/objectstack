// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: the real `os` binary, three runs (dry run, apply, re-run) over one 18.0 fixture copy, each a full CLI boot; the twin of audit-mail-bodies.dogfood's budget, re-measure on CI
//
// `os migrate audit-key-material` over an 18.0 database: the encrypted
// key-material columns the 18.0 audit writer copied into `sys_audit_log` and
// `sys_activity` are removed from those copies at rest, and nothing else moves.
//
// ## What was measured
//
// The 18.0 fixture (`upgrade-harness/fixture-18.0/`) holds `sys_audit_log` and
// `sys_activity` copies of its secret-store and settings rows, each still
// carrying the row's encrypted key-material column: the writer omits those
// columns only on new writes.
//
// ## What is pinned, on a fresh copy of the fixture
//
//   0. The fixture holds copies carrying a key-material column on both tables
//      (a vacuous fixture is no pin).
//   1. The dry run counts them and writes nothing: every row of both tables is
//      byte-identical afterwards.
//   2. `--apply` leaves 0 copies carrying one. A rewritten row differs from
//      the fixture in its copy column alone, and in that column only by the
//      removed key-material keys; every other row of both tables is
//      byte-identical.
//   3. A second `--apply` rewrites nothing and changes no byte.
//
// The command runs as an operator runs it: the real binary, in the showcase's
// directory, over the database file.
//
// ⛔ No column value appears in a title, an assertion message or a log line:
// every comparison is reported as a count or a boolean.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFixtureAsOf } from './upgrade-harness/fixture-as-of.js';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
// Its rotation shards re-dated to the day before this run (`fixture-as-of.ts`):
// the command's boot drops a shard older than the retention window.
const { sql: fixtureSql } = readFixtureAsOf(FIXTURE);
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');

/**
 * Per object, the key-material columns no ledger copy carries — written out
 * here, not imported, so this pin is a record independent of the producer's
 * own list.
 */
const KEY_MATERIAL: ReadonlyMap<string, readonly string[]> = new Map([
  ['sys_secret', ['ciphertext']],
  ['sys_setting', ['value_enc']],
  ['sys_platform_setting', ['value_enc']],
]);

type Row = Record<string, unknown>;
/** Every row of `sys_audit_log` and every `sys_activity` shard, keyed `table/id`. */
type Snapshot = Map<string, Row>;

function snapshot(file: string): Snapshot {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name = 'sys_audit_log' OR name LIKE 'sys_activity__%') ORDER BY name")
      .all() as Array<{ name: string }>).map((r) => r.name);
    const out: Snapshot = new Map();
    for (const table of tables) {
      for (const row of db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Row[]) out.set(`${table}/${String(row.id)}`, { ...row });
    }
    return out;
  } finally {
    db.close();
  }
}

const isAudit = (key: string): boolean => key.startsWith('sys_audit_log/');
const copyColumnsOf = (key: string): string[] => (isAudit(key) ? ['new_value', 'old_value'] : ['metadata']);
const parse = (v: unknown): unknown => {
  if (typeof v !== 'string' || v === '') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** The snapshot sides of one copy row: `new_value` / `old_value`, or the two halves of the activity pair. */
function sidesOf(key: string, row: Row): unknown[] {
  if (isAudit(key)) return [parse(row.new_value), parse(row.old_value)];
  const pair = parse(row.metadata) as { old?: unknown; new?: unknown } | null;
  return pair && typeof pair === 'object' ? [pair.old, pair.new] : [];
}

const carriesKeyMaterial = (objectName: string, side: unknown): boolean =>
  !!side && typeof side === 'object' && (KEY_MATERIAL.get(objectName) ?? []).some((c) => c in (side as Row));

/** Copy rows carrying a key-material column on any side, per table family. */
function keyMaterialCopies(snap: Snapshot): { audit: number; activity: number } {
  const out = { audit: 0, activity: 0 };
  for (const [key, row] of snap) {
    const objectName = String(row.object_name);
    if (!KEY_MATERIAL.has(objectName)) continue;
    if (sidesOf(key, row).some((side) => carriesKeyMaterial(objectName, side))) out[isAudit(key) ? 'audit' : 'activity'] += 1;
  }
  return out;
}

/** `side` without the object's key-material columns, every other key kept — the expected rewritten copy. */
function omitted(objectName: string, side: unknown): unknown {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return side;
  const out: Row = { ...(side as Row) };
  for (const c of KEY_MATERIAL.get(objectName) ?? []) delete out[c];
  return out;
}

/** The copy column as the fixture holds it, with each side's key-material columns removed and every other key kept. */
function expectedCopyColumn(key: string, objectName: string, value: unknown): unknown {
  const parsed = parse(value);
  if (isAudit(key)) return omitted(objectName, parsed);
  const pair = parsed as Row;
  return {
    ...pair,
    ...('old' in pair ? { old: omitted(objectName, pair.old) } : {}),
    ...('new' in pair ? { new: omitted(objectName, pair.new) } : {}),
  };
}

function runCommand(file: string, args: string[]): { status: number | null; report: Record<string, any> | undefined; out: string } {
  const res = spawnSync(process.execPath, [CLI_BIN, 'migrate', 'audit-key-material', '--database-url', `file:${file}`, '--json', ...args], {
    cwd: SHOWCASE_DIR,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  let report: Record<string, any> | undefined;
  try {
    report = (JSON.parse(res.stdout) as { report?: Record<string, any> }).report;
  } catch {
    report = undefined;
  }
  // stdout is the counts-only report; stderr is the boot's own log. Neither is
  // printed on success, and on a failure only its tail is named.
  return { status: res.status, report, out: `${res.stdout.slice(-2000)}\n${res.stderr.slice(-2000)}` };
}

describe('os migrate audit-key-material over an 18.0 database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-audit-key-material-'));
  const file = join(dir, 'fixture.db');
  let fixture: Snapshot;
  let fixtureCopies: { audit: number; activity: number };

  beforeAll(() => {
    loadSqlIntoSqlite(fixtureSql, file);
    // The fixture travels as a dump of its TABLES, so it carries no view; the
    // 18.0 server that wrote it left `sys_activity` as the read view over its
    // rotation shards, and every boot rebuilds it. The dry run boots read-only
    // and creates nothing, so the view is put back as the server left it
    // before anything reads the copy.
    const db = new DatabaseSync(file);
    try {
      const shards = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sys_activity__r%' ORDER BY name DESC").all() as Array<{ name: string }>).map((r) => r.name);
      db.exec(`CREATE VIEW "sys_activity" AS ${shards.map((s) => `SELECT * FROM "${s}"`).join(' UNION ALL ')}`);
    } finally {
      db.close();
    }
    fixture = snapshot(file);
    fixtureCopies = keyMaterialCopies(fixture);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('0. the 18.0 fixture holds copies carrying a key-material column on both tables', () => {
    expect(fixtureCopies.audit, 'sys_audit_log copies carrying a key-material column').toBeGreaterThan(0);
    expect(fixtureCopies.activity, 'sys_activity copies carrying a key-material column').toBeGreaterThan(0);
  });

  it('1. the dry run counts them and writes nothing', () => {
    const dry = runCommand(file, []);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.report?.apply).toBe(false);
    expect(dry.report?.byObject?.sys_audit_log?.rewritten).toBe(fixtureCopies.audit);
    expect(dry.report?.byObject?.sys_activity?.rewritten).toBe(fixtureCopies.activity);
    expect(isDeepStrictEqual(snapshot(file), fixture), 'every audit/activity row is byte-identical after the dry run').toBe(true);
  }, 300_000);

  it('2. --apply leaves 0 copies carrying one, and moves no byte but the removed columns', () => {
    const run = runCommand(file, ['--apply', '--yes']);
    expect(run.status, run.out).toBe(0);
    expect(run.report?.failures).toBe(0);
    expect(run.report?.rewritten).toBe(fixtureCopies.audit + fixtureCopies.activity);

    const after = snapshot(file);
    expect(keyMaterialCopies(after), 'copies carrying a key-material column after the rewrite').toEqual({ audit: 0, activity: 0 });
    expect([...after.keys()], 'no row added or removed').toEqual([...fixture.keys()]);

    let rewritten = 0;
    for (const [key, before] of fixture) {
      const now = after.get(key)!;
      const copyColumns = copyColumnsOf(key);
      const touched = copyColumns.some((c) => now[c] !== before[c]);
      if (touched) rewritten += 1;
      // Every column but the copy column, byte for byte.
      for (const column of Object.keys(before)) {
        if (touched && copyColumns.includes(column)) continue;
        expect(now[column] === before[column], `${key}.${column} is byte-identical`).toBe(true);
      }
      if (!touched) continue;
      const objectName = String(before.object_name);
      expect(KEY_MATERIAL.has(objectName), `${key} is a copy of a listed object's row`).toBe(true);
      // In the copy column, only the key-material keys moved: removed.
      for (const column of copyColumns) {
        expect(
          isDeepStrictEqual(parse(now[column]), expectedCopyColumn(key, objectName, before[column])),
          `${key}.${column} differs from the fixture only by its removed key-material keys`,
        ).toBe(true);
      }
    }
    expect(rewritten).toBe(fixtureCopies.audit + fixtureCopies.activity);
  }, 300_000);

  it('3. a second --apply rewrites nothing and changes no byte', () => {
    const before = snapshot(file);
    const again = runCommand(file, ['--apply', '--yes']);
    expect(again.status, again.out).toBe(0);
    expect(again.report?.rewritten).toBe(0);
    expect(again.report?.failures).toBe(0);
    expect(isDeepStrictEqual(snapshot(file), before), 'every audit/activity row is byte-identical after the re-run').toBe(true);
  }, 300_000);
});
