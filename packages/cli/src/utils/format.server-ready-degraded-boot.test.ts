// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin } from '@objectstack/core';
import { printServerReady, type ServerReadyOptions } from './format.js';
import { readMissingCoreServices } from './degraded-capabilities.js';

/**
 * #16630 — the ready signal must report the degraded boot it is standing on.
 *
 * ## Why this file boots a REAL kernel instead of unit-testing the formatter
 *
 * The defect was never a wording problem. `✓ Server is ready` is printed by
 * `printServerReady` in `@objectstack/cli`; `System started with degraded
 * capabilities. Missing core services: …` is concluded by
 * `ObjectKernel.validateSystemRequirements()` in `@objectstack/core`; and there
 * was **no data path between them**, so the banner could not report the
 * degradation — it never learned of it. Two statements about one boot, produced
 * independently, and the louder one was the wrong one.
 *
 * ⇒ A test that hands a formatter a hand-written list asserts nothing about
 * that. It exercises exactly one of the two packages that each spoke alone,
 * which is the very perspective that produced the defect. So every degraded
 * assertion below starts from a REAL `ObjectKernel` bootstrap whose `auth`
 * service is genuinely absent, reads the conclusion the way `serve` reads it,
 * and prints the REAL banner from it.
 *
 * ## One output, both sides
 *
 * The two statements do not even share a stream: `ObjectLogger` writes `warn`
 * to `process.stdout`, the banner writes to `process.stderr` via
 * `console.error`. A terminal — and a CI log — interleaves them into ONE
 * transcript, which is where a reader met the contradiction: on this repo's own
 * registry canary (run `34084559243`, job `101626009369`, the published
 * `npx create-objectstack@latest` on-ramp) `✓ Server is ready` printed directly
 * ABOVE the four boot warnings that said the opposite. `beforeEach` below
 * reassembles that single transcript on purpose, so the assertions can hold
 * both sentences against ONE output rather than two.
 *
 * ## The three properties, and the one that is easy to lose
 *
 *   1. degraded ⇒ the ready line names what the kernel found missing, and the
 *      unconditional `✓` is gone;
 *   2. healthy ⇒ the ready block is byte-for-byte what it has always been —
 *      the property an "always append a status line" implementation quietly
 *      spends to buy (1);
 *   3. `Server is ready` still appears on a degraded boot. Readiness is NOT
 *      made strict (a machine deliberately booted without auth still boots and
 *      still exits 0); the line only says what state it is ready in.
 */

/** A plugin that registers exactly the named kernel services and nothing else. */
function servicesPlugin(names: string[]): Plugin {
  return {
    name: 'com.objectstack.test.degraded-boot-fixture',
    version: '1.0.0',
    init: async (ctx) => {
      for (const name of names) ctx.registerService(name, { fixture: name });
    },
  };
}

/**
 * Boot a real kernel providing exactly `names`, and hand back the kernel.
 *
 * `data` is `required` (the kernel throws without it) and `auth`/`job` are the
 * two `core` services with no in-memory fallback — see `CORE_FALLBACK_FACTORIES`
 * — so they are the only ones that can ever reach the degraded list. Omitting
 * `auth` reproduces both filed incidents; the rest are pre-injected.
 */
async function bootKernel(names: string[]): Promise<ObjectKernel> {
  const kernel = new ObjectKernel({
    logger: { level: 'warn' },
    // ⛔ Not `skipSystemValidation` — that is the branch under test.
    gracefulShutdown: false,
  });
  await kernel.use(servicesPlugin(names));
  await kernel.bootstrap();
  return kernel;
}

/** Banner options held fixed across the legs, so only the boot differs. */
const BASE: ServerReadyOptions = {
  externalBaseOrigin: 'http://localhost:3000',
  isDev: true,
  pluginCount: 3,
};

/**
 * The healthy ready block, verbatim, as `printServerReady` has always emitted
 * it for {@link BASE} under NO_COLOR.
 *
 * ⛔ This literal is the point of the byte-identity leg — do not regenerate it
 * from the implementation. It is transcribed from the block the same options
 * produced before #16630 touched this function, and its ready line is
 * character-identical to the one in `bannerFor()` in
 * `test/serve-port-readback.e2e.test.ts`, which was transcribed independently
 * from a real boot.
 */
const HEALTHY_READY_BLOCK = [
  '',
  '  ✓ Server is ready',
  '',
  '  ➜  API:       http://localhost:3000/',
  '',
  '  Mode:    development',
  '  Plugins: 3 loaded',
  '',
  '  Press Ctrl+C to stop',
  '',
];

let transcript: string[];
let errSpy: ReturnType<typeof vi.spyOn>;
let outSpy: ReturnType<typeof vi.spyOn>;

/** Strip SGR so assertions hold whether or not chalk colors this run. */
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

beforeEach(() => {
  transcript = [];
  // The banner (stderr, #7915) …
  errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    transcript.push(plain(args.join(' ')));
  });
  // … and the kernel's own `warn` (stdout — see `ObjectLogger.emit`), into the
  // SAME buffer and in emission order, which is what a terminal shows.
  outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown) => {
      for (const line of plain(String(chunk)).split('\n')) {
        if (line !== '') transcript.push(line);
      }
      return true;
    }) as never);
});

afterEach(() => {
  errSpy.mockRestore();
  outSpy.mockRestore();
});

describe('the ready signal on a degraded boot (#16630)', () => {
  it("carries the kernel's own missing-core-service list from core to the banner", async () => {
    const kernel = await bootKernel(['data', 'job']); // auth deliberately absent

    // ── the data path, read exactly as `serve` reads it ──────────────
    const missingCoreServices = readMissingCoreServices(kernel);
    expect(missingCoreServices, 'the kernel published no degraded readout').toEqual(['auth']);

    printServerReady({ ...BASE, missingCoreServices });
    const output = transcript.join('\n');

    // ── BOTH sides, in ONE output ────────────────────────────────────
    // The producer: the kernel's own sentence, unchanged.
    expect(output).toContain('System started with degraded capabilities. Missing core services: auth');
    // The consumer: the ready line, now reporting the same fact.
    expect(output).toContain('Server is ready');
    expect(output).toContain('⚠ Server is ready — DEGRADED: missing core services: auth');

    // ⭐ The defect itself: an unconditional green tick over a boot the kernel
    // had just called degraded. This is the assertion that was impossible to
    // write before the data path existed.
    expect(output).not.toContain('✓ Server is ready');

    await kernel.shutdown();
  });

  it('names the SAME list the kernel printed, never a separately computed one', async () => {
    // Both fallback-less core services absent at once: the banner must render
    // the kernel's list as the kernel ordered it, not a set of its own.
    const kernel = await bootKernel(['data']);

    const missingCoreServices = readMissingCoreServices(kernel);
    printServerReady({ ...BASE, missingCoreServices });

    const kernelLine = transcript.find((l) => l.includes('Missing core services:')) ?? '';
    const bannerLine = transcript.find((l) => l.includes('Server is ready')) ?? '';
    const namesFrom = (line: string) => line.slice(line.lastIndexOf(':') + 1).trim();

    expect(kernelLine, 'the kernel said nothing about degraded capabilities').not.toBe('');
    expect(namesFrom(bannerLine)).toBe(namesFrom(kernelLine));
    expect(namesFrom(bannerLine)).toBe('auth, job');

    await kernel.shutdown();
  });

  it('leaves a healthy boot byte-identical — no readout, no extra line', async () => {
    const kernel = await bootKernel(['data', 'auth', 'job']);

    // Nothing published ⇒ nothing to say. `getService` throws on a healthy
    // boot and the reader reports that as "no degradation", not as unknown.
    expect(readMissingCoreServices(kernel)).toBeUndefined();
    expect(transcript, 'a healthy boot logged a degraded-capabilities warning').toEqual([]);

    printServerReady({ ...BASE, missingCoreServices: readMissingCoreServices(kernel) });

    expect(transcript).toEqual(HEALTHY_READY_BLOCK);

    await kernel.shutdown();
  });

  it('treats an empty list as healthy, so no caller can append an empty warning', () => {
    printServerReady({ ...BASE, missingCoreServices: [] });
    expect(transcript).toEqual(HEALTHY_READY_BLOCK);
  });

  it('reports nothing rather than throwing when there is no kernel to ask', () => {
    // The readout is a diagnostic. It must never be able to fail a boot the
    // kernel has already decided is good enough to run.
    expect(readMissingCoreServices(undefined)).toBeUndefined();
    expect(readMissingCoreServices({})).toBeUndefined();
    expect(readMissingCoreServices({ getService: () => { throw new Error('nope'); } })).toBeUndefined();
    expect(readMissingCoreServices({ getService: () => ({ missingCoreServices: 'auth' }) })).toBeUndefined();
  });
});
