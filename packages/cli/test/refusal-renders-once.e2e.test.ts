// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — each refusal `os init` and `os compile` make renders its sentence ONCE
 * at the public door, and exits with the status it always did.
 *
 * ## The defect, measured at the public door
 *
 *     os init demo -t bogus
 *     → stdout  `  ✗ Unknown template: bogus`        (printError)
 *       stderr  `Error: Unknown template: bogus`     (oclif, rendering this.error)
 *       exit 2
 *
 * Ten sites paired `printError(msg)` with `this.error(msg)`, so one refusal was
 * read twice across two streams: the five refusals `os init` makes before its
 * `try`, the scaffold self-test and the dependency install inside it, its
 * catch-all, and `os compile`'s runtime-bundle refusal and catch-all (`os build`
 * inherits the second). Each now prints its `✗` line, and the hint under it,
 * and ends in `this.exit(2)`: the status `this.error` raised, with nothing
 * rendered by oclif's entry point.
 *
 * ## What each case asserts
 *
 * The CLI is SPAWNED — `bin/run-dev.js` through tsx, the source entry that
 * shares the published entry's `handle()` and `flush()` — because the second
 * rendering is made by the entry point AFTER `run()` has thrown, so no
 * in-process run can see it (`exit-signal.pin.test.ts` says as much). For each
 * site:
 *
 *   1. the exit status is 2 — unchanged, `this.error`'s;
 *   2. the refusal's subject occurs ONCE across stdout and stderr together,
 *      so the count holds whichever stream the one copy is on;
 *   3. exactly one `✗` line is printed, so the surviving copy is the
 *      command's own rendering and not an `Error:` block that took its place;
 *   4. the hint the site prints under its `✗` line is still there — dropping
 *      `printError` and leaving only `this.error` would pass (2) and lose it.
 *
 * ⛔ Not asserted: the wording of any refusal (the subject is one distinctive
 * fragment of it, enough to count), and which stream the copy is on.
 *
 * The structural half — no function under `src/commands` pairs a refusal
 * printer with `this.error`, over the whole command population rather than
 * these ten — is `refusal-renders-once.test.ts`.
 *
 * ## Fixtures, and why each one reaches its site
 *
 * Every project is a fresh child of one `mkdtemp` directory. The two
 * `<pm> install` sites put a stub `npm` first on `PATH` (the command runs
 * `execSync('npm install')`): one that exits 1, and one that exits 0 having
 * created an EMPTY `node_modules/@objectstack/spec`, so the scaffold's own
 * self-test cannot resolve the protocol package — on this tree or any other,
 * since a directory that exists shadows every copy further up. The catch-all
 * is reached by a FILE named `src` where the template needs a directory. The
 * runtime-bundle refusal is reached by a config that imports `./helper`, which
 * only `helper.jsx` satisfies: the config loader resolves `.jsx`, the runtime
 * bundle's `resolveExtensions` does not, so the load succeeds and the bundle
 * step refuses. If that stops being true the case fails on its first
 * assertion (exit 0, `Build complete`) and says why, rather than passing on a
 * refusal it never reached.
 *
 * ## Tier
 *
 * Nightly by name, `integration` by behaviour (`vitest-tiers.ts`): each case is
 * a spawn. Every spawn is paid in `beforeAll`, sequentially — ten tsx starts at
 * once is the load that turns a shared box's verdicts into timeouts — and no
 * case is clocked.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[], cwd: string, env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...argv],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', ...env }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

let root: string;

/** A fresh empty directory under the scratch root. */
function dir(name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  return d;
}

/** A directory holding an executable `npm` — put it first on PATH to stand in for the package manager. */
function stubNpm(name: string, body: string): Record<string, string> {
  const bin = dir(name);
  const file = join(bin, 'npm');
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
}

const OBJECT = "{ name: 'rr_ticket', label: 'Ticket', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }";

function stackConfig(hooks: string): string {
  return `import { defineStack } from '@objectstack/spec';
export default defineStack({
  manifest: { id: 'com.example.rr', name: 'rr', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [${hooks}],
}, { strict: false });
`;
}

interface Site {
  /** `os <command>: <refusal>` — the case's name. */
  name: string;
  /** What the case needs on disk and on the command line; runs once, in `beforeAll`. */
  prepare: () => { argv: string[]; cwd: string; env?: Record<string, string> };
  /** A fragment of the refusal, distinctive enough to count: one occurrence across both streams. */
  subject: RegExp;
  /** The hint printed under the `✗` line, when the site prints one. */
  hint?: string;
}

const SITES: Site[] = [
  {
    name: 'os init: an unknown template',
    prepare: () => ({ argv: ['init', 'demo', '-t', 'bogus'], cwd: dir('unknown-template') }),
    subject: /Unknown template: bogus/g,
    hint: 'Available: app, plugin, empty',
  },
  {
    name: 'os init: a project name that is not valid',
    prepare: () => ({ argv: ['init', 'Bad_Name'], cwd: dir('bad-name') }),
    subject: /Project name must be lowercase/g,
  },
  {
    name: 'os init: a target directory that is not empty',
    prepare: () => {
      const cwd = dir('target-not-empty');
      mkdirSync(join(cwd, 'demo'));
      writeFileSync(join(cwd, 'demo', 'keep.txt'), 'already here');
      return { argv: ['init', 'demo'], cwd };
    },
    subject: /is not empty/g,
    hint: 'Choose a different name or remove the existing directory first.',
  },
  {
    name: 'os init: the current directory name is not a valid project name',
    prepare: () => ({ argv: ['init'], cwd: dir('Bad Cwd') }),
    // The `✗` line carries this sentence inside a longer one; the entry point's copy carried it alone.
    subject: /Project name must be lowercase/g,
    hint: 'Re-run with an explicit name',
  },
  {
    name: 'os init: an objectstack.config.ts that already exists',
    prepare: () => {
      const cwd = dir('config-exists');
      writeFileSync(join(cwd, 'objectstack.config.ts'), '// already here\n');
      return { argv: ['init'], cwd };
    },
    subject: /objectstack\.config\.ts already exists/g,
    hint: 'Use `objectstack generate` to add metadata to an existing project',
  },
  {
    name: 'os init: a scaffold its own self-test rejects (refused inside the try)',
    prepare: () => ({
      argv: ['init', 'demo', '-p', 'npm'],
      cwd: dir('scaffold-rejected'),
      // An install that "succeeds" and leaves the protocol package unresolvable.
      env: stubNpm('npm-installs-nothing', 'mkdir -p node_modules/@objectstack/spec'),
    }),
    subject: /Scaffold validation failed/g,
    hint: 'This is a CLI bug',
  },
  {
    name: 'os init: a dependency install that fails (refused inside the try)',
    prepare: () => ({
      argv: ['init', 'demo', '-p', 'npm'],
      cwd: dir('install-failed'),
      env: stubNpm('npm-fails', 'exit 1'),
    }),
    subject: /dependency installation failed/gi,
    hint: 'To finish setup:',
  },
  {
    name: 'os init: any other failure (the catch-all)',
    prepare: () => {
      const cwd = dir('catch-all');
      // A file where the template needs the `src` directory.
      writeFileSync(join(cwd, 'src'), 'a file where a directory is needed');
      return { argv: ['init', '--no-install'], cwd };
    },
    subject: /ENOTDIR/g,
  },
  {
    name: 'os compile: a runtime bundle that cannot be built',
    prepare: () => {
      const cwd = dir('bundle-refused');
      linkSpec(cwd);
      writeFileSync(join(cwd, 'helper.jsx'), 'export const x = 1;\n');
      writeFileSync(
        join(cwd, 'objectstack.config.ts'),
        `import { x } from './helper';\n${stackConfig("{ name: 'rr_hook', object: 'rr_ticket', events: ['beforeInsert'], handler: async (ctx: any) => [x, ctx] }")}`,
      );
      return { argv: ['compile', '--runtime-bundle'], cwd };
    },
    subject: /Could not resolve "\.\/helper"/g,
  },
  {
    name: 'os compile: any other failure (the catch-all)',
    prepare: () => {
      const cwd = dir('compile-catch-all');
      linkSpec(cwd);
      writeFileSync(join(cwd, 'objectstack.config.ts'), "throw new Error('refusal-renders-once: the config module threw at load');\n");
      return { argv: ['compile'], cwd };
    },
    subject: /the config module threw at load/g,
  },
];

const RUNS = new Map<string, Run>();

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-refusal-once-'));
  for (const site of SITES) {
    const { argv, cwd, env } = site.prepare();
    RUNS.set(site.name, await runCli(argv, cwd, env));
  }
}, 900_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const occurrences = (text: string, subject: RegExp): number => text.match(subject)?.length ?? 0;

describe('each refusal renders its sentence once, and keeps its exit status', () => {
  it.each(SITES.map((s) => [s.name, s] as const))('%s', (name, site) => {
    const run = RUNS.get(name)!;
    const output = `${run.stdout}\n${run.stderr}`;
    const shown = `\n--- stdout\n${run.stdout}\n--- stderr\n${run.stderr}`;

    // 1. The fixture reached the refusal, and the status is the one `this.error` raised.
    expect(run.code, `the case never reached its refusal${shown}`).toBe(2);

    // 2. One rendering, not two across the two streams.
    expect(occurrences(output, site.subject), `the sentence must be read once${shown}`).toBe(1);

    // 3. The copy that survives is the command's `✗` line.
    expect(output.split('\n').filter((line) => /^\s*✗ /.test(line)), `exactly one \`✗\` line${shown}`).toHaveLength(1);

    // 4. Nothing the site printed under it was lost.
    if (site.hint !== undefined) expect(output, `the hint under the refusal${shown}`).toContain(site.hint);
  });
});
