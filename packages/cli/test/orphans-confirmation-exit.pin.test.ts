// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os db orphans --delete` and `os secret orphans --delete`, run without
 * their confirmation, delete nothing, write no export, exit 1 and name `--yes`.
 *
 * The sibling of `migrate-confirmation-exit.pin.test.ts`, whose population is
 * read from `src/commands/migrate/**` only. These two commands delete rows
 * behind the same `[y/N]` prompt and follow the same rule: a run that did not
 * get its confirmation (stdin is no terminal, no `--yes`) is a refused run and
 * exits 1, so a script, CI job or cron reading `$?` never takes it for a
 * delete. Before the fix the text face printed `Aborted — …` and exited 0;
 * the `--json` face already exited 1 with `confirmation_required`.
 *
 * An operator who answers `n` at the prompt declined on purpose: that run keeps
 * exit 0, as the migrate family's decline does.
 *
 * ## The population
 *
 * {@link ROSTER} names the command modules outside `src/commands/migrate` whose
 * `--delete` mode is gated by a `--yes` confirmation. The first case holds the
 * roster to the modules, read off the command classes' flags (a `delete` flag
 * and a `yes` flag), so a third such command fails here until it has a row.
 *
 * ## What runs for real, and what is replaced
 *
 * Each command runs through oclif in-process: its parse, its gate, `emitJson`
 * and `this.exit`. Replaced: the stack boot (a fake engine and driver whose
 * delete is observed), the orphan-detail plan's audit read, the secret
 * reference union, and the prompt's readline. `process.stdin.isTTY` is set by
 * each run, never inherited from the runner.
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): nothing is spawned and no kernel boots; the boot
 * is replaced through `vi.mock` and never value-imported here.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { isExitSignal } from '../src/utils/format.js';

// Pay the first load of what the commands `import()` at the point of use,
// outside any clocked case (`pnpm check:test-source-alias`).
import '@objectstack/objectql';
import '@objectstack/service-settings';
import '../src/utils/sys-secret-orphan-sweep.js';
import '../src/utils/sys-secret-holder-report.js';
// `oneShotSettingsPlugins()` reaches the serve command's crypto provider.
import '@objectstack/core';
import '../src/commands/serve.js';

const seams = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  planOrphanDetailSweep: vi.fn(),
  collectSecretReferenceUnion: vi.fn(),
  /** Every delete either command's fake reached, as `object/id`. */
  deleted: [] as string[],
  prompts: [] as string[],
  answer: { value: 'n' },
}));

vi.mock('../src/utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootSchemaStack: seams.bootSchemaStack,
}));
vi.mock('../src/utils/orphan-detail-sweep.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  planOrphanDetailSweep: seams.planOrphanDetailSweep,
}));
vi.mock('../src/utils/secret-reference-union.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  collectSecretReferenceUnion: seams.collectSecretReferenceUnion,
}));
// Constructed and handed to the (replaced) boot, never used.
vi.mock('@objectstack/platform-objects/plugin', () => ({ PlatformObjectsPlugin: class {} }));
// The `[y/N]` prompt. Reached only on a terminal: each `confirm()` answers
// `false` before it builds an interface when stdin is no TTY.
vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createInterface = () => ({
    question: (q: string, cb: (answer: string) => void) => {
      seams.prompts.push(q);
      cb(seams.answer.value);
    },
    close: () => {},
  });
  return { ...actual, createInterface };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const COMMANDS_DIR = resolve(HERE, '../src/commands');

// ---------------------------------------------------------------------------
// The population, read off the command classes
// ---------------------------------------------------------------------------

type Runnable = { flags?: Record<string, { type?: unknown }>; run(argv: string[], opts?: Config): Promise<unknown> };

/** Every non-migrate command module with a `--delete` mode behind `--yes`, keyed `topic name`. */
const POPULATION: string[] = [];
const COMMANDS = new Map<string, Runnable>();
for (const topic of readdirSync(COMMANDS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!topic.isDirectory() || topic.name === 'migrate') continue;
  for (const name of readdirSync(join(COMMANDS_DIR, topic.name)).sort()) {
    if (!name.endsWith('.ts') || /\.(test|spec)\.ts$/.test(name) || name.endsWith('.d.ts')) continue;
    // Membership is decided by flags, never source text, but only modules that
    // mention both flags are imported: oclif loads lazily and so does this.
    const file = join(COMMANDS_DIR, topic.name, name);
    const src = readFileSync(file, 'utf8');
    if (!/\bdelete:\s*Flags\.boolean/.test(src) || !/\byes:\s*Flags\.boolean/.test(src)) continue;
    const mod = (await import(file)) as { default?: unknown };
    if (typeof mod.default !== 'function') continue;
    const cls = mod.default as unknown as Runnable;
    if (cls.flags?.delete?.type === 'boolean' && cls.flags?.yes?.type === 'boolean') {
      const id = `${topic.name} ${basename(name, '.ts')}`;
      POPULATION.push(id);
      COMMANDS.set(id, cls);
    }
  }
}
POPULATION.sort();

const config = await Config.load({ root: PKG_ROOT });

const SCRATCH = mkdtempSync(join(tmpdir(), 'os-orphans-confirm-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
let exportSeq = 0;
const freshExport = (): string => join(SCRATCH, `export-${++exportSeq}.json`);

// ---------------------------------------------------------------------------
// Fixtures: one deletable row for each command
// ---------------------------------------------------------------------------

function stackWith(objectql: unknown, settings?: unknown) {
  return {
    kernel: {
      getService: (name: string): unknown => (name === 'objectql' ? objectql : name === 'settings' ? settings : undefined),
    },
    tableAbsent: () => false,
    shutdown: vi.fn(async () => {}),
  };
}

/** `os db orphans`: one orphan `os_line/li_1` whose master `os_order/o_gone` does not exist, no deeper detail. */
function arrangeDbOrphans(): void {
  const stored = new Map<string, Record<string, unknown>>([['os_line/li_1', { id: 'li_1', order: 'o_gone' }]]);
  const plan = {
    objects: ['os_line'], notRead: [], scanned: 1,
    orphans: [{ object: 'os_line', recordId: 'li_1', fields: [{ field: 'order', master: 'os_order', missingMasterId: 'o_gone' }], cascade: [] }],
    withheld: [], otherDangling: [], undetermined: 0, unreadableObjects: [], truncatedObjects: [], unscannedObjects: [],
    aborted: false, complete: true, notes: [], counts: { orphans: 1, deeperDetails: 0, withheld: 0, otherDangling: 0 },
  };
  seams.planOrphanDetailSweep.mockResolvedValue(plan);
  const engine = {
    getConfigs: () => ({}),
    inspectCascadeDelete: async (object: string, id: string) => [{ object, id }],
    getDriverForObject: () => ({
      findOne: async (object: string, q: { where: { id: string } }) => stored.get(`${object}/${q.where.id}`) ?? null,
    }),
    delete: async (object: string, q: { where: { id: string } }) => {
      seams.deleted.push(`${object}/${q.where.id}`);
      stored.delete(`${object}/${q.where.id}`);
    },
  };
  seams.bootSchemaStack.mockResolvedValue(stackWith(engine));
}

/** `os secret orphans`: one `sys_secret` row an encrypted setting declares and nothing references. */
function arrangeSecretOrphans(): void {
  seams.collectSecretReferenceUnion.mockResolvedValue({
    handleIds: new Set<string>(),
    references: [],
    families: {
      settings: { family: 'settings', status: 'enumerated', references: [] },
      'object-field': { family: 'object-field', status: 'enumerated', references: [] },
      datasource: { family: 'datasource', status: 'enumerated', references: [] },
      'audit-seal': { family: 'audit-seal', status: 'enumerated', references: [] },
    },
    complete: true,
    gaps: [],
  });
  const row = {
    id: 'sec_orphan_1', namespace: 'smtp', key: 'retired_token', alg: 'aes-256-gcm', version: 2,
    kms_key_id: 'kms_local', ciphertext: 'ENC(v1:pin)', created_at: '2026-01-01T00:00:00.000Z', rotated_at: null,
  };
  const engine = {
    getConfigs: () => ({}),
    getDriverForObject: (object: string) => (object === 'sys_secret'
      ? {
        find: async () => [{ ...row }],
        delete: async (o: string, id: string) => { seams.deleted.push(`${o}/${id}`); return true; },
      }
      : { find: async () => [] }),
  };
  seams.bootSchemaStack.mockResolvedValue(stackWith(engine, {
    listManifests: () => [{ namespace: 'smtp', specifiers: [{ key: 'retired_token', type: 'string', encrypted: true }] }],
  }));
}

interface Member {
  /** The `--delete` run, without its confirmation; the export path is appended. */
  argv: string[];
  arrange: () => void;
}

const ROSTER: Record<string, Member> = {
  'db orphans': { argv: ['--delete'], arrange: arrangeDbOrphans },
  'secret orphans': { argv: ['--delete', '--no-declared-datasources'], arrange: arrangeSecretOrphans },
};

// ---------------------------------------------------------------------------
// Driving one run
// ---------------------------------------------------------------------------

const OUTER_EXIT_CODE = process.exitCode;
const SGR = /\u001b\[[0-9;]*m/g;

async function drive(id: string, argv: string[], opts: { tty: boolean }): Promise<{ exit: number; output: string }> {
  const cls = COMMANDS.get(id);
  if (!cls) throw new Error(`no command module named ${id}`);
  const chunks: string[] = [];
  const capture = (...args: unknown[]): void => { chunks.push(args.map(String).join(' ')); };
  const write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
    capture(String(chunk));
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write;
  const spies: Array<{ mockRestore(): void }> = [
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
    vi.spyOn(process.stdout, 'write').mockImplementation(write),
    vi.spyOn(process.stderr, 'write').mockImplementation(write),
  ];
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: opts.tty, configurable: true, writable: true });
  process.exitCode = undefined;
  let exit: number;
  try {
    await cls.run(argv, config);
    exit = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (!isExitSignal(error)) throw error;
    exit = (error as { oclif: { exit: number } }).oclif.exit;
  } finally {
    for (const spy of spies) spy.mockRestore();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    process.exitCode = OUTER_EXIT_CODE;
  }
  return { exit, output: chunks.join('\n').replace(SGR, '') };
}

beforeEach(() => {
  for (const seam of [seams.bootSchemaStack, seams.planOrphanDetailSweep, seams.collectSecretReferenceUnion]) seam.mockReset();
  seams.deleted.length = 0;
  seams.prompts.length = 0;
  seams.answer.value = 'n';
});

/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

describe('the population: every non-migrate --delete mode behind --yes', () => {
  it('is exactly the roster — a new member names how its gate is reached before it can pass', () => {
    expect(POPULATION, 'discovered from the command classes\' flags').toEqual(Object.keys(ROSTER).sort());
  });
});

describe('a non-interactive --delete without --yes deletes nothing, writes no export, and exits 1', () => {
  it.each(Object.entries(ROSTER))('%s — text face: exit 1, names --yes', async (id, member) => {
    member.arrange();
    const exportPath = freshExport();

    const run = await drive(id, [...member.argv, '--export', exportPath], { tty: false });

    expect(run.exit, run.output).toBe(1);
    expect(run.output).toContain('--yes');
    expect(seams.deleted).toEqual([]);
    expect(existsSync(exportPath), 'no export is written').toBe(false);
    expect(seams.prompts, 'a non-interactive run never prompts').toEqual([]);
  }, RUN_TIMEOUT);

  it.each(Object.entries(ROSTER))('%s — --json face: exit 1, confirmation_required', async (id, member) => {
    member.arrange();
    const exportPath = freshExport();

    const run = await drive(id, [...member.argv, '--export', exportPath, '--json'], { tty: false });

    expect(run.exit, run.output).toBe(1);
    expect(run.output).toContain('confirmation_required');
    expect(seams.deleted).toEqual([]);
    expect(existsSync(exportPath)).toBe(false);
  }, RUN_TIMEOUT);
});

describe('controls', () => {
  it.each(Object.entries(ROSTER))('%s — with --yes the run deletes and exits 0, so the harness tells a refusal from a run', async (id, member) => {
    member.arrange();
    const exportPath = freshExport();

    const run = await drive(id, [...member.argv, '--export', exportPath, '--yes'], { tty: false });

    expect(run.exit, run.output).toBe(0);
    expect(seams.deleted).toHaveLength(1);
    expect(existsSync(exportPath)).toBe(true);
  }, RUN_TIMEOUT);

  it.each(Object.entries(ROSTER))('%s — a terminal answered n: prompted, nothing deleted, exit 0 — a decline keeps its code', async (id, member) => {
    member.arrange();
    const exportPath = freshExport();

    const run = await drive(id, [...member.argv, '--export', exportPath], { tty: true });

    expect(seams.prompts).toHaveLength(1);
    expect(run.exit, run.output).toBe(0);
    expect(seams.deleted).toEqual([]);
    expect(existsSync(exportPath)).toBe(false);
  }, RUN_TIMEOUT);
});
