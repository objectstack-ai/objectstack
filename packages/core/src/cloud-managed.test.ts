// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25294 — `isCloudManaged()`, the one reader of `OS_CLOUD_MANAGED`, and its
 * production fuse (ruling 6341690661 on #25083, Q2 → D). Pin 9 as the ruling
 * reads it, one case each: a `--dev` boot with the variable runs managed; a
 * production boot with the variable and a bound control plane runs managed; a
 * production boot with the variable and no control plane refuses loudly;
 * without the variable nothing is managed. Then the fuse at both kernels'
 * `bootstrap()`, before any plugin initialises. The environment is driven
 * through `process.env` and restored; the memo is reset around every case.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from './kernel.js';
import { LiteKernel } from './lite-kernel.js';
import { isCloudManaged, resetCloudManagedForTesting, resolveControlPlaneApiKey } from './stack-auth.js';
import type { Plugin } from './types.js';

const ENV_VARS = ['OS_CLOUD_MANAGED', 'OS_CLOUD_API_KEY', 'NODE_ENV'] as const;
const saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV_VARS) delete process.env[k];
  resetCloudManagedForTesting();
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetCloudManagedForTesting();
});

/** A production boot: `NODE_ENV` as `os serve` defaults it without `--dev`. */
const production = () => { process.env.NODE_ENV = 'production'; };

describe('isCloudManaged — pin 9, as ruling 6341690661 (Q2 → D) reads it', () => {
  it('a `--dev` boot with the variable runs managed, with no control plane bound', () => {
    process.env.NODE_ENV = 'development'; // what `os serve --dev` sets
    process.env.OS_CLOUD_MANAGED = '1';
    expect(isCloudManaged()).toBe(true);
  });

  it('a production boot with the variable and a bound control plane runs managed', () => {
    production();
    process.env.OS_CLOUD_MANAGED = '1';
    process.env.OS_CLOUD_API_KEY = 'svc-key';
    expect(isCloudManaged()).toBe(true);
  });

  it('a production boot with the variable and no control plane refuses loudly, naming the variable and the binding', () => {
    production();
    process.env.OS_CLOUD_MANAGED = '1';
    expect(() => isCloudManaged()).toThrow(/^\[Kernel\] Refusing to start: OS_CLOUD_MANAGED=1 is set on a production boot with no bound control plane \(OS_CLOUD_API_KEY is unset or empty\)/);
  });

  it('without the variable nothing is managed, on any boot', () => {
    production();
    expect(isCloudManaged()).toBe(false);
    resetCloudManagedForTesting();
    process.env.OS_CLOUD_API_KEY = 'svc-key';
    expect(isCloudManaged()).toBe(false);
    resetCloudManagedForTesting();
    process.env.NODE_ENV = 'development';
    expect(isCloudManaged()).toBe(false);
  });
});

describe('isCloudManaged — the edges of the switch and of "production"', () => {
  it('NODE_ENV=test is not production: the variable alone runs managed (the services half sets it under vitest)', () => {
    process.env.NODE_ENV = 'test';
    process.env.OS_CLOUD_MANAGED = '1';
    expect(isCloudManaged()).toBe(true);
  });

  it('an unset NODE_ENV is production (`os serve` defaults it so), and a blank key is no binding', () => {
    process.env.OS_CLOUD_MANAGED = '1';
    process.env.OS_CLOUD_API_KEY = '   ';
    expect(() => isCloudManaged()).toThrow(/no bound control plane/);
  });

  it('an empty variable is off; any value but `1` is refused on every boot, naming the value', () => {
    process.env.NODE_ENV = 'development';
    process.env.OS_CLOUD_MANAGED = '';
    expect(isCloudManaged()).toBe(false);
    for (const value of ['true', '0', 'yes']) {
      resetCloudManagedForTesting();
      process.env.OS_CLOUD_MANAGED = value;
      expect(() => isCloudManaged()).toThrow(`OS_CLOUD_MANAGED is set to ${JSON.stringify(value)}`);
    }
  });

  it('memoized for the process, the refusal included, until reset', () => {
    process.env.NODE_ENV = 'test';
    expect(isCloudManaged()).toBe(false);
    process.env.OS_CLOUD_MANAGED = '1';
    expect(isCloudManaged()).toBe(false);
    resetCloudManagedForTesting();
    expect(isCloudManaged()).toBe(true);

    resetCloudManagedForTesting();
    production();
    expect(() => isCloudManaged()).toThrow(/no bound control plane/);
    process.env.OS_CLOUD_API_KEY = 'svc-key';
    expect(() => isCloudManaged()).toThrow(/no bound control plane/);
    resetCloudManagedForTesting();
    expect(isCloudManaged()).toBe(true);
  });
});

describe('resolveControlPlaneApiKey — the one derivation of "a control plane is bound"', () => {
  it('the configured value wins, even empty; else OS_CLOUD_API_KEY; trimmed; `` when neither', () => {
    expect(resolveControlPlaneApiKey()).toBe('');
    process.env.OS_CLOUD_API_KEY = '  env-key  ';
    expect(resolveControlPlaneApiKey()).toBe('env-key');
    expect(resolveControlPlaneApiKey(' cfg-key ')).toBe('cfg-key');
    expect(resolveControlPlaneApiKey('')).toBe('');
  });
});

describe('the fuse at kernel boot — refused before any plugin initialises', () => {
  const probe = () => {
    const calls: string[] = [];
    const plugin: Plugin = {
      name: 'test.cloud-managed-probe',
      init: async () => { calls.push('init'); },
      start: async () => { calls.push('start'); },
    };
    return { calls, plugin };
  };

  for (const [label, make] of [
    ['ObjectKernel', () => new ObjectKernel({ logger: { level: 'error' }, gracefulShutdown: false, skipSystemValidation: true })],
    ['LiteKernel', () => new LiteKernel({ logger: { level: 'error' } })],
  ] as const) {
    it(`${label}: a production boot with the variable and no control plane refuses; with a binding it boots`, async () => {
      production();
      process.env.OS_CLOUD_MANAGED = '1';
      const refused = probe();
      const kernel = make();
      await kernel.use(refused.plugin);
      await expect(kernel.bootstrap()).rejects.toThrow(/no bound control plane/);
      expect(refused.calls).toEqual([]);

      resetCloudManagedForTesting();
      process.env.OS_CLOUD_API_KEY = 'svc-key';
      const booted = probe();
      const second = make();
      await second.use(booted.plugin);
      await second.bootstrap();
      expect(booted.calls).toEqual(['init', 'start']);
      expect(isCloudManaged()).toBe(true);
      await second.shutdown();
    });
  }
});
