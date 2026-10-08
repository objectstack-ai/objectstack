// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os init --no-install` names, in its printed Next steps, the package manager
 * the run resolved: the `--package-manager` flag first, then the invoking
 * package manager (`npm_config_user_agent`), then `npm`.
 *
 * The run used to resolve that package manager only inside its install branch.
 * Under `--no-install` the branch never ran, the variable kept its literal
 * `'npm'` initialiser, and the Next steps told a user who had passed
 * `--package-manager pnpm` (or invoked the CLI through pnpm) to run
 * `npm install` and `npx objectstack`.
 *
 * The third case is the control: a run invoked through npm, with no flag, still
 * names npm. The scaffold deliberately supports npm, yarn and bun as well as pnpm
 * (`engines.pnpm`, never a `packageManager` stamp; `init.test.ts` pins that), so
 * `npm install` is the right instruction for an npm run, and this file must not
 * read as "never npm".
 *
 * In-process (`Init.run` against the package root, the `doctor-*.test.ts`
 * pattern, with its 60 s budget: the first oclif load in a busy worker took
 * longer than vitest's 5 s default) and `--no-install`, so nothing is spawned
 * and nothing is installed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Init from './init.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/cli` — the oclif root the real command is loaded against below. */
const CLI_ROOT = path.resolve(HERE, '..', '..');

/** Written as `\x1b`, never as the byte itself, so `grep` keeps reading this file as text. */
const SGR = /\x1b\[[0-9;]*m/g;

const NPM_UA = 'npm/10.9.4 node/v22.22.0 linux x64 workspaces/false';
const PNPM_UA = 'pnpm/10.31.0 npm/? node/v22.22.0 linux x64';

describe('os init --no-install: the Next steps name the resolved package manager', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-init-next-steps-pm-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Run `os init` in `tmp` and return the printed lines from `Next steps:` on, colour stripped. */
  async function nextSteps(argv: string[], userAgent: string): Promise<string> {
    vi.stubEnv('npm_config_user_agent', userAgent);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    try {
      await Init.run(argv, { root: CLI_ROOT });
    } finally {
      logSpy.mockRestore();
    }
    const out = logs.join('\n').replace(SGR, '');
    const at = out.indexOf('Next steps:');
    expect(at, `no "Next steps:" block was printed:\n${out}`).toBeGreaterThan(-1);
    return out.slice(at);
  }

  it('--package-manager pnpm, invoked through npm: the flag wins', async () => {
    const steps = await nextSteps(['probe-app', '--no-install', '--package-manager', 'pnpm'], NPM_UA);
    expect(steps).toMatch(/^\s*pnpm install\s+# Install dependencies$/m);
    expect(steps).toMatch(/^\s*pnpm exec objectstack validate\b/m);
    // Word boundary: the text `pnpm install` itself contains the substring `npm install`.
    expect(steps).not.toMatch(/\bnpm install\b/);
    expect(steps).not.toMatch(/\bnpx objectstack\b/);
  }, 60_000);

  it('no flag, invoked through pnpm: the invoking package manager', async () => {
    const steps = await nextSteps(['probe-app', '--no-install'], PNPM_UA);
    expect(steps).toMatch(/^\s*pnpm install\s+# Install dependencies$/m);
    expect(steps).not.toMatch(/\bnpm install\b/);
  }, 60_000);

  it('no flag, invoked through npm: still npm (control)', async () => {
    const steps = await nextSteps(['probe-app', '--no-install'], NPM_UA);
    expect(steps).toMatch(/^\s*npm install\s+# Install dependencies$/m);
    expect(steps).toMatch(/^\s*npx objectstack validate\b/m);
  }, 60_000);
});
