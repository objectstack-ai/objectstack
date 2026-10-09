// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 1, ruling A — ONE composition rule: for one configuration,
 * `bootStack` composes what `objectstack serve` composes. The `requires` half
 * is pinned in `harness.required-providers.test.ts`; this file pins the rest:
 *
 *  - the plugins in the app's own `plugins` array are mounted (`serve`'s rule
 *    for an entry, `materializeStackPlugin` in `@objectstack/core`);
 *  - a caller's `extraPlugins` instance takes precedence over an app plugin of
 *    the same `name` — the app's instance never runs;
 *  - an entry that cannot be loaded fails the boot, naming the entry;
 *  - the instance rule: a second live boot of one configuration is refused
 *    with `RESOURCE_CONFLICT` / 409 — and so is a copy that carries a mounted
 *    app-plugin instance — while a boot after `stop()` succeeds.
 *
 * Measured before the change (`origin/main` 6a53564b9): `bootStack` never read
 * `config.plugins` — an app's own plugin was simply absent from the kernel —
 * and two concurrent boots of one configuration both succeeded.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;
const PROBE = 'com.example.one-composition.probe';
const PROBE_SERVICE = 'one-composition.probe';

/** A plugin that records each init and registers which instance it is. */
class ProbePlugin {
  readonly name = PROBE;
  readonly version = '1.0.0';
  readonly type = 'standard';
  inits = 0;
  constructor(readonly tag: string) {}
  async init(ctx: { registerService(name: string, service: unknown): void }): Promise<void> {
    this.inits += 1;
    ctx.registerService(PROBE_SERVICE, this.tag);
  }
}

const manifest = { id: 'com.example.one-composition', name: 'One Composition', namespace: 'ocp', version: '1.0.0', type: 'app' };
const note = {
  name: 'ocp_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'public_read_write',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};

/** A fresh configuration object — the instance rule keys on identity. */
const app = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
  defineStack({ manifest, objects: [note], ...extra } as never) as unknown as Record<string, unknown>;

const live: VerifyStack[] = [];
const keep = (stack: VerifyStack): VerifyStack => {
  live.push(stack);
  return stack;
};
afterEach(async () => {
  for (const stack of live.splice(0)) await stack.stop();
});

const probeTag = (stack: VerifyStack): unknown => stack.kernel.getService(PROBE_SERVICE);

describe("bootStack mounts the app's own `plugins`, as serve does", () => {
  it("an app's own plugin instance is mounted and runs", async () => {
    const own = new ProbePlugin('app');
    const config = app({ plugins: [own] });
    // Anti-vacuity: the producer kept the instance, by reference.
    expect((config.plugins as unknown[])[0]).toBe(own);
    const stack = keep(await bootStack(config));
    expect(stack.kernel.hasPlugin(PROBE)).toBe(true);
    expect(probeTag(stack)).toBe('app');
    expect(own.inits).toBe(1);
  }, BOOT_TIMEOUT);

  it('control — an app with no `plugins` boots without the probe', async () => {
    const stack = keep(await bootStack(app()));
    expect(stack.kernel.hasPlugin(PROBE)).toBe(false);
  }, BOOT_TIMEOUT);

  it("extraPlugins takes precedence by identity: the caller's instance runs, the app's never does", async () => {
    const own = new ProbePlugin('app');
    const callers = new ProbePlugin('caller');
    const stack = keep(await bootStack(app({ plugins: [own] }), { extraPlugins: [callers] }));
    expect(probeTag(stack)).toBe('caller');
    expect(callers.inits).toBe(1);
    expect(own.inits).toBe(0);
  }, BOOT_TIMEOUT);

  describe('an entry that cannot be loaded fails the boot, naming it', () => {
    const hostRoot = mkdtempSync(join(tmpdir(), 'verify-one-composition-'));
    writeFileSync(join(hostRoot, 'package.json'), JSON.stringify({ name: 'host', version: '0.0.0' }));
    afterAll(() => rmSync(hostRoot, { recursive: true, force: true }));

    it('a package the app root cannot resolve', async () => {
      const missing = '@fixture/one-composition-never-installed';
      const failure = await bootStack(app({ plugins: [missing] }), { hostRoot }).then(
        (stack) => {
          keep(stack);
          return undefined;
        },
        (e: unknown) => e as Error,
      );
      expect(failure, 'the boot went on without the plugin the app declares').toBeInstanceOf(Error);
      expect(failure!.message).toContain(`plugins[0] ('${missing}')`);
      expect(failure!.message).toContain(hostRoot);
    }, BOOT_TIMEOUT);
  });
});

describe('the instance rule: one live kernel per configuration, per process', () => {
  const refusal = { code: 'RESOURCE_CONFLICT', status: 409 };

  it('a second live boot of the same configuration is refused; the first keeps working', async () => {
    const config = app({ plugins: [new ProbePlugin('app')] });
    const first = keep(await bootStack(config));
    await expect(bootStack(config)).rejects.toMatchObject(refusal);
    expect(probeTag(first)).toBe('app');
  }, BOOT_TIMEOUT);

  it('two boots started together: exactly one is refused', async () => {
    const config = app();
    const settled = await Promise.allSettled([bootStack(config), bootStack(config)]);
    for (const s of settled) if (s.status === 'fulfilled') keep(s.value);
    expect(settled.map((s) => s.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(rejected?.reason).toMatchObject(refusal);
  }, BOOT_TIMEOUT);

  it('a copy that carries a mounted app-plugin instance is refused too', async () => {
    const config = app({ plugins: [new ProbePlugin('app')] });
    keep(await bootStack(config));
    await expect(bootStack({ ...config })).rejects.toMatchObject(refusal);
  }, BOOT_TIMEOUT);

  it('the third remedy: a configuration BUILT AGAIN boots beside a live one', async () => {
    // Same app, same options, each configuration built by its own builder call
    // (fresh nested definitions, fresh plugin instance) — what the refusal's
    // remedy names for a suite that needs two stacks live at once.
    const first = keep(await bootStack(app({ plugins: [new ProbePlugin('first')] })));
    const second = keep(await bootStack(app({ plugins: [new ProbePlugin('second')] })));
    expect([probeTag(first), probeTag(second)]).toEqual(['first', 'second']);
  }, BOOT_TIMEOUT);

  it('a sequential re-boot works: boot, stop, boot', async () => {
    const own = new ProbePlugin('app');
    const config = app({ plugins: [own] });
    const first = await bootStack(config);
    await first.stop();
    const second = keep(await bootStack(config));
    expect(probeTag(second)).toBe('app');
    expect(own.inits).toBe(2);
  }, BOOT_TIMEOUT);

  it('a refused or failed boot does not hold the configuration', async () => {
    const config = app({ plugins: ['@fixture/one-composition-never-installed'] });
    await expect(bootStack(config)).rejects.toThrow();
    // The failed boot released its claim: the same object is not refused as live.
    await expect(bootStack(config)).rejects.not.toMatchObject(refusal);
  }, BOOT_TIMEOUT);
});
