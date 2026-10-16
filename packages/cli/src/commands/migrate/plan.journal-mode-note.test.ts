// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate plan` — what its human face says about the database it read.
 *
 * A plan boots read-only (schema DDL deferred, no file brought into
 * existence), but the SQL driver's connect still switches a SQLite file to the
 * journal mode it asks for, which rewrites the file header and no row. So no
 * line a plan prints says that it wrote nothing: the lines that vouch for the
 * database claim no row or table, and on a SQLite target each is followed by
 * the note naming the switch. Three texts make that claim:
 *
 *  - the unmanaged-table section's closing line (`renderUnmanagedTables`);
 *  - the declaration boot's write-guard note when a plugin's contract write
 *    was refused ("— a plan writes no row or table");
 *  - the same note when a raw command was forwarded ("If those commands only
 *    read, no row or table was written").
 *
 * The two guard notes are the REAL guard's text: a `createDeclarationBootWriteGuard`
 * is armed over a fake driver, made to refuse one write or forward one raw
 * read, and disarmed. Only the boot, the occupancy probe and the unmanaged-table
 * READ are replaced; the command's control flow and the section's renderer run
 * for real. The `--json` document carries the same lines and no note.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import MigratePlan from './plan.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { collectUnmanagedTables, type UnmanagedTablesReport } from '../../utils/unmanaged-tables.js';
import { createDeclarationBootWriteGuard } from '../../utils/schema-migration-plugins.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

vi.mock('../../utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/schema-migrate.js')>()),
  bootSchemaStack: vi.fn(),
}));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({ probeMigrationTarget: vi.fn() }));
// The sweep's READ is replaced; its renderer is the real one.
vi.mock('../../utils/unmanaged-tables.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/unmanaged-tables.js')>()),
  collectUnmanagedTables: vi.fn(),
}));
// `run()` ends the process when the plan does (#13027); here it returns instead.
vi.mock('../../utils/one-shot-exit.js', () => ({ exitOneShotCommand: vi.fn(async () => undefined) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };

const UNMANAGED_LINE =
  'They are reported for information only — nothing here drops them, and a plan writes no row or table.';
const ONE_UNMANAGED: UnmanagedTablesReport = {
  status: 'read', prefixes: ['sys_'], physicalTables: 3, tables: [{ table: 'sys_legacy_widget' }],
};
const NONE_UNMANAGED: UnmanagedTablesReport = { status: 'read', prefixes: ['sys_'], physicalTables: 3, tables: [] };

/** A driver with its members on the PROTOTYPE, as every real driver's are. */
class FakeDriver {
  async create(_object: string, _data: Record<string, unknown>): Promise<Record<string, unknown>> { return {}; }
  async execute(_command: unknown): Promise<unknown> { return []; }
}

/** The real guard's note after `act` ran against a driver it armed. */
async function guardNote(act: (driver: FakeDriver) => Promise<unknown>): Promise<string> {
  const guard = createDeclarationBootWriteGuard();
  const driver = new FakeDriver();
  await (guard.plugin as { init(ctx: unknown): Promise<void> }).init({
    getServices: () => new Map<string, unknown>([['driver.default', driver]]),
  });
  await act(driver);
  const note = guard.disarm();
  expect(note).not.toBeNull();
  return note as string;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The guard warns once per refused or forwarded call; not under test here.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as never);
});
afterEach(() => {
  warn.mockRestore();
  vi.mocked(bootSchemaStack).mockReset();
  vi.mocked(collectUnmanagedTables).mockReset();
});

/** Boot onto a primary driver with `config`, composing `notes`. */
function wireBoot(config: Record<string, unknown>, notes: string[], unmanaged: UnmanagedTablesReport): void {
  vi.mocked(bootSchemaStack).mockResolvedValue({
    // The primary datasource's driver, as `SchemaStack.driver` carries it.
    driver: { config },
    drivers: [],
    dbLabel: 'test database',
    dbSource: { kind: 'flag' },
    schemaSync: 'deferred',
    telemetryDatabase: null,
    managedTableCount: 3,
    pendingSchemaWork: [],
    detectManagedDrift: async () => [],
    allObjects: () => [],
    composition: {
      plugins: [],
      hostConfigPath: '/srv/app/objectstack.config.ts',
      hostConfigLoaded: true,
      hostConfigError: null,
      servedBoot: { mirrored: false, reason: 'not-composed' },
      notes,
      coverage: null,
    },
    shutdown: vi.fn(async () => {}),
  } as never);
  vi.mocked(collectUnmanagedTables).mockResolvedValue(unmanaged);
}

/** One human-mode plan; every line `console.log` received, colour stripped. */
async function runHuman(): Promise<string[]> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await MigratePlan.run([], { root: CLI_ROOT });
    return log.mock.calls
      .map((c: unknown[]) => stripVTControlCharacters(c.map(String).join(' ')))
      .join('\n')
      .split('\n');
  } finally {
    log.mockRestore();
  }
}

/** One `--json` plan; the document it emitted. */
async function runJson(): Promise<Record<string, any>> {
  const chunks: string[] = [];
  // `emitJson` awaits the write's DRAIN callback, so the double invokes it.
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as typeof process.stdout.write);
  try {
    await MigratePlan.run(['--json'], { root: CLI_ROOT });
  } finally {
    stdout.mockRestore();
  }
  return JSON.parse(chunks.join('')) as Record<string, any>;
}

interface Text {
  name: string;
  /** The composed notes and the sweep's report this case boots with. */
  arrange: () => Promise<{ notes: string[]; unmanaged: UnmanagedTablesReport }>;
  /** The printed line that carries the claim, without its print indent. */
  line: (notes: string[]) => string;
  /** The claim as the text spells it. */
  claim: string;
}

const TEXTS: Text[] = [
  {
    name: 'the unmanaged-table section\'s closing line',
    arrange: async () => ({ notes: [], unmanaged: ONE_UNMANAGED }),
    line: () => UNMANAGED_LINE,
    claim: 'a plan writes no row or table',
  },
  {
    name: 'the write guard\'s note on a refused contract write',
    arrange: async () => ({
      notes: [await guardNote((d) => d.create('sys_metadata', { id: 'probe' }))],
      unmanaged: NONE_UNMANAGED,
    }),
    line: (notes) => notes[0]!,
    claim: 'Refused 1 write(s) during the declaration boot — a plan writes no row or table: create() on sys_metadata.',
  },
  {
    name: 'the write guard\'s note on a forwarded raw command',
    arrange: async () => ({
      notes: [await guardNote((d) => d.execute('SELECT count(*) FROM sys_metadata'))],
      unmanaged: NONE_UNMANAGED,
    }),
    line: (notes) => notes[0]!,
    claim: 'If those commands only read, no row or table was written; if one wrote, it landed.',
  },
];

describe('os migrate plan — the human face names no write it cannot vouch for', () => {
  for (const text of TEXTS) {
    it(`${text.name}: on a SQLite file it claims no row or table and is followed by the journal-mode note`, async () => {
      const { notes, unmanaged } = await text.arrange();
      const expected = text.line(notes);
      expect(expected).toContain(text.claim);
      expect(expected).not.toContain('nothing was written');
      expect(expected).not.toContain('writes nothing');

      wireBoot(SQLITE_CONFIG, notes, unmanaged);
      const lines = await runHuman();
      const printed = lines.filter((l) => l.includes(text.claim));
      expect(printed, lines.join('\n')).toEqual([`      ${expected} ${JOURNAL_MODE_SWITCH_NOTE}`]);
      // Once, after the claim — no other line of this plan carries it.
      expect(lines.join('\n').split(JOURNAL_MODE_SWITCH_NOTE)).toHaveLength(2);
    }, RUN_TIMEOUT);

    it(`${text.name}: on a target with no file header (PostgreSQL) it claims no row or table and names no switch`, async () => {
      const { notes, unmanaged } = await text.arrange();
      const expected = text.line(notes);

      wireBoot(POSTGRES_CONFIG, notes, unmanaged);
      const lines = await runHuman();
      const printed = lines.filter((l) => l.includes(text.claim));
      expect(printed, lines.join('\n')).toEqual([`      ${expected}`]);
      expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
    }, RUN_TIMEOUT);
  }

  it('--json carries the guard\'s note as it is, with no journal-mode note, on a SQLite file', async () => {
    const note = await guardNote((d) => d.create('sys_metadata', { id: 'probe' }));
    wireBoot(SQLITE_CONFIG, [note], ONE_UNMANAGED);
    const payload = await runJson();
    expect(payload.composition.notes).toEqual([note]);
    expect(payload.unmanagedTables).toEqual(ONE_UNMANAGED);
    expect(JSON.stringify(payload)).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, RUN_TIMEOUT);
});
