// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomPort, runServe } from './helpers/serve-process.js';

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
 * assembly of plugins, tiers and banner that a user actually runs.
 *
 * ## How the degradation is provoked — the shape both incidents had
 *
 * Not a fault injected into the kernel: `serve` auto-registers `AuthPlugin`
 * only when a secret is resolvable, and outside `--dev` there is no fallback
 * one — so a production boot with no `OS_AUTH_SECRET` skips auth by its own
 * documented rule, and `auth` (a `core` service with no in-memory fallback)
 * is genuinely absent. That is the same end state both incidents reached by
 * other routes: a plugin that did not load and a core service that is not
 * there.
 *
 * ⚠️ This is also the NEGATIVE CONTROL for the acceptance rule that start and
 * exit behaviour must not change: that boot is a machine DELIBERATELY running
 * without auth, and it must still reach the banner and still be a live server.
 * Readiness is not made strict here; the ready line only says what state it is
 * ready in.
 */

const BARE_CONFIG = 'export default {};\n';

let degradedDir: string;
let healthyDir: string;

beforeAll(() => {
  degradedDir = mkdtempSync(join(tmpdir(), 'os-ready-degraded-'));
  writeFileSync(join(degradedDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');

  healthyDir = mkdtempSync(join(tmpdir(), 'os-ready-healthy-'));
  writeFileSync(join(healthyDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');
});

afterAll(() => {
  for (const dir of [degradedDir, healthyDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('os serve — the ready line reports a degraded boot (#16630)', () => {
  it(
    'prints ready AND the missing core service in the same output, with no unconditional tick',
    async () => {
      const { stdout, stderr } = await runServe(degradedDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
      const output = stdout + stderr;

      // The premise: this boot really is degraded, and the kernel really said
      // so. Asserted first — without it every assertion below is vacuous.
      expect(output, `this boot was not degraded${seen}`).toContain(
        'System started with degraded capabilities. Missing core services: auth',
      );

      // ⭐ BOTH sides, in ONE output — the property the two packages could not
      // hold between them before the data path existed.
      expect(stderr, `serve never reported ready${seen}`).toContain('Server is ready');
      expect(stderr, `the ready line withheld the degradation${seen}`).toContain(
        '⚠ Server is ready — DEGRADED: missing core services: auth',
      );

      // ⭐ The defect itself, gone: the green tick may not appear on a boot the
      // kernel has recorded as degraded.
      expect(stderr, `the unconditional green tick survived${seen}`).not.toContain(
        '✓ Server is ready',
      );

      // ⛔ Start behaviour unchanged: a machine deliberately without auth still
      // boots all the way through the banner. `runServe` only resolves once
      // the banner's LAST line is on the stream, so reaching here IS that.
      expect(stderr, `boot stopped short of the banner tail${seen}`).toContain(
        'Press Ctrl+C to stop',
      );
      expect(output).not.toContain('rollback complete');
    },
    240_000,
  );

  it(
    'leaves a healthy boot printing exactly the tick it always printed',
    async () => {
      // Same fixture, same command — the ONLY difference is that auth can now
      // register, so nothing is missing. An "always append a status line"
      // implementation passes the degraded case above and fails here.
      const { stdout, stderr } = await runServe(healthyDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
        env: { OS_AUTH_SECRET: 'os-16630-healthy-leg-secret-not-a-real-credential' },
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
      const output = stdout + stderr;

      // The premise for THIS leg: nothing was missing.
      expect(output, `the healthy leg booted degraded${seen}`).not.toContain(
        'System started with degraded capabilities',
      );

      expect(stderr, `healthy boot lost its ready tick${seen}`).toContain('✓ Server is ready');
      expect(stderr, `healthy boot grew a degraded notice${seen}`).not.toContain('DEGRADED');
    },
    240_000,
  );
});
