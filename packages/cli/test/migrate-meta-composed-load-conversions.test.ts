// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` on a COMPOSED project —
 * `composeStacks([defineStack(…), …], { manifest: 'preserve' })` — and the
 * authored-source load that serves it (#22256, the composed half).
 *
 * It was measured on a package body carrying a spelling the load still
 * converted: `datasources[].driver: 'mongo'` until #23543 F1, then a flow-level
 * retry policy's `retryDelayMs` until F2 retired `retry-policy-converged` from
 * the load path too. After F2 no load-path conversion is a step the chain
 * replays from its floor (`--from 16` replays steps 17 and 18, and every entry
 * of either is retired), so the defect's own reading — the chain missing what
 * the load converted — has no subject on this tree. What the fix changed is
 * read directly instead (see "What is pinned").
 *
 * ## The defect
 *
 * `composeStacks` assembles each `packages[i].manifest` body from the stack its
 * input's `defineStack` call RETURNED, and that call runs the producer's
 * load-time ADR-0087 D2 conversion pass — when the schema accepts the input,
 * and again when the authored-source shim produces a refused input once more
 * in `strict: false` mode. So the chain started from a body that was already
 * converted: `applied` did not list the conversion, `--write` did not write
 * it, and every later load still printed the notice that sends the author to
 * this command. The fix produces every wrapped input again from what the
 * author wrote, through the producer's internal parameter that skips the pass,
 * so composition's own rule assembles the bodies from the authored source.
 *
 * ## What is pinned
 *
 *  1. Where the authored body comes from: the authored-source load assembles
 *     the package body from the input's ARGUMENT, and every other command's
 *     load from the stack `defineStack` built. Every accepted input has a
 *     difference between the two whether or not anything converts: the strict
 *     parse fills the declared defaults into what it returns, and the argument
 *     carries only what the author wrote.
 *  2. An accepted input defined twice starts from the innermost argument.
 *  3. A refused input (re-produced by the shim) carrying two spellings the
 *     chain converts (one step-17, one step-18): each conversion is listed
 *     once, both are written into the input's own file and nothing else, and
 *     a refused input defined twice is listed once.
 *  4. The control: an already-canonical composed project writes nothing, and
 *     its `--json` summary equals the one the built composition gives.
 *
 * Retired at F2: "an accepted input: lists a conversion the load already
 * applied; --write writes it into the input's file, and the load stops
 * converting". Its first half has no subject (above); its write / re-run /
 * clean-reload half is pinned by case 3 at the same layer.
 *
 * The strict reload is read through `stackConversions`, the producers' own
 * record of what they converted, and not through the stderr notice: that
 * notice is printed once per process.
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

/** A load with its stderr swallowed: the producers' notices are not what these pins read. */
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
const bodyErrorHandling = (config: any): Record<string, unknown> => config.packages[0].manifest.flows[0].errorHandling;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-composed-load-conversions-'));
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
 * The service package, whose one non-canonical spelling is the flow-level retry
 * policy's `retryDelayMs`. The current schema REFUSES it at the `retryDelayMs`
 * tombstone (`retry-policy-converged` is retired from the load path, #23543
 * F2), and the chain's step 17 renames it `backoffMs`.
 * {@link CANONICAL_SERVICE} is the same package as the author would write it
 * today, which the schema accepts.
 */
const SERVICE_STACK = `import { defineStack } from '@objectstack/spec';

export const ServiceStack = defineStack({
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

const APP_STACK = `import { defineStack } from '@objectstack/spec';

export const AppStack = defineStack({
  manifest: { id: 'com.probe.app', name: 'Probe App', namespace: 'probe', version: '1.0.0', type: 'app' },
  objects: [{ name: 'probe_room', label: 'Room', fields: { name: { type: 'text', label: 'Name' } } }],
});
`;

const CONFIG = `import { composeStacks } from '@objectstack/spec';
import { ServiceStack } from './src/service.stack.js';
import { AppStack } from './src/app.stack.js';

export default composeStacks([ServiceStack, AppStack], { manifest: 'preserve' });
`;

const composed = (service: string): Record<string, string> => ({
  'objectstack.config.ts': CONFIG,
  'src/service.stack.ts': service,
  'src/app.stack.ts': APP_STACK,
});

const RETRY_CONVERSION = 'retry-policy-converged';
const RETRY_BODY_SITE = {
  conversionId: RETRY_CONVERSION,
  path: 'packages[0].manifest.flows[0].errorHandling.backoffMs',
  from: 'retryDelayMs',
  to: 'backoffMs',
};
const AUTHORED_DELAY = 'retryDelayMs: 2000';
const CANONICAL_DELAY = 'backoffMs: 2000';
const CANONICAL_SERVICE = edit(SERVICE_STACK, AUTHORED_DELAY, CANONICAL_DELAY);
/** The flow's policy exactly as the author wrote it … */
const AUTHORED_POLICY = { strategy: 'retry', maxRetries: 3, backoffMs: 2000 };
/** … and as the strict parse returns it: the declared defaults filled in. */
const BUILT_POLICY = { ...AUTHORED_POLICY, backoffMultiplier: 1, maxRetryDelayMs: 30000, jitter: false };
const TIME_BODY_SITE = {
  conversionId: 'time-default-utc-suffix-dropped',
  path: 'packages[0].manifest.objects[0].fields.starts_at.defaultValue',
  from: '"10:00Z"',
  to: '"10:00"',
};

describe('an accepted input: the authored-source load assembles the body the author wrote', () => {
  it('the authored-source load’s package body is the input’s argument; every other load’s, the built stack', async () => {
    const dir = writeProject(composed(CANONICAL_SERVICE));

    const authored = await quietLoad(dir, true);
    expect(bodyErrorHandling(authored.config)).toEqual(AUTHORED_POLICY);
    expect(authored.stackProvenance).toBe(true);
    expect(authored.stackConversions).toEqual([]);

    const strict = await quietLoad(dir);
    expect(bodyErrorHandling(strict.config)).toEqual(BUILT_POLICY);
  }, RUN_TIMEOUT);

  it('an input defined twice starts from the innermost argument', async () => {
    const dir = writeProject(composed(edit(
      edit(CANONICAL_SERVICE, 'export const ServiceStack = defineStack({', 'export const ServiceStack = defineStack(defineStack({'),
      '\n});\n',
      '\n}));\n',
    )));
    // The outer call's argument is the inner call's BUILT stack, defaults and all.
    const authored = await quietLoad(dir, true);
    expect(bodyErrorHandling(authored.config)).toEqual(AUTHORED_POLICY);

    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(out.applied).toEqual([]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});

describe('a refused input the shim produces again, carrying two spellings the chain converts', () => {
  // The `time` default with the UTC suffix (step 18) and the flow's
  // `retryDelayMs` (step 17) are both refused by the current schema, so the
  // shim hands the call's argument through and produces it again in
  // `strict: false` mode for the composer. It carried a load-path spelling
  // until #23543 F2; with none left that the chain replays, both are refusals.
  const MIXED = edit(
    SERVICE_STACK,
    "        name: { type: 'text', label: 'Name' },\n",
    "        name: { type: 'text', label: 'Name' },\n        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },\n",
  );

  it('lists each conversion once, and --write writes both into the input’s file', async () => {
    const dir = writeProject(composed(MIXED));
    const before = snapshot(dir);

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([RETRY_BODY_SITE, TIME_BODY_SITE]);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([RETRY_BODY_SITE, TIME_BODY_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'src/service.stack.ts', sites: 2 }]);
    expect(snapshot(dir)).toEqual({
      ...before,
      'src/service.stack.ts': edit(
        edit(MIXED, "defaultValue: '10:00Z'", "defaultValue: '10:00'"),
        AUTHORED_DELAY,
        CANONICAL_DELAY,
      ),
    });

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);

    const strict = await quietLoad(dir);
    expect(strict.stackProvenance).toBe(true);
    expect(strict.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);

  it('an input defined twice starts from the innermost argument, and is listed once', async () => {
    const dir = writeProject(composed(edit(
      edit(SERVICE_STACK, 'export const ServiceStack = defineStack({', 'export const ServiceStack = defineStack(defineStack({'),
      '\n});\n',
      '\n}));\n',
    )));
    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(out.applied)).toEqual([RETRY_BODY_SITE]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});

describe('control: an already-canonical composed project', () => {
  const CANONICAL = CANONICAL_SERVICE;

  it('writes nothing, and its --json summary is the one the built composition gives', async () => {
    const dir = writeProject(composed(CANONICAL));
    const before = snapshot(dir);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(out.applied).toEqual([]);
    expect(out.write).toEqual({ status: 'written', files: [], written: [], manual: [], unexplained: [] });
    expect(snapshot(dir)).toEqual(before);

    // The chain over the composition the producers built — where it started
    // before this change — reaches the same summary.
    const built = (await quietLoad(dir)).config as Record<string, unknown>;
    const old = applyMetaMigrationsToPackages(normalizeStackInput(built, { convert: false }), out.from, out.to);
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(out.applied).toEqual(plain(old.applied));
    expect(out.todos).toEqual(plain(old.todos));
    expect(out.absentTodos).toEqual(plain(old.absentTodos));
    expect(out.schemaValid).toBe(ObjectStackDefinitionSchema.safeParse(old.stack).success);
  }, RUN_TIMEOUT);
});
