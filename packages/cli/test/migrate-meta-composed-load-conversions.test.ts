// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` on a COMPOSED project —
 * `composeStacks([defineStack(…), …], { manifest: 'preserve' })` — whose
 * package body carries a spelling the load still converts
 * (`datasources[].driver: 'mongo'`) (#22256, the composed half).
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
 *  1. An accepted input: the conversion is listed under the body's path,
 *     `--write` writes it into the input's own file and nothing else, the
 *     re-run applies nothing, and a strict load converts nothing any more.
 *  2. Where the authored body comes from: the authored-source load's body
 *     carries the authored spelling, and every other command's load still
 *     carries the converted one.
 *  3. A refused input (re-produced by the shim) carrying the same spelling
 *     beside a refused one: each conversion is listed once and both are
 *     written.
 *  4. An input defined twice starts from the innermost argument, once.
 *  5. The control: an already-canonical composed project writes nothing, and
 *     its `--json` summary equals the one the built composition gives.
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
const conversionIds = (list: readonly { conversionId: string }[]) => list.map((c) => c.conversionId);
const bodyDriver = (config: any): string => config.packages[0].manifest.datasources[0].driver;

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
 * The service package: a stack the current schema accepts, whose one
 * non-canonical spelling is a datasource driver id the load still converts
 * (`retiredFromLoadPath: false`); the `url` is what makes a mongo datasource
 * valid, so the call is accepted.
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
  datasources: [{ name: 'docs', label: 'Docs', driver: 'mongo', config: { url: 'mongodb://mongo.internal:27017/docs' } }],
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

const MONGO_CONVERSION = 'datasource-driver-mongo-to-mongodb';
const MONGO_BODY_SITE = {
  conversionId: MONGO_CONVERSION,
  path: 'packages[0].manifest.datasources[0].driver',
  from: 'mongo',
  to: 'mongodb',
};
const TIME_BODY_SITE = {
  conversionId: 'time-default-utc-suffix-dropped',
  path: 'packages[0].manifest.objects[0].fields.starts_at.defaultValue',
  from: '"10:00Z"',
  to: '"10:00"',
};

describe('an accepted input: the chain reads the package body as the author wrote it', () => {
  it('lists a conversion the load already applied; --write writes it into the input’s file, and the load stops converting', async () => {
    const dir = writeProject(composed(SERVICE_STACK));
    const before = snapshot(dir);

    // The control for the last reading below: today the strict load converts it.
    const strictBefore = await quietLoad(dir);
    expect(strictBefore.stackProvenance).toBe(true);
    expect(conversionIds(strictBefore.stackConversions)).toEqual([MONGO_CONVERSION]);

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([MONGO_BODY_SITE]);
    expect(dry.schemaValid).toBe(true);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([MONGO_BODY_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'src/service.stack.ts', sites: 1 }]);
    expect(out.write.manual).toEqual([]);
    expect(out.write.unexplained).toEqual([]);

    // The site and nothing else: every other file keeps its bytes.
    expect(snapshot(dir)).toEqual({
      ...before,
      'src/service.stack.ts': edit(before['src/service.stack.ts']!, "driver: 'mongo'", "driver: 'mongodb'"),
    });

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);
    expect(again.schemaValid).toBe(true);

    // The load every other command uses — strict, no shim — converts nothing now.
    const strictAfter = await quietLoad(dir);
    expect(strictAfter.stackProvenance).toBe(true);
    expect(strictAfter.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);

  it('the authored-source load’s package body carries the authored spelling; every other load’s, the converted one', async () => {
    const dir = writeProject(composed(SERVICE_STACK));

    const authored = await quietLoad(dir, true);
    expect(bodyDriver(authored.config)).toBe('mongo');
    expect(authored.stackProvenance).toBe(true);

    const strict = await quietLoad(dir);
    expect(bodyDriver(strict.config)).toBe('mongodb');
  }, RUN_TIMEOUT);

  it('an input defined twice starts from the innermost argument, and is listed once', async () => {
    const dir = writeProject(composed(edit(
      edit(SERVICE_STACK, 'export const ServiceStack = defineStack({', 'export const ServiceStack = defineStack(defineStack({'),
      '\n});\n',
      '\n}));\n',
    )));
    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(out.applied)).toEqual([MONGO_BODY_SITE]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});

describe('a refused input the shim produces again, carrying a load-path spelling too', () => {
  // The `time` default with the UTC suffix is refused by the current schema,
  // so the shim hands the call's argument through and produces it again in
  // `strict: false` mode for the composer; the driver id is the input's one
  // load-path conversion.
  const MIXED = edit(
    SERVICE_STACK,
    "        name: { type: 'text', label: 'Name' },\n",
    "        name: { type: 'text', label: 'Name' },\n        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },\n",
  );

  it('lists each conversion once, and --write writes both into the input’s file', async () => {
    const dir = writeProject(composed(MIXED));
    const before = snapshot(dir);

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([MONGO_BODY_SITE, TIME_BODY_SITE]);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([MONGO_BODY_SITE, TIME_BODY_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'src/service.stack.ts', sites: 2 }]);
    expect(snapshot(dir)).toEqual({
      ...before,
      'src/service.stack.ts': edit(
        edit(MIXED, "defaultValue: '10:00Z'", "defaultValue: '10:00'"),
        "driver: 'mongo'",
        "driver: 'mongodb'",
      ),
    });

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);

    const strict = await quietLoad(dir);
    expect(strict.stackProvenance).toBe(true);
    expect(strict.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);
});

describe('control: an already-canonical composed project', () => {
  const CANONICAL = edit(SERVICE_STACK, "driver: 'mongo'", "driver: 'mongodb'");

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
