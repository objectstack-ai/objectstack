// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins two contracts of `scripts/gen-sdui-manifest.sh` that were measured
// failing together, in one run, on a tree whose console build was broken.
//
// ## What was measured
//
// `packages/console/dist/` is gitignored and exists only after a successful
// `scripts/build-console.sh`. Nothing created it, and objectui's dumper calls
// `writeFileSync` straight out, so with the directory absent the run died:
//
//     [dump] enumerated registry over http://localhost:5180 (HTTP 200)
//     Error: ENOENT: no such file or directory, open '.../sdui.manifest.json'
//     ✗ manifest generation failed (exit 1).
//       If Playwright reported a missing browser, install it and retry:
//         pnpm exec playwright install chromium-headless-shell
//
// Two separate defects in those five lines:
//
//   1. The ENOENT arrived AFTER a vite dev server and a chromium launch had
//      been paid for, and the ratchet never needed the built dist in the first
//      place — this script drives a vite DEV server over `.cache/objectui-*`,
//      and `dist/` is only where the manifest lands. So a broken console build
//      made the ADR-0082 D4 ratchet unrunnable for want of one `mkdir`.
//
//   2. The remedy printed was Playwright's, for a failure in which the browser
//      had already done its job. Following it costs a round on the wrong layer,
//      and inside an agent dispatch container it cannot even be followed —
//      `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set there.
//
// ## Why these are executed assertions and not greps
//
// A grep for `mkdir -p` passes against one written after the dump, which fixes
// nothing about (1) — the cost is in the ORDER, so the order is what is
// measured: the failing-precondition case asserts the dev server was spawned
// ZERO times. And a grep for the remedy string cannot tell a remedy that is
// printed always from one printed on evidence, which is the whole of (2), so
// the real classifier is sourced and fed real failure text.
//
// The vacuity guards carry as much weight as the assertions. `DUMP_REACHED_
// SERVER` proves the stub dumper genuinely talked to the server the script
// spawned (otherwise "the run completed" could mean nothing ran), `DIST_EXISTED_
// BEFORE` proves the directory was really absent, and the Playwright case proves
// the classifier still CAN print the install remedy — without it, "never prints
// Playwright advice" would be green for a script that prints no advice at all.
//
// No vite, no chromium and no console build: vite stands in as a one-line http
// server and the dumper as a node stub that writes OUT with `writeFileSync`
// exactly as objectui's does. The script is COPIED into a temp tree, which is
// what relocates it — `FRAMEWORK_ROOT` is derived from the script's own path,
// so the copy moves `TARGET` into the temp tree and this test cannot write into
// the real `packages/console/dist/`. Ports come from the script's own picker,
// so this cannot collide with a concurrent agent.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', '..', 'scripts', 'gen-sdui-manifest.sh');

function have(bin: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Linux-only by construction, like the cleanup and collision tests beside it:
// the failure being pinned is an agent-container one, and the script's lifecycle
// helpers read process sessions.
const RUNNABLE =
  process.platform === 'linux' && ['setsid', 'pgrep', 'curl', 'node'].every(have);

const FAKE_SHA = '0123456789abcdef0123456789abcdef01234567';
const trees: string[] = [];

/** Stands in for objectui's chromium dumper: reach the dev server, then write OUT. */
const DUMPER_STUB = [
  "import { writeFileSync } from 'node:fs';",
  'const res = await fetch(process.env.BASE_URL);',
  'console.log(`[dump] enumerated registry over ${process.env.BASE_URL} (HTTP ${res.status})`);',
  "writeFileSync(process.env.OUT, JSON.stringify({ blocks: [] }));",
].join('\n');

/** Stands in for `pnpm --filter @object-ui/console exec vite dev --port N --strictPort`. */
const PNPM_STUB = [
  '#!/usr/bin/env bash',
  'port=""; prev=""',
  'for a in "$@"; do [[ "$prev" == "--port" ]] && port="$a"; prev="$a"; done',
  'if [[ -n "$port" ]]; then',
  '  printf "spawned %s\\n" "$port" >> "$SDUI_TEST_SPAWN_LOG"',
  '  exec node -e \'require("node:http").createServer((_q,r)=>{r.writeHead(200);r.end("DEV")}).listen(Number(process.argv[1]),"127.0.0.1")\' "$port"',
  'fi',
  'exit 0',
].join('\n');

interface Run {
  exit: number;
  output: string;
  spawns: number;
  manifest: boolean;
  distExistedBefore: boolean;
}

/**
 * Build an isolated framework root around a COPY of the real script and run it.
 * `blockTarget` makes `TARGET`'s parent a regular FILE, so `mkdir -p` cannot
 * succeed even for root — chmod would prove nothing in a container running as
 * root, which is where this script's failures are diagnosed.
 */
function runScript(opts: { blockTarget?: boolean } = {}): Run {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdui-write-target-'));
  trees.push(T);

  fs.mkdirSync(path.join(T, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(T, 'bin'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(T, 'scripts', 'gen-sdui-manifest.sh'));
  fs.writeFileSync(path.join(T, '.objectui-sha'), `${FAKE_SHA}\n`);

  const build = path.join(T, '.cache', `objectui-${FAKE_SHA.slice(0, 12)}`);
  fs.mkdirSync(path.join(build, 'apps', 'console', 'dev'), { recursive: true });
  fs.mkdirSync(path.join(build, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(build, 'apps', 'console', 'dev', 'manifest-dump.html'), '');
  fs.writeFileSync(path.join(build, 'scripts', 'dump-public-manifest.mjs'), DUMPER_STUB);

  const pnpm = path.join(T, 'bin', 'pnpm');
  fs.writeFileSync(pnpm, PNPM_STUB, { mode: 0o755 });

  if (opts.blockTarget) {
    fs.mkdirSync(path.join(T, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(T, 'packages', 'console'), 'not a directory');
  }

  const manifest = path.join(T, 'packages', 'console', 'dist', 'sdui.manifest.json');
  const spawnLog = path.join(T, 'spawned.log');
  fs.writeFileSync(spawnLog, '');
  const distExistedBefore = fs.existsSync(path.dirname(manifest));

  const res = spawnSync('bash', [path.join(T, 'scripts', 'gen-sdui-manifest.sh')], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: `${path.join(T, 'bin')}:${process.env.PATH ?? ''}`,
      SDUI_TEST_SPAWN_LOG: spawnLog,
    },
  });

  return {
    exit: res.status ?? -1,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
    spawns: fs.readFileSync(spawnLog, 'utf8').split('\n').filter(Boolean).length,
    manifest: fs.existsSync(manifest),
    distExistedBefore,
  };
}

/** Source the real script and run its real classifier over `text`. */
function advice(text: string, out: string): string {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdui-advice-'));
  trees.push(T);
  const log = path.join(T, 'dump.log');
  fs.writeFileSync(log, text);
  return execFileSync(
    'bash',
    [
      '-c',
      `source ${JSON.stringify(SCRIPT)}; sdui_dump_failure_advice ${JSON.stringify(log)} ${JSON.stringify(out)}`,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
}

afterAll(() => {
  for (const t of trees) fs.rmSync(t, { recursive: true, force: true });
});

const INSTALL_REMEDY = 'playwright install chromium-headless-shell';
const OUT_PATH = '/tmp/whatever/packages/console/dist/sdui.manifest.json';

describe.skipIf(!RUNNABLE)('gen-sdui-manifest.sh output-directory precondition', () => {
  const ok = RUNNABLE ? runScript() : ({} as Run);

  it('creates its output directory instead of dying on it', () => {
    // Vacuity first: absent beforehand, and the dump really reached the server.
    expect(ok.distExistedBefore).toBe(false);
    expect(ok.output).toContain('[dump] enumerated registry over');

    expect(ok.exit).toBe(0);
    expect(ok.manifest).toBe(true);
    expect(ok.output).not.toContain('ENOENT');
  });

  it('fails the precondition BEFORE paying for a dev server and a browser', () => {
    const blocked = runScript({ blockTarget: true });
    expect(blocked.exit).not.toBe(0);
    expect(blocked.output).toContain('could not create the manifest output directory');
    // The point of the whole card: the cost came before the diagnosis.
    expect(blocked.spawns).toBe(0);
    // And the successful run above did spawn one, so `0` here is a measurement
    // rather than a harness that never spawns anything.
    expect(ok.spawns).toBe(1);
  });
});

describe.skipIf(!RUNNABLE)('gen-sdui-manifest.sh dump-failure diagnosis', () => {
  it('prints the Playwright remedy when Playwright is what failed', () => {
    const text = [
      "browserType.launch: Executable doesn't exist at",
      '/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
    ].join(' ');
    expect(advice(text, OUT_PATH)).toContain(INSTALL_REMEDY);
  });

  it('does not blame Playwright for a write failure', () => {
    const text = [
      '[dump] enumerated registry over http://localhost:5180 (HTTP 200)',
      `Error: ENOENT: no such file or directory, open '${OUT_PATH}'`,
      '    at writeFileSync (node:fs:2430:20)',
    ].join('\n');
    const said = advice(text, OUT_PATH);
    expect(said).not.toContain(INSTALL_REMEDY);
    expect(said).toContain('could not WRITE its output');
    expect(said).toContain(path.dirname(OUT_PATH));
  });

  it('says so plainly when it recognises neither, rather than defaulting to Playwright', () => {
    const said = advice("TypeError: Cannot read properties of undefined (reading 'blocks')", OUT_PATH);
    expect(said).not.toContain(INSTALL_REMEDY);
    expect(said).toContain('NOT identified as a missing Playwright browser');
  });
});
