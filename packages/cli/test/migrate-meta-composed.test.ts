// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` on a COMPOSED project —
 * `composeStacks([defineStack(…), …], { manifest: 'preserve' })` (#22289).
 *
 * ## What is pinned
 *
 *  1. The fix: a composed project whose package body carries a retired
 *     spelling loads, and the chain converts it — `applied` lists it under the
 *     body's own path (`packages[0].manifest…`), which names the package.
 *     Before, the load was refused with `STACK_PROVENANCE_MISSING` although
 *     every input was wrapped in `defineStack`: the authored-source shim handed
 *     the refused input through unmarked, and the real `composeStacks` refused
 *     it. And once it loaded, the chain missed the body anyway, because the
 *     conversions walk a stack's own collections and an option-B artifact has
 *     none at its top level.
 *  2. `--write` rewrites the file that authored the body — the input's own
 *     module, not the config — and nothing else; the re-run over the written
 *     sources applies nothing, and the strict load accepts them. A body whose
 *     input is not written as a literal is listed with its reason and left
 *     alone, never guessed at.
 *  3. The control: a one-package project's `applied` and `write` outcome are
 *     what they were, including a conversion the load still applies
 *     (`driver: 'mongo'`), which the shim's raw hand-back keeps visible to the
 *     chain. The expected values are the ones measured on `origin/main`
 *     `4e4111ca0` before this change.
 *  4. The boundary: an input the author never wrapped is still refused with
 *     `STACK_PROVENANCE_MISSING` — the shim produces again only what it handed
 *     through itself.
 *  5. The merged chain result keeps the chain's own contracts.
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
import { applyMetaMigrations } from '@objectstack/spec/migrations';
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

const json = (run: Run): any => JSON.parse(run.stdout);
const sites = (list: Array<{ conversionId: string; path: string; from?: string; to?: string }>) =>
  list.map(({ conversionId, path, from, to }) => ({ conversionId, path, from, to }));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-composed-'));
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

/** The service package's body, with a `time` default spelled with the UTC suffix protocol 18 retires. */
const SERVICE_STACK = `import { defineStack } from '@objectstack/spec';

export const ServiceStack = defineStack({
  manifest: { id: 'com.probe.svc', name: 'Probe Service', namespace: 'probe', version: '1.0.0', type: 'module' },
  objects: [
    {
      name: 'probe_slot',
      label: 'Slot',
      fields: {
        name: { type: 'text', label: 'Name' },
        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },
      },
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

const COMPOSED: Record<string, string> = {
  'objectstack.config.ts': `import { composeStacks } from '@objectstack/spec';
import { ServiceStack } from './src/service.stack.js';
import { AppStack } from './src/app.stack.js';

export default composeStacks([ServiceStack, AppStack], { manifest: 'preserve' });
`,
  'src/service.stack.ts': SERVICE_STACK,
  'src/app.stack.ts': APP_STACK,
};

const BODY_SITE = {
  conversionId: 'time-default-utc-suffix-dropped',
  path: 'packages[0].manifest.objects[0].fields.starts_at.defaultValue',
  from: '"10:00Z"',
  to: '"10:00"',
};

describe('a composed project migrates, and the package body’s conversion is applied and listed', () => {
  it('loads, converts the body, and lists the edit under the package’s own path', async () => {
    const dir = writeProject(COMPOSED);
    const run = await runMeta(dir, ['--from', '17', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(out.code).toBeUndefined();
    expect(sites(out.applied)).toEqual([BODY_SITE]);
    expect(out.schemaValid).toBe(true);
  }, RUN_TIMEOUT);

  it('--write rewrites the input’s own file; the re-run applies nothing and the strict load accepts it', async () => {
    const dir = writeProject(COMPOSED);
    const before = snapshot(dir);
    const run = await runMeta(dir, ['--from', '17', '--write', '--json']);
    expect(run.exitCode, run.stdout + run.stderr).toBeUndefined();
    const out = json(run);
    expect(sites(out.applied)).toEqual([BODY_SITE]);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'src/service.stack.ts', sites: 1 }]);
    expect(out.write.manual).toEqual([]);
    expect(out.write.unexplained).toEqual([]);

    // The site and nothing else: every other file keeps its bytes.
    expect(snapshot(dir)).toEqual({
      ...before,
      'src/service.stack.ts': edit(before['src/service.stack.ts']!, "defaultValue: '10:00Z'", "defaultValue: '10:00'"),
    });

    const again = json(await runMeta(dir, ['--from', '17', '--json']));
    expect(again.applied).toEqual([]);
    expect(again.schemaValid).toBe(true);

    // The load every other command uses — strict, no shim — accepts it now.
    const strict = await loadConfig(join(dir, 'objectstack.config.ts'));
    expect(strict.stackProvenance).toBe(true);
  }, RUN_TIMEOUT);

  it('--write lists, and leaves alone, a body whose input the walk cannot read as a literal', async () => {
    const dir = writeProject({
      ...COMPOSED,
      'src/service.stack.ts': edit(
        edit(SERVICE_STACK, 'export const ServiceStack = defineStack({', 'const build = () => ({'),
        '  ],\n});\n',
        '  ],\n});\n\nexport const ServiceStack = defineStack(build());\n',
      ),
    });
    const before = snapshot(dir);
    const out = json(await runMeta(dir, ['--from', '17', '--write', '--json']));
    expect(sites(out.applied)).toEqual([BODY_SITE]);
    expect(out.write.files).toEqual([]);
    expect(out.write.manual.map((m: { path: string; kind: string }) => [m.path, m.kind])).toEqual([[BODY_SITE.path, 'helper']]);
    expect(snapshot(dir)).toEqual(before);
  }, RUN_TIMEOUT);
});

describe('control: a one-package project is unchanged', () => {
  const SINGLE = `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.probe.svc', name: 'Probe Service', namespace: 'probe', version: '1.0.0', type: 'module' },
  objects: [
    {
      name: 'probe_slot',
      label: 'Slot',
      fields: {
        name: { type: 'text', label: 'Name' },
        starts_at: { type: 'time', label: 'Starts', defaultValue: '10:00Z' },
      },
    },
  ],
});
`;
  // The same stack with a datasource spelled the old way: a conversion the
  // load still applies. The raw hand-back keeps it visible to the chain.
  const SINGLE_WITH_LOAD_PATH_CONVERSION = edit(
    SINGLE,
    '  ],\n});\n',
    "  ],\n  datasources: [{ name: 'docs', label: 'Docs', driver: 'mongo', config: {} }],\n});\n",
  );
  const TIME_SITE = {
    conversionId: 'time-default-utc-suffix-dropped',
    path: 'objects[0].fields.starts_at.defaultValue',
    from: '"10:00Z"',
    to: '"10:00"',
  };
  const MONGO_SITE = {
    conversionId: 'datasource-driver-mongo-to-mongodb',
    path: 'datasources[0].driver',
    from: 'mongo',
    to: 'mongodb',
  };

  it.each([
    { name: 'a refused stack', source: SINGLE, applied: [TIME_SITE], writtenSites: 1 },
    { name: 'a refused stack carrying a load-path conversion', source: SINGLE_WITH_LOAD_PATH_CONVERSION, applied: [MONGO_SITE, TIME_SITE], writtenSites: 2 },
  ])('$name: `applied` and `write.files` as measured before the change', async ({ source, applied, writtenSites }) => {
    const dir = writeProject({ 'objectstack.config.ts': source });
    const dry = json(await runMeta(dir, ['--from', '16', '--json']));
    expect(sites(dry.applied)).toEqual(applied);

    const run = await runMeta(dir, ['--from', '16', '--write', '--json']);
    const out = json(run);
    expect(sites(out.applied)).toEqual(applied);
    expect(out.write.status).toBe('written');
    expect(out.write.files).toEqual([{ file: 'objectstack.config.ts', sites: writtenSites }]);
    let expected = edit(source, "defaultValue: '10:00Z'", "defaultValue: '10:00'");
    if (writtenSites === 2) expected = edit(expected, "driver: 'mongo'", "driver: 'mongodb'");
    expect(readFileSync(join(dir, 'objectstack.config.ts'), 'utf8')).toBe(expected);
  }, RUN_TIMEOUT);
});

describe('boundary: an input the author never wrapped is still refused', () => {
  it('a plain object beside a wrapped one answers STACK_PROVENANCE_MISSING, naming it', async () => {
    const dir = writeProject({
      ...COMPOSED,
      'src/app.stack.ts': edit(APP_STACK, 'export const AppStack = defineStack({', 'export const AppStack: any = ({'),
    });
    const run = await runMeta(dir, ['--from', '17', '--json']);
    expect(run.exitCode).toBe(1);
    const out = json(run);
    expect(out.code).toBe('STACK_PROVENANCE_MISSING');
    expect(out.error).toContain("'com.probe.app'");
    expect(out.error).not.toContain("'com.probe.svc'");
  }, RUN_TIMEOUT);
});

describe('applyMetaMigrationsToPackages keeps the chain result’s contracts', () => {
  it('a stack with no package list gets the plain chain result', () => {
    const stack = {
      manifest: { id: 'com.probe.svc' },
      objects: [{ name: 'probe_slot', fields: { starts_at: { type: 'time', defaultValue: '10:00Z' } } }],
    };
    expect(applyMetaMigrationsToPackages(stack, 17, 18)).toEqual(applyMetaMigrations(stack, 17, 18));
  });

  it('converts each body copy-on-write, and the merged lists stay consistent', () => {
    const service = {
      id: 'com.probe.svc',
      objects: [{ name: 'probe_slot', fields: { starts_at: { type: 'time', defaultValue: '10:00Z' } } }],
    };
    const app = { id: 'com.probe.app', objects: [{ name: 'probe_room', fields: { name: { type: 'text' } } }] };
    const appEntry = { manifest: app };
    const stack = { manifest: { id: 'com.probe.app' }, packages: [{ manifest: service }, appEntry] };
    const frozen = JSON.stringify(stack);

    const result = applyMetaMigrationsToPackages(stack, 17, 18);
    expect(sites(result.applied)).toEqual([BODY_SITE]);
    const packages = result.stack.packages as Array<{ manifest: typeof service }>;
    expect(packages[0]!.manifest.objects[0]!.fields.starts_at.defaultValue).toBe('10:00');
    // The input is untouched, and a body nothing changed is the same object.
    expect(JSON.stringify(stack)).toBe(frozen);
    expect(packages[1]).toBe(appEntry);

    expect(result.applied).toEqual(result.hops.flatMap((hop) => hop.applied));
    for (const todo of result.absentTodos) expect(result.todos).toContain(todo);
    for (const hop of result.hops) for (const todo of hop.absentTodos) expect(hop.todos).toContain(todo);
  });
});
