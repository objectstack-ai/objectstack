// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 18.0 supports the `single` posture only (ruling record 6259698357 on the v18
 * epic). `os serve` refuses a walled posture (`group`, `isolated`) loudly,
 * naming the 18.x release that will carry it. It refuses at its tenancy-posture
 * gate, before a config is read. `os dev` and `os start` boot through `serve`.
 *
 * Under `single` nothing changes: `walledPostureRefusal` answers `null`, and
 * every `serve` integration test that boots with the posture unset
 * (`serve-no-server-banner.integration.test.ts`,
 * `serve-no-storage-boot-guard.integration.test.ts`, …) boots as before.
 *
 * Kernel-level boots never pass through `serve` (`@objectstack/verify`'s
 * `bootStack`, the dogfood wall suites), and they keep booting walled postures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANCY_POSTURES, postureEnforcesWall } from '@objectstack/spec/security';

import Serve, { walledPostureRefusal } from './serve.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** SGR codes, written as `\x1b` (never the raw byte, which makes grep read the file as binary). */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const WALLED = TENANCY_POSTURES.filter(postureEnforcesWall);

describe('walledPostureRefusal — the verdict', () => {
  it('answers null for single, the one posture 18.0 supports', () => {
    expect(walledPostureRefusal('single')).toBeNull();
  });

  it('refuses every walled posture the spec vocabulary declares', () => {
    expect(WALLED.length).toBeGreaterThan(0);
    for (const posture of WALLED) {
      process.env.OS_TENANCY_POSTURE = posture;
      const text = plain(walledPostureRefusal(posture) ?? '');
      expect(text).toContain(`FATAL: tenancy posture '${posture}' is not supported in 18.0 (NOT_IMPLEMENTED).`);
      expect(text).toContain('an 18.x release');
      expect(text).toContain('set OS_TENANCY_POSTURE=single');
      expect(text).toContain(`OS_TENANCY_POSTURE="${posture}"`);
    }
  });

  it('names OS_MULTI_ORG_ENABLED as the source when the posture was derived from it', () => {
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    const text = plain(walledPostureRefusal('isolated') ?? '');
    expect(text).toContain('OS_MULTI_ORG_ENABLED="true" (OS_TENANCY_POSTURE is unset)');
  });
});

/** Run the real `serve` in-process, its `process.exit` made catchable; the FATAL and every diagnostic captured. */
async function runServe(): Promise<{ raised: unknown; stderr: string; diagnostics: string[] }> {
  const savedNodeEnv = process.env.NODE_ENV;
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a.join(' '));
  });
  const stdoutWrite = process.stdout.write;
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    diagnostics.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__PROCESS_EXIT__:${code}`);
  }) as never);
  let raised: unknown;
  try {
    // `--dev` keeps the port probe on the auto-shift path, so a busy port cannot pre-empt the gate.
    await Serve.run(['--dev', '--port', '39873'], { root: CLI_ROOT });
  } catch (err) {
    raised = err;
  } finally {
    errSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
    // `run()` reserves stdout for the process's lifetime; put it back for the next case.
    process.stdout.write = stdoutWrite;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  }
  return { raised, stderr: plain(errors.join('\n')), diagnostics };
}

describe('os serve refuses a walled posture before any boot work', () => {
  it('OS_TENANCY_POSTURE=isolated: exit 1, the FATAL, and no config read', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const { raised, stderr, diagnostics } = await runServe();
    expect((raised as Error | undefined)?.message).toBe('__PROCESS_EXIT__:1');
    expect(stderr).toContain("FATAL: tenancy posture 'isolated' is not supported in 18.0");
    // The config load is serve's first announced boot step; nothing at all was announced.
    expect(diagnostics).toEqual([]);
  }, 60_000);

  it('OS_MULTI_ORG_ENABLED=true (the legacy switch, read as isolated) is refused the same way', async () => {
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    const { raised, stderr, diagnostics } = await runServe();
    expect((raised as Error | undefined)?.message).toBe('__PROCESS_EXIT__:1');
    expect(stderr).toContain("FATAL: tenancy posture 'isolated' is not supported in 18.0");
    expect(diagnostics).toEqual([]);
  }, 60_000);
});
