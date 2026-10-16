// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` on a stack whose `defineStack` call the current schema
 * ACCEPTS, and the authored-source load that serves it.
 *
 * It was measured on a spelling the load still converted: `driver: 'mongo'`
 * until #23543 F1, then a flow-level retry policy's `retryDelayMs` until F2
 * retired `retry-policy-converged` from the load path too. After F2 no load-path
 * conversion is a step the chain replays from its floor (`--from 16` replays
 * steps 17 and 18, and every entry of either is retired), so the defect's own
 * reading — the chain missing what the load converted — has no subject on this
 * tree. What the fix changed is read directly instead (see "What is pinned").
 *
 * ## The defect
 *
 * An accepted `defineStack` call runs the producer's load-time ADR-0087 D2
 * conversion pass before it returns. The authored-source shim handed that
 * result to the chain, so the chain started from a stack that was already
 * converted: `applied` came back empty, `--write` wrote nothing, and every
 * later load still printed the notice that sends the author to this command.
 * The fix keeps the call's argument beside its result, and the load starts
 * the default export from it.
 *
 * ## What is pinned
 *
 *  1. The fix, read where it lives: the authored-source load hands back the
 *     call's ARGUMENT, not the stack `defineStack` built. Every accepted call
 *     has a difference between the two whether or not anything converts: the
 *     strict parse fills the declared defaults into what it returns, and the
 *     argument carries only what the author wrote. Read off the default
 *     export, before the named-export merge (which spreads it into a new
 *     object), and only for the authored-source load.
 *  2. A stack defined twice starts from the innermost argument.
 *  3. The control: an already-canonical source writes nothing, and its
 *     `--json` summary equals the one the built stack gives.
 *  4. A stack the schema refuses for two spellings the chain converts (one
 *     step-17, one step-18): each conversion is applied once, both are
 *     written, and a stack defined twice is listed once.
 *
 * Retired at F2: "lists a conversion the load already applied; --write writes
 * it, and the load stops converting". Its first half has no subject (above);
 * its write / re-run / clean-reload half is pinned by case 4 at the same layer.
 *
 * The strict reload is read through `stackConversions`, the producer's own
 * record of what it converted, and not through the stderr notice: that notice
 * is printed once per process, so a second load in this file would be silent
 * whether or not it converted.
 *
 * In-process over the real command (`MigrateMeta.run`), against temp projects
 * that link the real `@objectstack/spec`: no process is spawned and no kernel
 * is booted, so this file sits in the `unit` tier.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import MigrateMeta, { applyMetaMigrationsToPackages } from '../src/commands/migrate/meta.js';
import { loadConfig } from '../src/utils/config.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const RUN_TIMEOUT = 120_000;

/** `packages/cli` depends on `@objectstack/spec`; resolved as a package, not a source path. */
const requireFromCli = createRequire(import.meta.url);
const SPEC_PACKAGE_ROOT = dirname(requireFromCli.resolve('@objectstack/spec/package.json'));

let root: string;
let specLink: string;
let caseSeq = 0;

function writeProject(files: Record<string, string>): string {
  const dir = join(root, `case-${++caseSeq}`);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/** Every file under a project, relative path → bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** `text` with `from` replaced by `to` — `from` must occur exactly once. */
function edit(text: string, from: string, to: string): string {
  const parts = text.split(from);
  expect(parts.length, `expected exactly one occurrence of ${JSON.stringify(from)}`).toBe(2);
  return parts.join(to);
}

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

/** Run the real command in-process, capturing both streams and any exit. */
async function runMeta(dir: string, flags: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const priorExitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    out.push(String(chunk));
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as never);
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  let exitCode: number | undefined;
  try {
    await MigrateMeta.run([join(dir, 'objectstack.config.ts'), ...flags], { root: CLI_ROOT });
  } catch (e: any) {
    if (typeof e?.oclif?.exit !== 'number') throw e;
    exitCode = e.oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (exitCode === undefined && typeof process.exitCode === 'number' && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
    process.exitCode = priorExitCode;
  }
  return {
    stdout: stripVTControlCharacters(out.join('\n')),
    stderr: stripVTControlCharacters(err.join('\n')),
    exitCode,
  };
}

/** A load with its stderr swallowed: the producer's notices are not what these pins read. */
async function quietLoad(dir: string, authoredSource = false) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return await loadConfig(join(dir, 'objectstack.config.ts'), authoredSource ? { authoredSource: true } : undefined);
  } finally {
    warn.mockRestore();
  }
}

const json = (run: Run): any => JSON.parse(run.stdout);
const sites = (list: Array<{ conversionId: string; path: string; from?: string; to?: string }>) =>
  list.map(({ conversionId, path, from, to }) => ({ conversionId, path, from, to }));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-load-conversions-'));
  mkdirSync(join(root, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(root, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
});

afterAll(() => {
  // Unlinked BEFORE the recursive remove: the symlink points at the real
  // `packages/spec`, and a cleanup must never follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

/**
 * A stack whose one non-canonical spelling is the flow-level retry policy's
 * `retryDelayMs`. The current schema REFUSES it at the `retryDelayMs`
 * tombstone (`retry-policy-converged` is retired from the load path, #23543
 * F2), and the chain's step 17 renames it `backoffMs`. {@link CANONICAL_SOURCE}
 * is the same stack as the author would write it today, which the schema
 * accepts.
 */
const RETRY_SOURCE = `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.probe.svc', name: 'Probe Service', namespace: 'probe', version: '1.0.0', type: 'module' },
  objects: [
    {
      name: 'probe_slot',
      label: 'Slot',
      fields: {
        name: { type: 'text', label: 'Name' },
      },
    },
  ],
  flows: [
    {
      name: 'probe_sync',
      label: 'Sync',
      type: 'autolaunched',
      errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 2000 },
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    },
  ],
});
`;

const RETRY_CONVERSION = 'retry-policy-converged';
const RETRY_SITE = { conversionId: RETRY_CONVERSION, path: 'flows[0].errorHandling.backoffMs', from: 'retryDelayMs', to: 'backoffMs' };
const AUTHORED_DELAY = 'retryDelayMs: 2000';
const CANONICAL_DELAY = 'backoffMs: 2000';
const CANONICAL_SOURCE = edit(RETRY_SOURCE, AUTHORED_DELAY, CANONICAL_DELAY);
/** The flow's policy exactly as the author wrote it … */
const AUTHORED_POLICY = { strategy: 'retry', maxRetries: 3, backoffMs: 2000 };
/** … and as the strict parse returns it: the declared defaults filled in. */
const BUILT_POLICY = { ...AUTHORED_POLICY, backoffMultiplier: 1, maxRetryDelayMs: 30000, jitter: false };
const TIME_SITE = {
  conversionId: 'time-default-utc-suffix-dropped',
  path: 'objects[0].fields.starts_at.defaultValue',
  from: '"10:00Z"',
  to: '"10:00"',
};

describe('an accepted stack: the authored-source load hands back what the author wrote', () => {
  it('reads the argument off the default export, before the named exports are merged', async () => {
    const dir = writeProject({
      'objectstack.config.ts': `${CANONICAL_SOURCE}\nexport const onEnable = async () => {};\n`,
    });

    const authored = await quietLoad(dir, true);
    expect(authored.config.flows[0].errorHandling).toEqual(AUTHORED_POLICY);
    expect(authored.namedExports).toEqual(['onEnable']);
    expect(typeof authored.config.onEnable).toBe('function');
    // The producer's mark and record are still read off the stack it built.
    expect(authored.stackProvenance).toBe(true);
    expect(authored.stackConversions).toEqual([]);

    // Every other command still reads the stack `defineStack` built.
    const strict = await quietLoad(dir);
    expect(strict.config.flows[0].errorHandling).toEqual(BUILT_POLICY);
  }, RUN_TIMEOUT);

  it('a stack defined twice starts from the innermost argument', async () => {
    const dir = writeProject({
      'objectstack.config.ts': edit(
        edit(CANONICAL_SOURCE, 'export default defineStack({', 'export default defineStack(defineStack({'),
        '\n});\n',
        '\n}));\n',
      ),
    });
    // The outer call's argument is the inner call's BUILT stack, defaults and all.
    const authored = await quietLoad(dir, true);
    expect(authored.config.flows[0].errorHandling).toEqual(AUTHORED_POLICY);

    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(out.applied).toEqual([]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});

describe('control: an already-canonical source', () => {
  const CANONICAL = CANONICAL_SOURCE;

  it('writes nothing, and its --json summary is the one the built stack gives', async () => {
    const dir = writeProject({ 'objectstack.config.ts': CANONICAL });
    const before = snapshot(dir);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(out.applied).toEqual([]);
    expect(out.write).toEqual({ status: 'written', files: [], written: [], manual: [], unexplained: [] });
    expect(snapshot(dir)).toEqual(before);

    // The chain over the stack `defineStack` built — where it started before
    // this change — reaches the same summary.
    const built = (await quietLoad(dir)).config as Record<string, unknown>;
    const old = applyMetaMigrationsToPackages(normalizeStackInput(built, { convert: false }), out.from, out.to);
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(out.applied).toEqual(plain(old.applied));
    expect(out.todos).toEqual(plain(old.todos));
    expect(out.absentTodos).toEqual(plain(old.absentTodos));
    expect(out.schemaValid).toBe(ObjectStackDefinitionSchema.safeParse(old.stack).success);
  }, RUN_TIMEOUT);
});

describe('a stack with two refused spellings the chain converts', () => {
  // The `time` default with the UTC suffix (step 18) and the flow's
  // `retryDelayMs` (step 17) are both refused by the current schema, so this
  // call hands its argument through. It carried a load-path spelling until
  // #23543 F2; with none left that the chain replays, both arms are refusals.
  const MIXED = edit(
    RETRY_SOURCE,
    "        name: { type: 'text', label: 'Name' },\n",
    "        name: { type: 'text', label: 'Name' },\n        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },\n",
  );

  it('applies each conversion once, and --write writes both', async () => {
    const dir = writeProject({ 'objectstack.config.ts': MIXED });

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([RETRY_SITE, TIME_SITE]);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([RETRY_SITE, TIME_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'objectstack.config.ts', sites: 2 }]);
    expect(readFileSync(join(dir, 'objectstack.config.ts'), 'utf8')).toBe(
      edit(edit(MIXED, "defaultValue: '10:00Z'", "defaultValue: '10:00'"), AUTHORED_DELAY, CANONICAL_DELAY),
    );

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);

    const strict = await quietLoad(dir);
    expect(strict.stackProvenance).toBe(true);
    expect(strict.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);

  it('a stack defined twice starts from the innermost argument, and is listed once', async () => {
    const dir = writeProject({
      'objectstack.config.ts': edit(
        edit(RETRY_SOURCE, 'export default defineStack({', 'export default defineStack(defineStack({'),
        '\n});\n',
        '\n}));\n',
      ),
    });
    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(out.applied)).toEqual([RETRY_SITE]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});
