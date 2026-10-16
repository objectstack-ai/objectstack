// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23744 — a `serve` boot that composes no HTTP transport is held alive until
 * its kernel stops.
 *
 * ## The defect
 *
 * `os serve objectstack.config.ts --no-server --preset minimal`, in production
 * with no storage driver, printed its ready banner ending `Press Ctrl+C to
 * stop` and exited 0 by itself milliseconds later. Nothing this command owns
 * held the event loop. The same command stayed up only when the storage driver
 * kept a connection pool, whose reaping interval was the one ref'd handle left.
 *
 * ## What this file pins, and what it leaves to the boot
 *
 * The BEHAVIOUR of {@link holdKernelOnlyProcess} is driven against a real
 * `ObjectKernel`: its handle is ref'd (an `unref()`ed one holds nothing), and
 * the kernel's own shutdown releases it. The WIRING inside `run()` (one
 * ~3000-line method that needs a whole kernel to enter) is a source pin with
 * comments masked, as `serve-no-transport-announcements.test.ts` pins its gate.
 * `serve-kernel-only-lifetime.integration.test.ts` drives both through real
 * boots of the built CLI and reads the process state and its exit code.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectKernel } from '@objectstack/core';

// The repo's ONE code/prose separator: a comment saying the process is held
// must not answer for code that does not hold it.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import { holdKernelOnlyProcess } from './serve.js';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SERVE_RAW = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');
/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(SERVE_RAW);

/** The one service a kernel refuses to start without. Nothing here reads data. */
const DATA_STUB = {
  name: 'com.example.fx23744.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
  start: async () => {},
};

/** A running kernel. `gracefulShutdown: false`: this test process must not gain the kernel's signal listeners. */
async function runningKernel(): Promise<ObjectKernel> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(DATA_STUB);
  await kernel.bootstrap();
  return kernel;
}

const held: Array<ReturnType<typeof setInterval>> = [];

afterEach(() => {
  vi.restoreAllMocks();
  // A failed assertion must not leave a ref'd handle holding the worker.
  for (const hold of held.splice(0)) clearInterval(hold);
});

describe('holdKernelOnlyProcess — the process lives until the kernel stops (#23744)', () => {
  it('holds the event loop: the handle is ref\'d', async () => {
    const kernel = await runningKernel();
    const hold = holdKernelOnlyProcess(kernel);
    held.push(hold);
    expect(hold.hasRef(), 'an unref()ed handle holds nothing — the boot exits after its banner again').toBe(true);
    await kernel.shutdown();
  });

  it('the kernel\'s own shutdown releases it, and nothing before that does', async () => {
    const kernel = await runningKernel();
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const hold = holdKernelOnlyProcess(kernel);
    held.push(hold);
    expect(cleared, 'released before the kernel stopped').not.toHaveBeenCalledWith(hold);
    await kernel.shutdown();
    expect(cleared, 'a stopped kernel still holds the process').toHaveBeenCalledWith(hold);
  });
});

describe('the wiring inside `run()` — held on exactly the boots no transport holds (#23744)', () => {
  it('holds when no HTTP server is composed, reading the SAME composition the banner and the publish site read', () => {
    expect(SERVE.match(/holdKernelOnlyProcess\(kernel\)/g) ?? [], 'not one hold call site').toHaveLength(1);
    expect(SERVE, 'the hold is no longer gated on the composed transport').toContain(
      "if (httpServer !== 'composed') holdKernelOnlyProcess(kernel);",
    );
    expect(SERVE.match(/const httpServer =/g) ?? [], 'a second composition read can disagree with the first').toHaveLength(1);
  });

  it('holds after the boot\'s last announcement, the seed-settled release', () => {
    const release = SERVE.indexOf('seedSettlement.release();');
    const hold = SERVE.indexOf("if (httpServer !== 'composed') holdKernelOnlyProcess(kernel);");
    expect(release).toBeGreaterThan(-1);
    expect(hold, 'the hold moved ahead of the ready path').toBeGreaterThan(release);
  });

  it('⛔ serve installs no signal listener of its own — the kernel\'s is the only one', () => {
    expect(SERVE).not.toMatch(/process\.(?:on|once|addListener|prependListener)\(\s*['"]SIG/);
  });

  it('ANTI-VACUITY: the scan reads code, and a comment is invisible to it', () => {
    expect(SERVE.length).toBe(SERVE_RAW.length);
    const proseOnly = 'just keep the process alive';
    expect(SERVE_RAW, 'the control sentence was reworded — pick another').toContain(proseOnly);
    expect(SERVE).not.toContain(proseOnly);
    expect(SERVE).toContain('export function holdKernelOnlyProcess(');
  });
});
