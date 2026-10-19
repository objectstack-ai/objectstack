// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — the command-level guards that decide whether a delete may run at
 * all, tested away from the boot they normally sit behind.
 *
 * The first two exist to stop an ANSWER being invented:
 *
 *  - `readDeclaredDatasources` must never turn an unreadable file into `[]`.
 *    `[]` is the host stating it has no code-declared datasources; a missing or
 *    malformed file is nobody having answered, and the union turns that into a
 *    declared gap that refuses the delete. Collapsing the two would make the
 *    union look complete while being quieter than it is.
 *  - `asDeletingDriver` refuses a driver that cannot delete instead of casting
 *    the union's READ-ONLY driver port into a writing one. The cast compiles
 *    and then throws partway through the delete loop, after the export has been
 *    written and some rows are already gone.
 *
 * The third is about the export WRITE itself. `--export` refuses a path that
 * already exists, but that check runs before the boot, the scan and the
 * confirmation — an arbitrarily long window before the bytes are written. The
 * write is therefore an EXCLUSIVE CREATE (`flag: 'wx'`), so a path that filled
 * up inside the window fails instead of truncating a file it does not own; the
 * `mode: 0o600` that keeps cipher material owner-only is applied by the OS only
 * at CREATION, so a truncating write would have inherited the squatter's owner
 * and permissions and put cipher material inside them.
 *
 * The last is what the human face says about the database. Either mode's
 * connect can switch a SQLite file's journal mode, which rewrites its header
 * and no row, so neither the report nor an abort says that nothing was
 * written; each names the switch on a SQLite target, and only there.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SecretOrphans, { asDeletingDriver, readDeclaredDatasources } from './orphans.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { collectSecretReferenceUnion } from '../../utils/secret-reference-union.js';
import type { SecretReferenceUnion } from '../../utils/secret-reference-union.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';

// The command's own control flow is the subject here, so only the two seams
// that would boot a database or walk a real engine are replaced. Everything
// that decides WHICH rows are deletable — `planSysSecretOrphanSweep`,
// `buildPreDeleteExport`, `collectEncryptedSpecifierRefs`, `isSecretHandle` —
// runs for real, from the same modules the command reaches at run time.
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/secret-reference-union.js', () => ({ collectSecretReferenceUnion: vi.fn() }));
// Constructed and handed to the (mocked) boot, never used — a stub keeps the
// platform-objects graph out of this file's import cost.
vi.mock('@objectstack/platform-objects/plugin', () => ({ PlatformObjectsPlugin: class {} }));
// The `--delete` confirmation, answered without a terminal: `undefined` leaves
// readline as it is.
const prompt = vi.hoisted(() => ({ answer: undefined as string | undefined }));
vi.mock('node:readline', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:readline')>();
  return {
    ...real,
    createInterface: ((...args: Parameters<typeof real.createInterface>) => (prompt.answer === undefined
      ? real.createInterface(...args)
      : { question: (_q: string, answer: (a: string) => void) => answer(prompt.answer as string), close: () => {} }
    )) as typeof real.createInterface,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'os-8103-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readDeclaredDatasources — an unreadable answer is never an empty one', () => {
  it('reads a bare array', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify([{ name: 'main', external: { credentialsRef: 'sys_secret:sec_1' } }]));
    expect(readDeclaredDatasources(file)).toEqual([
      { name: 'main', external: { credentialsRef: 'sys_secret:sec_1' } },
    ]);
  });

  it('reads the { datasources: [...] } wrapper', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify({ datasources: [{ name: 'analytics' }] }));
    expect(readDeclaredDatasources(file)).toEqual([{ name: 'analytics' }]);
  });

  it('an EMPTY array is a real answer and stays one', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, '[]');
    // The control that makes this assertion mean something: the same function
    // over a NON-empty file returns a non-empty list, so `[]` here is the
    // file's content and not a swallowed failure.
    expect(readDeclaredDatasources(file)).toEqual([]);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify([{ name: 'x' }]));
    expect(readDeclaredDatasources(other)).toHaveLength(1);
  });

  it('throws — never returns [] — for a missing file', () => {
    expect(() => readDeclaredDatasources(join(tempDir(), 'absent.json'))).toThrow(/no such file/);
  });

  it('throws — never returns [] — for malformed JSON', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, '{ not json');
    expect(() => readDeclaredDatasources(file)).toThrow(/does not parse as JSON/);
  });

  it('throws — never returns [] — for JSON that is not a datasource list', () => {
    const dir = tempDir();
    const file = join(dir, 'ds.json');
    writeFileSync(file, JSON.stringify({ nope: true }));
    expect(() => readDeclaredDatasources(file)).toThrow(/must hold an array/);
  });
});

describe('asDeletingDriver — a missing delete() is a refusal, not a cast', () => {
  it('accepts a driver that declares delete()', () => {
    const driver = { async find() { return []; }, async delete() { return true; } };
    expect(asDeletingDriver(driver)).toBe(driver);
  });

  it('refuses the union READ-ONLY port shape, which declares only find()', () => {
    // Exactly the shape `SecretReferenceDriverLike` describes. Positive
    // control: the accepting case above proves the predicate can say yes.
    expect(asDeletingDriver({ async find() { return []; } })).toBeNull();
  });

  it('refuses undefined and a non-callable delete', () => {
    expect(asDeletingDriver(undefined)).toBeNull();
    expect(asDeletingDriver(null)).toBeNull();
    expect(asDeletingDriver({ delete: 'yes' })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The export write: created, or not written at all
// ───────────────────────────────────────────────────────────────────────────

/**
 * One `sys_secret` row that the real sweep will judge deletable: its
 * `(namespace, key)` matches a declared ENCRYPTED settings specifier below
 * (attributable) and the union names no handle at all (unreferenced).
 */
const ORPHAN_ROW = {
  id: 'sec_orphan_1',
  namespace: 'smtp',
  key: 'retired_token',
  alg: 'aes-256-gcm',
  version: 2,
  kms_key_id: 'kms_local',
  ciphertext: 'ENC(v1:retired-token-cipher-material)',
  created_at: '2026-01-01T00:00:00.000Z',
  rotated_at: '2026-06-01T00:00:00.000Z',
};

/** What `settings.listManifests()` answers — the attribution half of the predicate. */
const SETTINGS_MANIFESTS = [
  { namespace: 'smtp', specifiers: [{ key: 'retired_token', type: 'string', encrypted: true }] },
];

/** A COMPLETE union that names no handle: the row really is unreferenced. */
const unreferencingCompleteUnion = (): SecretReferenceUnion => ({
  handleIds: new Set<string>(),
  references: [],
  families: {
    'settings': { family: 'settings', status: 'enumerated', references: [] },
    'object-field': { family: 'object-field', status: 'enumerated', references: [] },
    'datasource': { family: 'datasource', status: 'enumerated', references: [] },
  },
  complete: true,
  gaps: [],
});

/**
 * Drive one real `--delete --json` run against the fake seams.
 *
 * `duringBoot` runs inside the mocked boot, which is the window this file is
 * about: after the `existsSync` pre-check, before the export is written.
 */
async function runDelete(
  exportPath: string,
  opts: { duringBoot?: () => void } = {},
): Promise<{ removed: string[]; payload: Record<string, unknown> }> {
  const removed: string[] = [];

  vi.mocked(collectSecretReferenceUnion).mockResolvedValue(unreferencingCompleteUnion());
  vi.mocked(bootSchemaStack).mockImplementation(async () => {
    opts.duringBoot?.();
    const objectql = {
      getConfigs: () => ({}),
      getDriverForObject: (object: string) =>
        object === 'sys_secret'
          ? {
            async find() { return [{ ...ORPHAN_ROW }]; },
            async delete(_object: string, id: string) { removed.push(id); return true; },
          }
          : { async find() { return []; } },
    };
    return {
      kernel: {
        getService: (name: string) =>
          name === 'objectql' ? objectql
            : name === 'settings' ? { listManifests: () => SETTINGS_MANIFESTS }
              : undefined,
      },
      // `SchemaStack.tableAbsent`: nothing is deferred on a `--delete` boot, which is
      // the plain one, so no table is measured absent.
      tableAbsent: () => false,
      shutdown: async () => { /* nothing was booted */ },
    } as never;
  });

  const chunks: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(
    ((chunk: unknown, ...rest: unknown[]) => {
      chunks.push(String(chunk));
      const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
      done?.(null);
      return true;
    }) as never,
  );
  // `emitJson` sets `process.exitCode` on a refusal, and this process is the
  // test runner's — leaving it set would fail the whole suite from the outside.
  const savedExitCode = process.exitCode;
  try {
    await SecretOrphans.run(
      ['--delete', '--yes', '--json', '--no-declared-datasources', '--export', exportPath],
      { root: CLI_ROOT },
    );
  } finally {
    stdout.mockRestore();
    process.exitCode = savedExitCode;
  }

  const lines = chunks.join('').split('\n').filter((l) => l.trim() !== '');
  return { removed, payload: JSON.parse(lines[lines.length - 1]) as Record<string, unknown> };
}

describe('the pre-delete export is created exclusively, never written onto', () => {
  it('a path that filled up inside the window is refused, and every row survives', async () => {
    const file = join(tempDir(), 'export.json');
    // Distinct from anything the export can contain, in both directions: this
    // string is not a substring of the export document and the export document
    // is not a substring of it, so neither assertion below can pass by accident.
    const squatterBytes = 'SQUATTER-PAYLOAD not-an-export-document\n';

    const { removed, payload } = await runDelete(file, {
      duringBoot: () => writeFileSync(file, squatterBytes),
    });

    // The harm first, so an ablation of the flag reports the harm rather than
    // the envelope: no row is removed…
    expect(removed).toEqual([]);
    // …and the file that was there first is byte-for-byte intact.
    expect(readFileSync(file, 'utf8')).toBe(squatterBytes);
    // Then the envelope: it lands in the export_failed refusal that already
    // existed — no new branch, no new error code.
    expect(payload.error).toBe('export_failed');
    expect(String(payload.message)).toContain(file);
    // oclif builds its whole command table on the first `run()` in a process.
  }, 60_000);

  it('POSITIVE CONTROL — over an unclaimed destination the run does remove rows', async () => {
    // Without this, `removed` being empty above would also be satisfied by a
    // command that can never delete anything at all.
    const file = join(tempDir(), 'export.json');
    expect(existsSync(file)).toBe(false);

    const { removed, payload } = await runDelete(file);

    expect(payload.error).toBeUndefined();
    expect(removed).toEqual([ORPHAN_ROW.id]);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<Record<string, unknown>> };
    expect(doc.rows.map((r) => r.id)).toEqual([ORPHAN_ROW.id]);
    expect(doc.rows[0].ciphertext).toBe(ORPHAN_ROW.ciphertext);
    // `mode` survives the flag change: it is applied at creation, which is now
    // the only way this file is ever opened.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The human face: what the report and an abort say about the database
// ───────────────────────────────────────────────────────────────────────────

/** The primary datasource's driver config, as the boot's `SchemaStack.driver` carries it. */
const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };

/** Drive one human-mode run over the deletable orphan, with the boot's driver on `config`. */
async function runHuman(
  argv: string[],
  config: Record<string, unknown>,
): Promise<{ lines: string[]; removed: string[] }> {
  const removed: string[] = [];
  vi.mocked(collectSecretReferenceUnion).mockResolvedValue(unreferencingCompleteUnion());
  vi.mocked(bootSchemaStack).mockImplementation(async () => {
    const objectql = {
      getConfigs: () => ({}),
      getDriverForObject: (object: string) =>
        object === 'sys_secret'
          ? {
            async find() { return [{ ...ORPHAN_ROW }]; },
            async delete(_object: string, id: string) { removed.push(id); return true; },
          }
          : { async find() { return []; } },
    };
    return {
      driver: { config },
      kernel: {
        getService: (name: string) =>
          name === 'objectql' ? objectql
            : name === 'settings' ? { listManifests: () => SETTINGS_MANIFESTS }
              : undefined,
      },
      tableAbsent: () => false,
      shutdown: async () => { /* nothing was booted */ },
    } as never;
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const savedExitCode = process.exitCode;
  try {
    await SecretOrphans.run(argv, { root: CLI_ROOT });
    return { lines: log.mock.calls.map((c) => c.map(String).join(' ')), removed };
  } finally {
    process.exitCode = savedExitCode;
    for (const spy of [log, warn, error]) spy.mockRestore();
  }
}

describe('the human face names no write it cannot vouch for', () => {
  let savedIsTTY: PropertyDescriptor | undefined;
  beforeEach(() => {
    savedIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  });
  afterEach(() => {
    prompt.answer = undefined;
    if (savedIsTTY) Object.defineProperty(process.stdin, 'isTTY', savedIsTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  it('the report claims no row or table, and names the journal-mode switch on a SQLite file', async () => {
    const { lines } = await runHuman(['--no-declared-datasources'], SQLITE_CONFIG);
    const closing = lines.find((line) => line.includes('Report only'));
    expect(closing, lines.join('\n')).toContain(`Report only — no row or table was written or deleted. ${JOURNAL_MODE_SWITCH_NOTE}`);
    expect(lines.join('\n')).not.toContain('nothing was written');
  }, 60_000);

  it('on a target with no file header (PostgreSQL) the report claims no row or table and names no switch', async () => {
    const { lines } = await runHuman(['--no-declared-datasources'], POSTGRES_CONFIG);
    const closing = lines.find((line) => line.includes('Report only'));
    expect(closing, lines.join('\n')).toContain('Report only — no row or table was written or deleted.');
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, 60_000);

  it('a --delete declined at the prompt claims no export and no row, and names the switch on a SQLite file', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    prompt.answer = 'n';
    const exportPath = join(tempDir(), 'export.json');
    const { lines, removed } = await runHuman(
      ['--delete', '--no-declared-datasources', '--export', exportPath],
      SQLITE_CONFIG,
    );
    expect(removed).toEqual([]);
    expect(existsSync(exportPath)).toBe(false);
    const aborted = lines.find((line) => line.includes('Aborted'));
    expect(aborted, lines.join('\n')).toContain(`Aborted — no export was written and no row was deleted. ${JOURNAL_MODE_SWITCH_NOTE}`);
  }, 60_000);

  it('the help says the report writes no row or table, never that it writes nothing', () => {
    expect(SecretOrphans.description).toContain('Report-only by default: it writes no row or table and deletes nothing.');
    expect(SecretOrphans.flags.delete.description).toContain('(default is a report that writes no row or table)');
    expect(`${SecretOrphans.description} ${SecretOrphans.flags.delete.description}`).not.toContain('writes nothing');
  });
});
