/**
 * Smoke tests for the @object-ui/cli bin.
 *
 * These tests invoke the built `dist/cli.js` as a child process to verify
 * that the public CLI surface (commands, flags, exit codes) matches what
 * is documented in the README and content/docs/utilities/cli.mdx.
 *
 * If you change a flag or command name, update both this test file AND the
 * docs in the same PR (Rule #2: Documentation Driven Development).
 *
 * This file holds the read-only half: package identity, `--version`, `--help`
 * and the documented flags of every command. `cli-bin.test.ts` holds the
 * commands that write, refuse or validate. Both share `cliBin.ts`, which
 * builds `dist/` once behind a lock (objectstack#25911).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { PKG_PATH, PKG_ROOT, REPO_ROOT, ensureCliBuilt, run } from './cliBin.js';

/**
 * The commands the CLI declares. The enumeration pin below holds this list
 * equal to the built CLI's `--help`, both directions (objectui#11496). `add`
 * (objectui#11496) and `create`, `lint`, `test` and `studio` (objectui#11500)
 * are deliberately absent: they were retired, and the bin refuses each as an
 * unknown command. The CLI docs give each of these a `### objectui NAME`
 * heading; keep them in step by hand, because nothing in this file reads the
 * docs.
 */
const SUBCOMMANDS = [
  'serve',
  'dev',
  'build',
  'start',
  'init',
  'generate',
  'doctor',
  'check',
  'validate',
  'analyze',
] as const;

/**
 * The environment a build spawned by this file runs in: `VITEST` removed.
 * `cli-bin.test.ts` gives the full account (objectui#8598). It is declared
 * here, not imported, because the gate that holds every build spawn to it
 * resolves `env:` only within the spawning file (see `cliBin.ts`).
 */
const BUILD_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  delete env.VITEST;
  return env;
})();

/**
 * The command names commander prints under `Commands:` in the root `--help`, in
 * order. An entry starts with exactly two spaces; a wrapped description line is
 * indented further, so it is not an entry. `generate|g` reads as `generate`.
 */
function helpCommandNames(helpText: string): string[] {
  const lines = helpText.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'Commands:');
  if (start === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') break;
    const entry = /^ {2}(\S+)/.exec(line);
    if (entry) names.push(entry[1].split('|')[0]);
  }
  return names;
}

describe('@object-ui/cli bin', () => {
  beforeAll(() => {
    ensureCliBuilt({
      types: () =>
        spawnSync('pnpm', ['--filter', '@object-ui/types', 'run', 'build'], {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: BUILD_ENV,
        }),
      cli: () =>
        spawnSync('pnpm', ['run', 'build'], {
          cwd: PKG_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: BUILD_ENV,
        }),
    });
  }, 180_000);

  describe('package metadata', () => {
    it('package.json declares the standalone @object-ui/cli identity', () => {
      const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
      expect(pkg.name).toBe('@object-ui/cli');
      expect(pkg.bin).toEqual({ objectui: './dist/cli.js' });
      expect(pkg.oclif).toBeUndefined();
      expect(pkg.dependencies?.['@oclif/core']).toBeUndefined();
    });
  });

  describe('--version', () => {
    it('matches the version in package.json', () => {
      const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
      const res = run(['--version']);
      expect(res.code).toBe(0);
      expect(res.stdout.trim()).toBe(pkg.version);
    });
  });

  // objectui#11496. One enumeration over the built CLI's commands, so the next
  // declared-but-unbuilt command cannot ship the way `add` did: a retired
  // command that comes back, or a new one this list does not name, turns this
  // red. It replaces a containment check that a retired command coming back
  // would have passed.
  describe('--help', () => {
    it('lists exactly the declared commands, no more and no fewer', () => {
      const res = run(['--help']);
      expect(res.code, res.stderr).toBe(0);
      const listed = helpCommandNames(res.stdout);
      // Lit control: commander lists its own `help` command last, so reading it
      // proves the parse ran to the end of the Commands section.
      expect(listed[listed.length - 1]).toBe('help');
      const declared = listed.filter((name) => name !== 'help');
      expect([...declared].sort()).toEqual([...SUBCOMMANDS].sort());
      expect(new Set(declared).size).toBe(declared.length);
    });

    it('uses the "objectui" bin name (not "os ui")', () => {
      const res = run(['--help']);
      expect(res.stdout).toMatch(/Usage:\s+objectui/);
      expect(res.stdout).not.toContain('os ui');
    });
  });

  describe.each(SUBCOMMANDS)('subcommand "%s"', (cmd) => {
    it('exits 0 on --help', () => {
      const res = run([cmd, '--help']);
      expect(res.code, res.stderr || res.stdout).toBe(0);
      expect(res.stdout).toContain(`objectui ${cmd}`);
    });
  });

  // objectui#10524 — `check` is an advisory sweep, not a validator: a file whose
  // root carries a structural key is recognised by that key and never parsed,
  // and it exits non-zero only on unreadable JSON or on a `${…}` refused on a
  // text key its node never evaluates (objectui#4795). Its help line used to read
  // "Validate schema files". These assert the kind of claim and the command it
  // names, not the wording.
  describe('check --help does not present `check` as the validator (objectui#10524)', () => {
    const checkDescription = () => {
      const res = run(['check', '--help']);
      expect(res.code, res.stderr || res.stdout).toBe(0);
      // Commander prints `Usage: …`, a blank line, then the description paragraph.
      return res.stdout.split(/\n\s*\n/)[1] ?? '';
    };

    it('does not describe `check` with the verb "validate"', () => {
      expect(checkDescription()).not.toMatch(/^\s*validates?\b/i);
    });

    it('names `objectui validate` as the command that gives the verdict', () => {
      expect(checkDescription()).toContain('objectui validate');
    });
  });

  // objectui#11500. `doctor` was described as "Diagnose and fix common issues",
  // and it fixes nothing: it reads the project and reports. Asserts the kind of
  // claim, not the wording.
  it('doctor --help does not claim to fix anything (objectui#11500)', () => {
    const res = run(['doctor', '--help']);
    expect(res.code, res.stderr || res.stdout).toBe(0);
    // Commander prints `Usage: …`, a blank line, then the description paragraph.
    const description = res.stdout.split(/\n\s*\n/)[1] ?? '';
    // Lit control: the paragraph that was read is not empty.
    expect(description.trim()).not.toBe('');
    expect(description).not.toMatch(/\bfix/i);
  });

  describe('flag contracts (locked-in by docs)', () => {
    const cases: Array<[string, RegExp[]]> = [
      ['dev',      [/-p, --port <port>/, /-h, --host <host>/, /--no-open/]],
      ['serve',    [/-p, --port <port>/, /-h, --host <host>/, /--no-open/]],
      ['build',    [/-o, --out-dir <dir>/, /--clean/]],
      ['start',    [/-p, --port <port>/, /-h, --host <host>/, /-d, --dir <dir>/]],
      ['init',     [/-t, --template <template>/]],
      ['generate', [/<type> <name>/]],
      ['validate', [/\[schema\]/]],
    ];
    it.each(cases)('%s exposes the documented flags', (cmd, patterns) => {
      const res = run([cmd, '--help']);
      expect(res.code).toBe(0);
      for (const re of patterns) {
        expect(res.stdout).toMatch(re);
      }
    });
  });
});
