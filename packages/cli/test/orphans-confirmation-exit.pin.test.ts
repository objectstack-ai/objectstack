// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every command outside `os migrate` whose writing mode waits for a
 * `--yes` confirmation (`os db orphans --delete`, `os secret orphans --delete`,
 * `os secret rewrap --apply`), run without it, writes nothing, exits 1 and
 * names `--yes`.
 *
 * The sibling of `migrate-confirmation-exit.pin.test.ts`, whose population is
 * read from `src/commands/migrate/**` only. These commands delete or re-write
 * rows behind the same `[y/N]` prompt and follow the same rule: a run that did
 * not get its confirmation (stdin is no terminal, no `--yes`) is a refused run
 * and exits 1, so a script, CI job or cron reading `$?` never takes it for a
 * run that did its work. Before the fix the text face printed `Aborted — …`
 * and exited 0; the `--json` face already exited 1 with
 * `confirmation_required`.
 *
 * An operator who answers `n` at the prompt declined on purpose: that run keeps
 * exit 0, as the migrate family's decline does.
 *
 * ## The population
 *
 * {@link ROSTER} names the command modules outside `src/commands/migrate` that
 * declare a boolean `yes` flag, whatever the mode flag it confirms is called
 * (`--delete`, `--apply`). The first case holds the roster to the modules, read
 * off the command classes' flags, so the next such command fails here until it
 * has a row that names how its confirmation gate is reached.
 *
 * ## What runs for real, and what is replaced
 *
 * Each command runs through oclif in-process: its parse, its gate, `emitJson`
 * and `this.exit`. Replaced: the stack boot (a fake engine and driver whose
 * delete or write is observed), the orphan-detail plan's audit read, the
 * secret reference union for `secret orphans` (`secret rewrap` runs the real
 * one over the fake engine, with its real planner, executor and local crypto
 * provider), and the prompt's readline. `process.stdin.isTTY` is set by each
 * run, never inherited from the runner.
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): nothing is spawned and no kernel boots; the boot
 * is replaced through `vi.mock` and never value-imported here.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
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
import '../src/utils/sys-secret-rewrap.js';
// …and what `os secret rewrap`'s one-shot crypto composition reaches through
// dynamic `import()`s (the host config reader and `serve.ts`).
import '@objectstack/driver-sql';
import '@objectstack/driver-turso';
import '@objectstack/plugin-security';
import '@objectstack/rest';
import '@objectstack/runtime';
import '@objectstack/service-datasource';

const seams = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  planOrphanDetailSweep: vi.fn(),
  collectSecretReferenceUnion: vi.fn(),
  /** Every delete or write a command's fake reached, as `object/id`. */
  written: [] as string[],
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
// The settings plugins `os secret orphans` composes into its boot: handed to
// the (replaced) boot and never used, and the real ones reach the serve
// command's crypto provider, a load no case here should pay. `oneShotCrypto`
// stays real: `os secret rewrap` seals and opens with the provider it chooses.
vi.mock('../src/utils/one-shot-settings.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  oneShotSettingsPlugins: async () => [],
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

/** Every non-migrate command module declaring a boolean `--yes`, keyed `topic name`. */
const POPULATION: string[] = [];
const COMMANDS = new Map<string, Runnable>();
for (const topic of readdirSync(COMMANDS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!topic.isDirectory() || topic.name === 'migrate') continue;
  for (const name of readdirSync(join(COMMANDS_DIR, topic.name)).sort()) {
    if (!name.endsWith('.ts') || /\.(test|spec)\.ts$/.test(name) || name.endsWith('.d.ts')) continue;
    // Membership is decided by flags, never source text, but only modules that
    // mention the flag are imported: oclif loads lazily and so does this.
    const file = join(COMMANDS_DIR, topic.name, name);
    const src = readFileSync(file, 'utf8');
    if (!/\byes:\s*Flags\.boolean/.test(src)) continue;
    const mod = (await import(file)) as { default?: unknown };
    if (typeof mod.default !== 'function') continue;
    const cls = mod.default as unknown as Runnable;
    if (cls.flags?.yes?.type === 'boolean') {
      const id = `${topic.name} ${basename(name, '.ts')}`;
      POPULATION.push(id);
      COMMANDS.set(id, cls);
    }
  }
}
POPULATION.sort();

const config = await Config.load({ root: PKG_ROOT });
const { collectSecretReferenceUnion: realReferenceUnion } =
  await vi.importActual<typeof import('../src/utils/secret-reference-union.js')>('../src/utils/secret-reference-union.js');

const SCRATCH = mkdtempSync(join(tmpdir(), 'os-orphans-confirm-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
let exportSeq = 0;
const freshExport = (): string => join(SCRATCH, `export-${++exportSeq}.json`);

// ---------------------------------------------------------------------------
// Fixtures: one deletable or re-wrappable row for each command
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
      seams.written.push(`${object}/${q.where.id}`);
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
        delete: async (o: string, id: string) => { seams.written.push(`${o}/${id}`); return true; },
      }
      : { find: async () => [] }),
  };
  seams.bootSchemaStack.mockResolvedValue(stackWith(engine, {
    listManifests: () => [{ namespace: 'smtp', specifiers: [{ key: 'retired_token', type: 'string', encrypted: true }] }],
  }));
}

/** The data key `os secret rewrap` seals and opens with, handed in as `OS_SECRET_KEY`. */
const KEY_HEX = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f';
const KEY_ENV = ['OS_SECRET_KEY', 'OS_DEV_CRYPTO_KEY', 'OBJECTSTACK_DEV_CRYPTO_KEY', 'OS_HOME', 'OBJECTSTACK_HOME', 'OS_CRYPTO_AUTOKEY'] as const;
const savedKeyEnv: Record<string, string | undefined> = {};
for (const k of KEY_ENV) savedKeyEnv[k] = process.env[k];
afterEach(() => {
  for (const k of KEY_ENV) {
    if (savedKeyEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeyEnv[k];
  }
});

/** A ciphertext sealed under the version-1 AAD, `(namespace, key)` alone: a row `rewrap` re-wraps. */
function sealVersion1(plain: string, namespace: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY_HEX, 'hex'), iv);
  cipher.setAAD(Buffer.from([namespace, key].join('|'), 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

/**
 * What the replaced boot still does for `rewrap`'s crypto: the host's
 * crypto-provider seam (`os serve`'s) is initialized and its `kernel:ready`
 * hook fired, with no plugin registering a provider, so the run's provider is
 * the local one over `OS_SECRET_KEY`.
 */
async function driveHostCrypto(plugins: readonly unknown[]): Promise<void> {
  const host = plugins.find((p) => (p as { name?: unknown }).name === 'com.objectstack.cli.host-crypto-provider') as
    { init(ctx: unknown): Promise<void> } | undefined;
  if (!host) throw new Error('the run composed no host crypto-provider seam');
  const ready: Array<() => unknown> = [];
  await host.init({ getServices: () => new Map(), hook: (_name: string, handler: () => unknown) => ready.push(handler) });
  for (const handler of ready) await handler();
}

/** `os secret rewrap`: one version-1 `sys_secret` row its settings holder references, so the plan has one attempt. */
function arrangeSecretRewrap(): void {
  for (const k of KEY_ENV) delete process.env[k];
  process.env.OS_HOME = mkdtempSync(join(SCRATCH, 'home-'));
  process.env.OS_SECRET_KEY = KEY_HEX;
  seams.collectSecretReferenceUnion.mockImplementation(realReferenceUnion);
  let secrets: Array<Record<string, unknown>> = [{
    id: 'sec_v1', namespace: 'smtp', key: 'password', kms_key_id: 'local:v1', alg: 'aes-256-gcm',
    version: 1, ciphertext: sealVersion1('pin-plaintext', 'smtp', 'password'),
  }];
  const settings = [{ id: 'set_1', namespace: 'smtp', key: 'password', scope: 'tenant', user_id: null, value_enc: 'sec_v1' }];
  const secretDriver = {
    find: async () => secrets.map((r) => ({ ...r })),
    updateMany: async (object: string, query: { where: Record<string, unknown> }, data: Record<string, unknown>) => {
      seams.written.push(`${object}/${String(query.where.id)}`);
      let changed = 0;
      secrets = secrets.map((r) => {
        if (r.id !== query.where.id || r.ciphertext !== query.where.ciphertext) return r;
        changed += 1;
        return { ...r, ...data };
      });
      return changed;
    },
  };
  const engine = {
    getConfigs: () => ({}),
    listDatasourceDefs: () => [],
    getDriverForObject: (object: string) => {
      if (object === 'sys_secret') return secretDriver;
      if (object === 'sys_setting') return { find: async () => settings.map((r) => ({ ...r })) };
      if (object === 'sys_platform_setting' || object === 'sys_metadata') return { find: async () => [] };
      return undefined;
    },
  };
  seams.bootSchemaStack.mockImplementation(async (opts: { extraPlugins?: unknown[] }) => {
    await driveHostCrypto(opts.extraPlugins ?? []);
    return stackWith(engine);
  });
}

interface Member {
  /** The writing run, without its confirmation. */
  argv: string[];
  /** The mode writes an export first (`--export PATH` is appended), and the refusal must leave none. */
  exports: boolean;
  arrange: () => void;
}

const ROSTER: Record<string, Member> = {
  'db orphans': { argv: ['--delete'], exports: true, arrange: arrangeDbOrphans },
  'secret orphans': { argv: ['--delete', '--no-declared-datasources'], exports: true, arrange: arrangeSecretOrphans },
  'secret rewrap': { argv: ['--apply', '--no-declared-datasources'], exports: false, arrange: arrangeSecretRewrap },
};

/** The member's argv, with a fresh export path when its mode writes one; that path, or null. */
function argvOf(member: Member, ...extra: string[]): { argv: string[]; exportPath: string | null } {
  const exportPath = member.exports ? freshExport() : null;
  return { argv: [...member.argv, ...(exportPath ? ['--export', exportPath] : []), ...extra], exportPath };
}
const exported = (exportPath: string | null): boolean => exportPath !== null && existsSync(exportPath);

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
  seams.written.length = 0;
  seams.prompts.length = 0;
  seams.answer.value = 'n';
});

/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

describe('the population: every non-migrate command that declares --yes', () => {
  it('is exactly the roster — a new member names how its gate is reached before it can pass', () => {
    expect(POPULATION, 'discovered from the command classes\' flags').toEqual(Object.keys(ROSTER).sort());
  });
});

describe('a non-interactive run without --yes writes nothing, writes no export, and exits 1', () => {
  it.each(Object.entries(ROSTER))('%s — text face: exit 1, names --yes', async (id, member) => {
    member.arrange();
    const { argv, exportPath } = argvOf(member);

    const run = await drive(id, argv, { tty: false });

    expect(run.exit, run.output).toBe(1);
    expect(run.output).toContain('--yes');
    expect(seams.written).toEqual([]);
    expect(exported(exportPath), 'no export is written').toBe(false);
    expect(seams.prompts, 'a non-interactive run never prompts').toEqual([]);
  }, RUN_TIMEOUT);

  it.each(Object.entries(ROSTER))('%s — --json face: exit 1, confirmation_required', async (id, member) => {
    member.arrange();
    const { argv, exportPath } = argvOf(member, '--json');

    const run = await drive(id, argv, { tty: false });

    expect(run.exit, run.output).toBe(1);
    expect(run.output).toContain('confirmation_required');
    expect(seams.written).toEqual([]);
    expect(exported(exportPath)).toBe(false);
  }, RUN_TIMEOUT);
});

describe('controls', () => {
  it.each(Object.entries(ROSTER))('%s — with --yes the run writes and exits 0, so the harness tells a refusal from a run', async (id, member) => {
    member.arrange();
    const { argv, exportPath } = argvOf(member, '--yes');

    const run = await drive(id, argv, { tty: false });

    expect(run.exit, run.output).toBe(0);
    expect(seams.written).toHaveLength(1);
    expect(exported(exportPath)).toBe(member.exports);
  }, RUN_TIMEOUT);

  it.each(Object.entries(ROSTER))('%s — a terminal answered n: prompted, nothing written, exit 0 — a decline keeps its code', async (id, member) => {
    member.arrange();
    const { argv, exportPath } = argvOf(member);

    const run = await drive(id, argv, { tty: true });

    expect(seams.prompts).toHaveLength(1);
    expect(run.exit, run.output).toBe(0);
    expect(seams.written).toEqual([]);
    expect(exported(exportPath)).toBe(false);
  }, RUN_TIMEOUT);
});
