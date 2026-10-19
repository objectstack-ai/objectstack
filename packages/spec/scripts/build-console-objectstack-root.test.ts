// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the `.objectstack-sha` branch of `scripts/build-console.sh`
// (objectstack#24306, ruling B on objectui#12955): which objectstack the console
// build's objectui install compiles against.
//
// ## The contract
//
// A pinned objectui that carries `.objectstack-sha` overrides every
// `@objectstack/*` package to `file:node_modules/.cache/objectstack/<name>` and
// fills those directories with `scripts/objectstack-pin.mjs build`. With
// `OBJECTSTACK_ROOT` set, that script packs an installed and BUILT objectstack
// tree instead of building its own pin. build-console.sh must:
//
//   1. pass THIS framework tree as `OBJECTSTACK_ROOT`, after building the
//      overridden packages here, and before objectui's frozen install;
//   2. leave a pin WITHOUT `.objectstack-sha` exactly as before (no closure
//      build, no pin script), detected by the file and never by the sha;
//   3. refuse, naming the hook, a pin WITH `.objectstack-sha` whose pin script
//      has no `OBJECTSTACK_ROOT` input, before any install;
//   4. build that closure WITH declarations whatever `OS_SKIP_DTS` the caller
//      exported: the pin script packs whole packages and refuses one whose
//      `types` entry is missing, and a typeless tree did exactly that (consumer
//      pointer on objectstack#24306, measured again on this branch);
//   5. stop on the pin script's refusal, before the install.
//
// ## How it runs: the real script, a fake world
//
// The script under test is the tracked file, copied byte for byte into a temp
// framework root (it derives its root from its own path) beside a temp objectui
// git repo. Everything it would spend minutes on is a shim: `pnpm` on PATH
// records its argv and the `OS_SKIP_DTS` it received, and exits 42 at
// `install`, so "the install was reached" is the exit code itself; the pin
// script is a few lines of JS that records `OBJECTSTACK_ROOT` and its cwd. All
// records go to ONE log, so the ORDER of closure build, pin script and install
// is asserted, not inferred. The guards above this branch (the two vite hooks,
// the client and spec dists) are satisfied by the fixtures, so the branch is
// reached with nothing else to build.
//
// Vacuity guards: the case that exports OS_SKIP_DTS=1 also asserts the INSTALL
// call still received it, so "the closure build ran without it" cannot pass
// because the variable never reached the script at all.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', '..', 'scripts', 'build-console.sh');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'build-console-osroot-'));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const PNPM_SHIM = `#!/usr/bin/env bash
printf 'pnpm %s | OS_SKIP_DTS=%s\\n' "$*" "\${OS_SKIP_DTS-unset}" >> "$SHIM_LOG"
if [[ "\${1:-}" == "install" ]]; then exit 42; fi
exit 0
`;

/** A pin script that HAS the input: it reads OBJECTSTACK_ROOT and records it. */
const PIN_WITH_HOOK = `import fs from 'node:fs';
fs.appendFileSync(process.env.SHIM_LOG, 'pin ' + process.argv.slice(2).join(' ') + ' | OBJECTSTACK_ROOT=' + (process.env.OBJECTSTACK_ROOT ?? 'unset') + ' | cwd=' + process.cwd() + '\\n');
process.exit(Number(process.env.FAKE_PIN_EXIT ?? '0'));
`;

/** A pin script from before the input existed: it builds its own pin, always. */
const PIN_WITHOUT_HOOK = `import fs from 'node:fs';
fs.appendFileSync(process.env.SHIM_LOG, 'pin-without-hook\\n');
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// The objectui side: one repo, one commit per pin shape.
const UI = path.join(ROOT, 'ui');
fs.mkdirSync(UI);
git(UI, 'init', '-q');
write(path.join(UI, 'apps/console/vite.config.ts'), '// OBJECTSTACK_CLIENT_DIST OBJECTSTACK_SPEC_DIST\n');
write(
  path.join(UI, 'package.json'),
  JSON.stringify({
    name: 'fake-objectui',
    pnpm: {
      overrides: {
        react: '19.2.8',
        '@objectstack/spec': 'file:node_modules/.cache/objectstack/spec',
        '@objectstack/client': 'file:node_modules/.cache/objectstack/client',
      },
    },
  }),
);
git(UI, 'add', '-A');
git(UI, 'commit', '-q', '-m', 'a pin from before .objectstack-sha');
const OLD_PIN = git(UI, 'rev-parse', 'HEAD');

write(path.join(UI, '.objectstack-sha'), `${'a'.repeat(40)}\n`);
write(path.join(UI, 'scripts/objectstack-pin.mjs'), PIN_WITHOUT_HOOK);
git(UI, 'add', '-A');
git(UI, 'commit', '-q', '-m', '.objectstack-sha, pin script without the input');
const NO_HOOK_PIN = git(UI, 'rev-parse', 'HEAD');

write(path.join(UI, 'scripts/objectstack-pin.mjs'), PIN_WITH_HOOK);
git(UI, 'add', '-A');
git(UI, 'commit', '-q', '-m', '.objectstack-sha, pin script with OBJECTSTACK_ROOT');
const HOOK_PIN = git(UI, 'rev-parse', 'HEAD');

// The framework side: the real script, and dists that satisfy the guards above
// the branch so they build nothing.
const FW = path.join(ROOT, 'fw');
fs.mkdirSync(path.join(FW, 'scripts'), { recursive: true });
fs.copyFileSync(SCRIPT, path.join(FW, 'scripts', 'build-console.sh'));
write(path.join(FW, 'packages/client/dist/index.d.ts'), 'export {};\n');
write(path.join(FW, 'packages/spec/dist/index.mjs'), 'export {};\n');
write(path.join(FW, 'packages/spec/json-schema/openapi.json'), '{}\n');

const BIN = path.join(ROOT, 'bin');
write(path.join(BIN, 'pnpm'), PNPM_SHIM);
fs.chmodSync(path.join(BIN, 'pnpm'), 0o755);

interface Run {
  status: number | null;
  output: string;
  log: string[];
  buildRoot: string;
}

let runs = 0;
function buildConsole(pin: string, env: Record<string, string> = {}): Run {
  runs += 1;
  const log = path.join(ROOT, `run-${runs}.log`);
  fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(FW, '.objectui-sha'), `${pin}\n`);
  const base = { ...process.env };
  delete base.OS_SKIP_DTS;
  delete base.OBJECTSTACK_ROOT;
  const result = spawnSync('bash', [path.join(FW, 'scripts', 'build-console.sh')], {
    encoding: 'utf8',
    env: { ...base, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ''}`, OBJECTUI_ROOT: UI, SHIM_LOG: log, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    log: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
    buildRoot: fs.realpathSync(path.join(FW, '.cache', `objectui-${pin.slice(0, 12)}`)),
  };
}

const closureBuilds = (log: string[]) => log.filter((l) => l.startsWith('pnpm exec turbo run build'));
const installs = (log: string[]) => log.filter((l) => l.startsWith('pnpm install'));

describe('build-console.sh: the .objectstack-sha branch', () => {
  it('a pin without .objectstack-sha builds as before: no closure build, no pin script, straight to the install', () => {
    const run = buildConsole(OLD_PIN, { OS_SKIP_DTS: '1' });
    expect(run.status, run.output).toBe(42);
    expect(run.log.filter((l) => l.startsWith('pin'))).toEqual([]);
    expect(closureBuilds(run.log)).toEqual([]);
    expect(installs(run.log)).toHaveLength(1);
  });

  it('a pin with .objectstack-sha but no OBJECTSTACK_ROOT hook refuses, naming the hook, before any install', () => {
    const run = buildConsole(NO_HOOK_PIN);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain('OBJECTSTACK_ROOT hook');
    expect(run.log).toEqual([]);
  });

  it('a pin with the hook builds the overridden packages, passes THIS tree as OBJECTSTACK_ROOT, then installs', () => {
    const run = buildConsole(HOOK_PIN);
    expect(run.status, run.output).toBe(42);
    expect(run.log).toEqual([
      'pnpm exec turbo run build --filter=@objectstack/client --filter=@objectstack/spec --output-logs=new-only | OS_SKIP_DTS=unset',
      `pin build | OBJECTSTACK_ROOT=${FW} | cwd=${run.buildRoot}`,
      'pnpm install --frozen-lockfile --prefer-offline --config.production=false | OS_SKIP_DTS=unset',
    ]);
  });

  it('an inherited OS_SKIP_DTS does not reach the closure build, and the script says so', () => {
    const run = buildConsole(HOOK_PIN, { OS_SKIP_DTS: '1' });
    expect(run.status, run.output).toBe(42);
    expect(closureBuilds(run.log)).toEqual([
      'pnpm exec turbo run build --filter=@objectstack/client --filter=@objectstack/spec --output-logs=new-only | OS_SKIP_DTS=unset',
    ]);
    // Vacuity guard: the variable did reach the script — the install still sees it.
    expect(installs(run.log)).toEqual([
      'pnpm install --frozen-lockfile --prefer-offline --config.production=false | OS_SKIP_DTS=1',
    ]);
    expect(run.output).toContain('OS_SKIP_DTS is set');
  });

  it("the pin script's refusal stops the build before the install", () => {
    const run = buildConsole(HOOK_PIN, { FAKE_PIN_EXIT: '1' });
    expect(run.status, run.output).toBe(1);
    expect(run.log.filter((l) => l.startsWith('pin build'))).toHaveLength(1);
    expect(installs(run.log)).toEqual([]);
  });
});
