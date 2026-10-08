// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` on a stack whose `defineStack` call the current schema
 * ACCEPTS, carrying a spelling the load still converts (`driver: 'mongo'`).
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
 *  1. The fix: the conversion is listed, `--write` writes it, the re-run
 *     applies nothing, and a strict load converts nothing any more.
 *  2. Where the argument is read: off the default export, before the
 *     named-export merge (which spreads it into a new object), and only for
 *     the authored-source load.
 *  3. A stack defined twice starts from the innermost argument, once.
 *  4. The control: an already-canonical source writes nothing, and its
 *     `--json` summary equals the one the built stack gives.
 *  5. A stack the schema refuses for one spelling while carrying a load-path
 *     spelling too: each conversion is applied once, and both are written.
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
const conversionIds = (list: readonly { conversionId: string }[]) => list.map((c) => c.conversionId);

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
 * A stack the current schema accepts. Its one non-canonical spelling is a
 * datasource driver id the load still converts (`retiredFromLoadPath: false`);
 * the `url` is what makes a mongo datasource valid, so the call is accepted.
 */
const MONGO_SOURCE = `import { defineStack } from '@objectstack/spec';

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
  datasources: [{ name: 'docs', label: 'Docs', driver: 'mongo', config: { url: 'mongodb://mongo.internal:27017/docs' } }],
});
`;

const MONGO_CONVERSION = 'datasource-driver-mongo-to-mongodb';
const MONGO_SITE = { conversionId: MONGO_CONVERSION, path: 'datasources[0].driver', from: 'mongo', to: 'mongodb' };
const TIME_SITE = {
  conversionId: 'time-default-utc-suffix-dropped',
  path: 'objects[0].fields.starts_at.defaultValue',
  from: '"10:00Z"',
  to: '"10:00"',
};

describe('an accepted stack: the chain starts from what the author wrote', () => {
  it('lists a conversion the load already applied; --write writes it, and the load stops converting', async () => {
    const dir = writeProject({ 'objectstack.config.ts': MONGO_SOURCE });

    // The control for the last reading below: today the strict load converts it.
    const before = await quietLoad(dir);
    expect(before.stackProvenance).toBe(true);
    expect(conversionIds(before.stackConversions)).toEqual([MONGO_CONVERSION]);

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([MONGO_SITE]);
    expect(dry.schemaValid).toBe(true);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([MONGO_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'objectstack.config.ts', sites: 1 }]);
    expect(out.write.manual).toEqual([]);
    expect(out.write.unexplained).toEqual([]);
    expect(readFileSync(join(dir, 'objectstack.config.ts'), 'utf8')).toBe(
      edit(MONGO_SOURCE, "driver: 'mongo'", "driver: 'mongodb'"),
    );

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);
    expect(again.schemaValid).toBe(true);

    // The load every other command uses — strict, no shim — converts nothing now.
    const after = await quietLoad(dir);
    expect(after.stackProvenance).toBe(true);
    expect(after.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);

  it('the authored-source load reads the argument off the default export, before the named exports are merged', async () => {
    const dir = writeProject({
      'objectstack.config.ts': `${MONGO_SOURCE}\nexport const onEnable = async () => {};\n`,
    });

    const authored = await quietLoad(dir, true);
    expect(authored.config.datasources[0].driver).toBe('mongo');
    expect(authored.namedExports).toEqual(['onEnable']);
    expect(typeof authored.config.onEnable).toBe('function');
    // The producer's mark and record are still read off the stack it built.
    expect(authored.stackProvenance).toBe(true);
    expect(conversionIds(authored.stackConversions)).toEqual([MONGO_CONVERSION]);

    // Every other command still reads the stack `defineStack` built.
    const strict = await quietLoad(dir);
    expect(strict.config.datasources[0].driver).toBe('mongodb');
  }, RUN_TIMEOUT);

  it('a stack defined twice starts from the innermost argument, and converts it once', async () => {
    const dir = writeProject({
      'objectstack.config.ts': edit(
        edit(MONGO_SOURCE, 'export default defineStack({', 'export default defineStack(defineStack({'),
        '\n});\n',
        '\n}));\n',
      ),
    });
    const out = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(out.applied)).toEqual([MONGO_SITE]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);
});

describe('control: an already-canonical source', () => {
  const CANONICAL = edit(MONGO_SOURCE, "driver: 'mongo'", "driver: 'mongodb'");

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

describe('a stack with one refused spelling and one load-path spelling', () => {
  // The `time` default with the UTC suffix is refused by the current schema,
  // so this call hands its argument through; the datasource is valid, so the
  // driver id is the only load-path conversion in it.
  const MIXED = edit(
    MONGO_SOURCE,
    "        name: { type: 'text', label: 'Name' },\n",
    "        name: { type: 'text', label: 'Name' },\n        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },\n",
  );

  it('applies each conversion once, and --write writes both', async () => {
    const dir = writeProject({ 'objectstack.config.ts': MIXED });

    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual([MONGO_SITE, TIME_SITE]);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([MONGO_SITE, TIME_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'objectstack.config.ts', sites: 2 }]);
    expect(readFileSync(join(dir, 'objectstack.config.ts'), 'utf8')).toBe(
      edit(edit(MIXED, "defaultValue: '10:00Z'", "defaultValue: '10:00'"), "driver: 'mongo'", "driver: 'mongodb'"),
    );

    const again = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(again.applied).toEqual([]);

    const strict = await quietLoad(dir);
    expect(strict.stackProvenance).toBe(true);
    expect(strict.stackConversions).toEqual([]);
  }, RUN_TIMEOUT);
});
