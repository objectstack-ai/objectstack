// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24693] `os migrate audit-mail-bodies` over an 18.0 database: the mail-log
// bodies the 18.0 audit writer copied in clear into `sys_audit_log` and
// `sys_activity` are masked at rest, and nothing else moves.
//
// ## What was measured
//
// The 18.0 fixture (`upgrade-harness/fixture-18.0/`) holds `sys_audit_log` and
// `sys_activity` copies of its `sys_email` rows — the verification and
// invitation mail its sign-ups and its invitation sent — with `body_text` /
// `body_html` in clear: the writer masked them only from #24625 on, and only on
// new writes. Those bodies carry the sign-in and invitation links.
//
// ## What is pinned, on a fresh copy of the fixture
//
//   0. The fixture holds clear copies on both tables (a vacuous fixture is no
//      pin).
//   1. The dry run counts them and writes nothing: every row of both tables is
//      byte-identical afterwards.
//   2. `--apply` leaves 0 copies holding a body in clear. A rewritten row
//      differs from the fixture in its copy column alone, and in that column
//      only in the body keys, which now read the mask; every other row of
//      both tables is byte-identical.
//   3. A second `--apply` masks nothing and changes no byte.
//
// The command runs as an operator runs it: the real binary, in the showcase's
// directory, over the database file — not a booted server, so the ownership
// boot guard's verdict on an 18.0 database is no part of it.
//
// ⛔ No body, link or token value appears in a title, an assertion message or a
// log line: every comparison is reported as a count or a boolean.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_MASK } from '@objectstack/spec/data';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
const fixtureSql = readFileSync(new URL('database.sql', FIXTURE), 'utf8');
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');

const MAIL_LOGS = ['sys_email', 'sys_identity_email'];
const BODY_FIELDS = ['body_text', 'body_html'] as const;

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

const holdsClearBody = (side: unknown): boolean =>
  !!side && typeof side === 'object' &&
  BODY_FIELDS.some((f) => f in (side as Row) && (side as Row)[f] != null && (side as Row)[f] !== SECRET_MASK);

/** Copy rows of a mail log holding a body in clear on any side, per table family. */
function clearCopies(snap: Snapshot): { audit: number; activity: number } {
  const out = { audit: 0, activity: 0 };
  for (const [key, row] of snap) {
    if (!MAIL_LOGS.includes(String(row.object_name))) continue;
    if (sidesOf(key, row).some(holdsClearBody)) out[isAudit(key) ? 'audit' : 'activity'] += 1;
  }
  return out;
}

/** `side` with each body key it carries masked as the writer masks it — the expected rewritten copy. */
function masked(side: unknown): unknown {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return side;
  const out: Row = { ...(side as Row) };
  for (const f of BODY_FIELDS) if (f in out) out[f] = out[f] == null ? null : SECRET_MASK;
  return out;
}

/** The copy column as the fixture holds it, with each side's body masked and every other key kept. */
function expectedCopyColumn(key: string, value: unknown): unknown {
  const parsed = parse(value);
  if (isAudit(key)) return masked(parsed);
  const pair = parsed as Row;
  return { ...pair, ...('old' in pair ? { old: masked(pair.old) } : {}), ...('new' in pair ? { new: masked(pair.new) } : {}) };
}

function runCommand(file: string, args: string[]): { status: number | null; report: Record<string, any> | undefined; out: string } {
  const res = spawnSync(process.execPath, [CLI_BIN, 'migrate', 'audit-mail-bodies', '--database-url', `file:${file}`, '--json', ...args], {
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

describe('[#24693] os migrate audit-mail-bodies over an 18.0 database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-audit-mail-bodies-'));
  const file = join(dir, 'fixture.db');
  let fixture: Snapshot;
  let fixtureClear: { audit: number; activity: number };

  beforeAll(() => {
    loadSqlIntoSqlite(fixtureSql, file);
    fixture = snapshot(file);
    fixtureClear = clearCopies(fixture);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('0. the 18.0 fixture holds mail-log copies with a clear body on both tables', () => {
    expect(fixtureClear.audit, 'sys_audit_log copies holding a clear body').toBeGreaterThan(0);
    expect(fixtureClear.activity, 'sys_activity copies holding a clear body').toBeGreaterThan(0);
  });

  it('1. the dry run counts them and writes nothing', () => {
    const dry = runCommand(file, []);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.report?.apply).toBe(false);
    expect(dry.report?.byObject?.sys_audit_log?.rewritten).toBe(fixtureClear.audit);
    expect(dry.report?.byObject?.sys_activity?.rewritten).toBe(fixtureClear.activity);
    expect(isDeepStrictEqual(snapshot(file), fixture), 'every audit/activity row is byte-identical after the dry run').toBe(true);
  }, 300_000);

  it('2. --apply leaves 0 clear copies, and moves no byte but the masked bodies', () => {
    const run = runCommand(file, ['--apply', '--yes']);
    expect(run.status, run.out).toBe(0);
    expect(run.report?.failures).toBe(0);
    expect(run.report?.rewritten).toBe(fixtureClear.audit + fixtureClear.activity);

    const after = snapshot(file);
    expect(clearCopies(after), 'copies holding a clear body after the cleanup').toEqual({ audit: 0, activity: 0 });
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
      expect(MAIL_LOGS.includes(String(before.object_name)), `${key} is a copy of a mail-log row`).toBe(true);
      // In the copy column, only the body keys moved, to the mask.
      for (const column of copyColumns) {
        expect(
          isDeepStrictEqual(parse(now[column]), expectedCopyColumn(key, before[column])),
          `${key}.${column} differs from the fixture only in its masked body keys`,
        ).toBe(true);
      }
    }
    expect(rewritten).toBe(fixtureClear.audit + fixtureClear.activity);
  }, 300_000);

  it('3. a second --apply masks nothing and changes no byte', () => {
    const before = snapshot(file);
    const again = runCommand(file, ['--apply', '--yes']);
    expect(again.status, again.out).toBe(0);
    expect(again.report?.rewritten).toBe(0);
    expect(again.report?.failures).toBe(0);
    expect(isDeepStrictEqual(snapshot(file), before), 'every audit/activity row is byte-identical after the re-run').toBe(true);
  }, 300_000);
});
