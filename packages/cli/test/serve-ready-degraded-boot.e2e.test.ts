// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

/**
 * #16630 — a REAL `os serve` boot, degraded, read end to end.
 *
 * ## Why a spawned process and not only the unit legs
 *
 * The entire defect is that two packages each spoke alone: `✓ Server is ready`
 * came out of `printServerReady` (`@objectstack/cli`) and `System started with
 * degraded capabilities. Missing core services: …` out of
 * `ObjectKernel.validateSystemRequirements()` (`@objectstack/core`), with no
 * data path between them — so the banner could not report the degradation, and
 * printed a green tick over it instead. Measured on objectui CI run
 * `34056438855`, and again on this repo's own registry canary (run
 * `34084559243`, job `101626009369`) where the published
 * `npx create-objectstack@latest` on-ramp printed `✓ Server is ready` directly
 * ABOVE four boot warnings. That job did fail — by later probes, ⛔ never by
 * the ready line, which carried no decisional weight at all.
 *
 * ⇒ Testing one package's output is the perspective that produced the defect.
 * `src/utils/format.server-ready-degraded-boot.test.ts` closes the seam over a
 * real `ObjectKernel`; this file closes it over the real COMMAND — the whole
 * assembly of plugins, tiers and banner a user actually runs.
 *
 * ## Why `bin/run.js` with `NODE_ENV` unset, and not `runServe()`
 *
 * The degradation has to be REACHED, not injected, and the only reachable
 * spelling is production posture. `serve` auto-registers `AuthPlugin` when a
 * secret resolves; outside `--dev` there is no fallback secret, so a production
 * boot with no `OS_AUTH_SECRET` skips auth by the command's own documented rule
 * (`⚠ AuthPlugin skipped — set OS_AUTH_SECRET …`) and `auth` — a `core` service
 * with no in-memory fallback — is genuinely absent. That is the end state both
 * incidents reached by other routes: a plugin that did not load, and a core
 * service that is not there.
 *
 * [ADR-0131 D9] A production boot with no secret is now refused before the
 * kernel starts whether or not it serves
 * (`serve-no-auth-secret-refusal.integration.test.ts`), so it reaches no banner.
 * The one production composition that still skips auth with a warning and
 * still prints the ready banner is the cloud runtime's host kernel
 * (`isHostKernelComposition`: a plugin registered as `ObjectOSEnvironmentPlugin`,
 * where auth is each project's), so the degraded leg boots that composition —
 * the {@link HOST_KERNEL_CONFIG} stub — and the healthy leg the bare config
 * with a secret. Both legs boot `--no-server`.
 *
 * ⛔ `runServe()` cannot reach it. That helper spawns `bin/run-dev.js`, which
 * sets `NODE_ENV = 'development'` before argv is parsed, so `isDev` is true,
 * the dev fallback secret applies, auth ALWAYS loads and the boot is never
 * degraded. Measured: switching this file to `runServe()` makes both legs
 * healthy and the degraded assertions unreachable — a green that measures
 * nothing. `bin/run.js` with `NODE_ENV` genuinely unset is the only shape that
 * reaches the gate, which is also why {@link requireBuiltCli} guards the file.
 *
 * ⚠️ The degraded leg is ALSO the negative control for the acceptance rule that
 * start and exit behaviour must not change: it is a machine deliberately
 * running without auth, and it still reaches the complete banner and is still a
 * live server afterwards. Readiness is not made strict here; the ready line
 * only says what state it is ready in.
 */

/** The complete banner — keyed on its LAST line, so the whole block is on the stream. */
const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. See the header for why this one. */
const CLI = resolve(HERE, '../bin/run.js');

const BARE_CONFIG = 'export default {};\n';

/**
 * The cloud runtime's host kernel, as `isHostKernelComposition` recognises it.
 * With no secret, auth is skipped by the warn-only host-kernel path and `auth`
 * — a `core` service with no in-memory fallback — is genuinely absent.
 */
const HOST_KERNEL_CONFIG = `export default {
  plugins: [{
    name: 'com.objectstack.runtime.objectos-environment',
    version: '0.0.0',
    init: async () => {},
    start: async () => {},
  }],
  // One object of the app's own, so \`serve\` composes the query engine: a
  // config that mounts plugins and declares no object composes none.
  objects: [{ name: 'host_kernel_probe', label: 'Probe', fields: { title: { type: 'text', label: 'Title' } } }],
};
`;

/** What `spawn(…, { stdio: ['ignore', 'pipe', 'pipe'] })` returns — no `stdin`. */
type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let fixtureDir: string;
let hostKernelDir: string;

interface Boot {
  out: string;
  err: string;
  child: BootChild;
}

/**
 * Spawn `os serve` in production posture and resolve once the COMPLETE banner
 * is on the stream. Extra `env` entries override the base; `undefined` unsets.
 */
async function boot(env: Record<string, string | undefined> = {}, cwd: string = fixtureDir): Promise<Boot> {
  // A kernel-assigned port (#24295): production posture refuses to auto-shift,
  // so a port drawn and released beforehand is a red whenever another process
  // takes it in the gap. Nothing here talks to the port.
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--no-server', '--port', KERNEL_ASSIGNED_PORT], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
    env: childEnv({
      NO_COLOR: '1',
      OS_DATABASE_URL: ':memory:',
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      // Production posture refuses to mint a crypto key; supplying a stable one
      // keeps the refusal out of the way of the property under test.
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // ⭐ Truly unset — the value that leaves the boot in production posture
      // (and leaves oclif resolving the command from `dist/`). Node omits an
      // `undefined` entry rather than inheriting the vitest worker's own.
      NODE_ENV: undefined,
      ...env,
    }),
  }) as BootChild;
  children.push(child);

  let out = '';
  let err = '';

  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => {
      fail(new Error(
        'serve never printed its COMPLETE ready banner (last line: "Press Ctrl+C to stop")'
        + `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`,
      ));
    }, 150_000);
    const onData = () => {
      if (READY_BANNER_TAIL.test(out + err)) {
        clearTimeout(timer);
        ready();
      }
    };
    child.stdout.on('data', (d) => { out += String(d); onData(); });
    child.stderr.on('data', (d) => { err += String(d); onData(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`serve exited ${code} before the ready banner\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    });
  });

  return { out, err, child };
}

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  fixtureDir = mkdtempSync(join(tmpdir(), 'os-ready-degraded-'));
  writeFileSync(join(fixtureDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');
  hostKernelDir = mkdtempSync(join(tmpdir(), 'os-ready-degraded-host-kernel-'));
  writeFileSync(join(hostKernelDir, 'objectstack.config.ts'), HOST_KERNEL_CONFIG, 'utf8');
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  if (hostKernelDir) rmSync(hostKernelDir, { recursive: true, force: true });
});

describe('os serve — the ready line reports a degraded boot (#16630)', () => {
  it(
    'prints ready AND the missing core service in the same output, with no unconditional tick',
    async () => {
      const { out, err, child } = await boot({}, hostKernelDir);
      const seen = `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`;
      const output = out + err;

      // The premise: this boot really is degraded, and the kernel really said
      // so. Asserted FIRST — without it every assertion below is vacuous.
      expect(output, `this boot was not degraded${seen}`).toContain(
        'System started with degraded capabilities. Missing core services: auth',
      );

      // ⭐ BOTH sides, in ONE output — the property the two packages could not
      // hold between them before the data path existed.
      expect(err, `serve never reported ready${seen}`).toContain('Server is ready');
      expect(err, `the ready line withheld the degradation${seen}`).toContain(
        '⚠ Server is ready — DEGRADED: missing core services: auth',
      );

      // ⭐ The defect itself, gone: the green tick may not appear on a boot the
      // kernel has recorded as degraded.
      expect(err, `the unconditional green tick survived${seen}`).not.toContain('✓ Server is ready');

      // ⛔ Start behaviour unchanged. Reaching here already means the COMPLETE
      // banner printed; the process being alive is the other half.
      expect(output).not.toContain('rollback complete');
      expect(child.exitCode, `serve exited during a boot it called ready${seen}`).toBeNull();
    },
    240_000,
  );

  it(
    'leaves a healthy boot printing exactly the tick it always printed',
    async () => {
      // Same entrypoint, same posture — the bare config with a secret, so auth
      // can register and nothing is missing (the degraded leg's host-kernel
      // stub is the other difference; see the header). An "always append a
      // status line" implementation passes the degraded leg and fails here.
      const { out, err } = await boot({
        OS_AUTH_SECRET: 'os-16630-healthy-leg-secret-not-a-real-credential',
      });
      const seen = `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`;
      const output = out + err;

      // The premise for THIS leg: nothing was missing.
      expect(output, `the healthy leg booted degraded${seen}`).not.toContain(
        'System started with degraded capabilities',
      );

      expect(err, `healthy boot lost its ready tick${seen}`).toContain('✓ Server is ready');
      expect(err, `healthy boot grew a degraded notice${seen}`).not.toContain('DEGRADED');
    },
    240_000,
  );
});
