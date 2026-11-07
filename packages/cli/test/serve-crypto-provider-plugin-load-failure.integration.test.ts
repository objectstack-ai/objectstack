// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns `os serve` (src, via runServe) once per single-cause fixture: four boots, two refused and two that reach the ready banner; budget to be re-measured

/**
 * `os serve` refuses to boot when a `plugins` entry fails to load and it cannot
 * rule out that the entry provides the crypto provider (`crypto-provider`).
 *
 * The crypto provider seals every secret the deployment holds. A boot that
 * goes on without the plugin that provides it chooses another one at
 * `kernel:ready`, so this boot refuses instead, naming the entry. That is the
 * rule the one-shot secret commands keep for the same host config.
 *
 *  - an entry that does not materialize (a specifier that does not resolve):
 *    nothing says what it provides, so the boot is refused;
 *  - an entry that materializes, declares the crypto provider in
 *    `providesServices`, and is refused by the kernel: refused;
 *  - CONTROL: an entry that materializes, declares nothing of the kind, and is
 *    refused by the kernel: the boot goes on, as before, and says so;
 *  - CONTROL: a config whose every entry loads boots.
 *
 * A real `os serve` process per case (`runServe`): the refusal is a property of
 * the boot loop inside `run()`, which no in-process call reaches.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe } from './helpers/serve-process.js';

/** Either terminal outcome: the complete ready banner, or the refusal line. */
const SETTLED = /Press Ctrl\+C to stop|Refusing to boot/;
const REFUSED = /Refusing to boot/;

const OBJECT = `objects: [{ name: 'cpl_probe', label: 'Probe', fields: { title: { type: 'text', label: 'Title' } } }],`;

const CONFIGS = {
  // A plugin instance beside the specifier makes this a host config, whose
  // `plugins` the boot loop mounts (a config of specifiers alone boots the
  // library stack instead).
  unresolvable: `export default {
  plugins: [{ name: 'com.acme.host', version: '1.0.0', init: async () => {} }, '@acme/not-installed-crypto-provider'],
  ${OBJECT}
};
`,
  declaringRefused: `export default {
  plugins: [{
    name: 'com.acme.kms-crypto-provider',
    version: 'not-a-version',
    providesServices: ['crypto-provider'],
    init: async () => {},
  }],
  ${OBJECT}
};
`,
  nonDeclaringRefused: `export default {
  plugins: [{
    name: 'com.acme.unrelated',
    version: 'not-a-version',
    providesServices: ['acme-widgets'],
    init: async () => {},
  }],
  ${OBJECT}
};
`,
  allLoad: `export default {
  plugins: [{ name: 'com.acme.fine', version: '1.0.0', init: async () => {} }],
  ${OBJECT}
};
`,
} as const;

const dirs: Partial<Record<keyof typeof CONFIGS, string>> = {};

beforeAll(() => {
  for (const [key, config] of Object.entries(CONFIGS) as Array<[keyof typeof CONFIGS, string]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-crypto-plugin-load-${key}-`));
    writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
    dirs[key] = dir;
  }
});

afterAll(() => {
  for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
});

const boot = async (key: keyof typeof CONFIGS) => {
  const run = await runServe(dirs[key]!, [], { waitFor: SETTLED, timeoutMs: 150_000 });
  return { ...run, output: run.stdout + run.stderr };
};

describe('os serve — a plugins entry that fails to load and may provide the crypto provider', () => {
  it('an entry that does not materialize: the boot is refused, naming the entry', async () => {
    const { output, port } = await boot('unresolvable');
    expect(output).toContain('Failed to load plugin');
    expect(output, output).toMatch(REFUSED);
    expect(output).toContain('@acme/not-installed-crypto-provider');
    expect(output).toContain("'crypto-provider'");
    expect(port, 'a refused boot binds nothing').toBeUndefined();
  }, 180_000);

  it('an entry that declares the crypto provider and is refused by the kernel: the boot is refused, naming it', async () => {
    const { output, port } = await boot('declaringRefused');
    expect(output).toContain('Failed to load plugin');
    expect(output, output).toMatch(REFUSED);
    expect(output).toContain('com.acme.kms-crypto-provider');
    expect(port).toBeUndefined();
  }, 180_000);

  it('CONTROL: an entry that declares no crypto provider and is refused by the kernel: the boot goes on', async () => {
    const { output, port } = await boot('nonDeclaringRefused');
    expect(output).toContain('Failed to load plugin');
    expect(output, output).not.toMatch(REFUSED);
    expect(output).toMatch(/Press Ctrl\+C to stop/);
    expect(port).toBeGreaterThan(0);
  }, 180_000);

  it('CONTROL: a config whose every entry loads boots', async () => {
    const { output, port } = await boot('allLoad');
    expect(output).not.toContain('Failed to load plugin');
    expect(output, output).not.toMatch(REFUSED);
    expect(port).toBeGreaterThan(0);
  }, 180_000);
});
