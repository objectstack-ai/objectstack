// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isExitSignal } from '../../utils/format.js';
import { COMMENT_REACTIONS_MIGRATION_ID } from '../../utils/comment-reactions-conversion.js';
import MigrateApply from './apply.js';
import MigrateCommentReactions from './comment-reactions.js';

// Pay the first transform of the dist-resolved workspace deps the commands
// reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';
import '@objectstack/plugin-security';
import '@objectstack/plugin-audit';

/**
 * [#23281] The v18 upgrade keeps the emoji reactions a 17.x deployment stored
 * in `sys_comment.reactions`: `os migrate comment-reactions` carries them into
 * `sys_comment_reaction` records, and `os migrate apply --allow-destructive`
 * drops the column only after that command has recorded a verified run.
 *
 * ## The database
 *
 * The schema a v18 boot creates (`os migrate apply --yes` over an empty file,
 * the composition `os serve` mounts with an auth secret, so plugin-audit's
 * objects are among it), then the 17.x leftover planted by hand: the
 * `reactions` TEXT column v17's textarea declared, and comment rows holding
 * what a v17 client wrote there, `JSON.stringify({ [emoji]: userIds[] })`.
 * Two users exist; one stored id names nobody. The raw column read is the
 * point, so it is a real SQLite file under the SQL driver the commands boot.
 *
 * ## The cases run in order over ONE database, as an operator runs the steps
 *
 *  1. the drop is refused before any conversion;
 *  2. a dry run reports and writes nothing;
 *  3. `--apply` writes one row per stored (comment, emoji, user), in the
 *     comment's organization and owned by the reactor, lists every value that
 *     did not read with its comment id, invents nothing for it, and records an
 *     UNVERIFIED run;
 *  4. a re-run inserts nothing;
 *  5. the drop is still refused while values are unreadable;
 *  6. once the operator resolves them, a run is recorded verified;
 *  7. and the drop proceeds, the reaction rows intact.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os23281-integration-secret-at-least-32-chars';

const ORG = 'org_rx23281';
const ANN = 'u_rx_ann';
const BOB = 'u_rx_bob';
const THUMBS = '\u{1F44D}';
const PARTY = '\u{1F389}';
const HEART = '❤️';
const EYES = '\u{1F440}';
const ROCKET = '\u{1F680}';

/** What each comment's `reactions` column holds, as v17 stored it. */
const STORED: Record<string, string | null> = {
  rx_c1: JSON.stringify({ [THUMBS]: [ANN, BOB], [PARTY]: [BOB] }),
  // The same user twice under one emoji is one reaction.
  rx_c2: JSON.stringify({ [HEART]: [ANN, ANN] }),
  rx_c3: 'not json',
  rx_c4: JSON.stringify({ [THUMBS]: [BOB, 'u_rx_gone'], [ROCKET]: 3, [EYES]: [42] }),
  rx_c5: null,
  // What a client stored once the last reaction on a comment was taken back.
  rx_c6: '{}',
};

/** Every readable stored reaction, as `sys_comment_reaction` must hold it. */
const EXPECTED_ROWS = [
  { comment_id: 'rx_c1', emoji: PARTY, user_id: BOB },
  { comment_id: 'rx_c1', emoji: THUMBS, user_id: ANN },
  { comment_id: 'rx_c1', emoji: THUMBS, user_id: BOB },
  { comment_id: 'rx_c2', emoji: HEART, user_id: ANN },
  { comment_id: 'rx_c4', emoji: THUMBS, user_id: BOB },
].map((r) => ({ ...r, organization_id: ORG, created_by: r.user_id }));

/** Every stored value, or entry of one, that does not read. */
const EXPECTED_UNREADABLE = [
  { commentId: 'rx_c3', reason: 'not_json', stored: JSON.stringify('not json') },
  { commentId: 'rx_c4', reason: 'not_a_user_id', emoji: EYES, stored: '42' },
  { commentId: 'rx_c4', reason: 'unknown_user', emoji: THUMBS, stored: JSON.stringify('u_rx_gone') },
  { commentId: 'rx_c4', reason: 'not_a_user_list', emoji: ROCKET, stored: '3' },
];

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Env that would point a command's boot somewhere other than the fixture. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH',
] as const;

/** Run one command and capture its JSON document and exit status. */
async function runJson(command: Invoke, argv: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await command(argv);
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try {
      payload = JSON.parse(out);
    } catch {
      payload = { unparsed: out.slice(-400) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

let dir: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

function withDb<T>(fn: (db: Database.Database) => T, readonly = true): T {
  const db = new Database(dbFile, { readonly });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Insert a row, filling every other NOT NULL column without a default with a placeholder of its type. */
function plant(db: Database.Database, table: string, values: Record<string, unknown>): void {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<
    { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }
  >;
  const row: Record<string, unknown> = { ...values };
  for (const c of columns) {
    if (c.name in row || !c.notnull || c.dflt_value !== null) continue;
    row[c.name] = /INT|BOOL|REAL|NUM/i.test(c.type) ? 0 : `${c.name}-placeholder`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((n) => row[n] as never));
}

const hasReactionsColumn = (): boolean =>
  withDb((db) => (db.prepare("PRAGMA table_info('sys_comment')").all() as Array<{ name: string }>).some((c) => c.name === 'reactions'));

const reactionRows = (): Array<Record<string, unknown>> =>
  withDb((db) => db.prepare(
    'SELECT comment_id, emoji, user_id, organization_id, created_by FROM sys_comment_reaction ORDER BY comment_id, emoji, user_id',
  ).all() as Array<Record<string, unknown>>);

const ledgerRow = (): Record<string, unknown> | undefined =>
  withDb((db) => db.prepare('SELECT id, verified_at, blocking FROM sys_migration WHERE id = ?').get(COMMENT_REACTIONS_MIGRATION_ID) as
    Record<string, unknown> | undefined);

/** Rows in the order `reactionRows()` reads them. */
const sorted = (rows: Array<Record<string, unknown>>) =>
  [...rows].sort((a, b) => {
    const ka = JSON.stringify([a.comment_id, a.emoji, a.user_id]);
    const kb = JSON.stringify([b.comment_id, b.emoji, b.user_id]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'os-23281-reactions-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os23281reactions', name: 'requires auth', version: '0.0.0', type: 'app' },",
      "  requires: ['auth'],",
      "  objects: [{ name: 'os23281_thing', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'),
  );
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  // `os serve` composes the auth family, and with it plugin-audit, only when an
  // auth secret resolves; the deployment this pins serves with one.
  process.env.OS_AUTH_SECRET = SECRET;
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  dbFile = join(dir, 'upgraded.db');
  process.chdir(dir);
  try {
    // The v18 schema, as the served composition declares it.
    const created = await runJson(invoke(MigrateApply), ['--database-url', `file:${dbFile}`, '--yes', '--json']);
    expect(created.exitCode, JSON.stringify(created.payload).slice(0, 400)).toBe(0);
  } finally {
    process.chdir(savedCwd);
  }

  // The 17.x leftover: the retired column and what v17 clients stored in it.
  withDb((db) => {
    db.exec('ALTER TABLE sys_comment ADD COLUMN reactions TEXT');
    for (const id of [ANN, BOB]) plant(db, 'sys_user', { id, email: `${id}@example.com`, name: id });
    for (const [id, reactions] of Object.entries(STORED)) {
      plant(db, 'sys_comment', {
        id, organization_id: ORG, thread_id: 'os23281_thing:t1', author_id: ANN, body: `comment ${id}`, reactions,
      });
    }
  }, false);
  expect(hasReactionsColumn(), 'fixture: the 17.x column').toBe(true);
  expect(reactionRows(), 'fixture: no reaction record yet').toEqual([]);
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

describe('the v18 upgrade carries stored sys_comment.reactions into sys_comment_reaction records (#23281)', () => {
  const db = () => `file:${dbFile}`;
  const dropArgv = () => ['--database-url', db(), '--allow-destructive', '--yes', '--json'];

  it('1. os migrate apply --allow-destructive refuses the drop before any conversion, and drops nothing', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateApply), dropArgv());
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_comment_reactions_unconverted',
      detail: 'No run of "os migrate comment-reactions --apply" is recorded on this database.',
      conversion: null,
      applied: [],
      created: [],
    });
    expect(hasReactionsColumn()).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('2. a dry run reports every stored reaction and writes nothing', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateCommentReactions), ['--database-url', db(), '--json']);
    // Values that do not read keep the drop closed, so the run is not clean.
    expect(exitCode).toBe(1);
    expect(payload.report).toMatchObject({
      apply: false,
      scannedComments: 6,
      commentsWithReactions: 4,
      storedReactions: 5,
      alreadyConverted: 0,
      converted: 5,
      collapsedDuplicates: 1,
      failures: [],
    });
    expect(payload.report.unreadable).toEqual(expect.arrayContaining(EXPECTED_UNREADABLE));
    expect(payload.report.unreadable).toHaveLength(EXPECTED_UNREADABLE.length);
    expect(payload).toMatchObject({ check: null, verified: null, flag: null });
    expect(reactionRows()).toEqual([]);
    expect(ledgerRow()).toBeUndefined();
  }, CASE_TIMEOUT_MS);

  it('3. --apply writes one record per stored reaction, lists what did not read, and invents nothing for it', async () => {
    const { payload, exitCode } = await runJson(
      invoke(MigrateCommentReactions), ['--apply', '--yes', '--database-url', db(), '--json'],
    );
    expect(exitCode).toBe(1);
    expect(payload.report).toMatchObject({ apply: true, storedReactions: 5, alreadyConverted: 0, converted: 5, failures: [] });
    // Each unreadable value is listed with its comment id.
    expect(payload.report.unreadable).toEqual(expect.arrayContaining(EXPECTED_UNREADABLE));
    expect(payload.report.unreadable).toHaveLength(EXPECTED_UNREADABLE.length);
    // Same comment, user and emoji; the comment's organization; owned by the reactor.
    // Nothing for `rx_c3`, and on `rx_c4` only the one entry that read.
    expect(reactionRows()).toEqual(sorted(EXPECTED_ROWS));
    // The read-back after the writes: everything readable converted, the rest unreadable.
    expect(payload.check).toMatchObject({ apply: false, storedReactions: 5, alreadyConverted: 5, converted: 0 });
    expect(payload.verified).toBe(false);
    expect(ledgerRow()).toEqual({
      id: COMMENT_REACTIONS_MIGRATION_ID, verified_at: null, blocking: EXPECTED_UNREADABLE.length,
    });
  }, CASE_TIMEOUT_MS);

  it('4. a re-run inserts nothing', async () => {
    const { payload } = await runJson(
      invoke(MigrateCommentReactions), ['--apply', '--yes', '--database-url', db(), '--json'],
    );
    expect(payload.report).toMatchObject({ storedReactions: 5, alreadyConverted: 5, converted: 0, failures: [] });
    expect(reactionRows()).toEqual(sorted(EXPECTED_ROWS));
  }, CASE_TIMEOUT_MS);

  it('5. the drop stays refused while a stored value does not read', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateApply), dropArgv());
    expect(exitCode).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_comment_reactions_unconverted',
      conversion: { id: COMMENT_REACTIONS_MIGRATION_ID, verified_at: null, blocking: EXPECTED_UNREADABLE.length },
      applied: [],
    });
    expect(hasReactionsColumn()).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('6. once the operator resolves the listed values, a run is recorded verified', async () => {
    // The operator's call, per listed value: clear one, keep the readable part of the other.
    withDb((handle) => {
      handle.prepare('UPDATE sys_comment SET reactions = NULL WHERE id = ?').run('rx_c3');
      handle.prepare('UPDATE sys_comment SET reactions = ? WHERE id = ?').run(JSON.stringify({ [THUMBS]: [BOB] }), 'rx_c4');
    }, false);
    const { payload, exitCode } = await runJson(
      invoke(MigrateCommentReactions), ['--apply', '--yes', '--database-url', db(), '--json'],
    );
    expect(exitCode).toBe(0);
    expect(payload.report).toMatchObject({ converted: 0, alreadyConverted: 5, unreadable: [], failures: [] });
    expect(payload.verified).toBe(true);
    expect(ledgerRow()).toMatchObject({ id: COMMENT_REACTIONS_MIGRATION_ID, blocking: 0, verified_at: expect.any(String) });
  }, CASE_TIMEOUT_MS);

  it('7. the drop then proceeds, and every reaction record survives it', async () => {
    const { payload, exitCode } = await runJson(invoke(MigrateApply), dropArgv());
    expect(exitCode).toBe(0);
    const dropped = (payload.applied ?? [])
      .filter((c: any) => c.table === 'sys_comment')
      .map((c: any) => `${c.op?.type}:${c.op?.column ?? c.column}`);
    expect(dropped).toEqual(['drop_column:reactions']);
    expect(hasReactionsColumn()).toBe(false);
    expect(reactionRows()).toEqual(sorted(EXPECTED_ROWS));
  }, CASE_TIMEOUT_MS);
});
