// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns `os serve` (src, via runServe) once per single-cause fixture: four boots, two refused and two that reach the ready banner; budget to be re-measured

/**
 * A stack whose `plugins` lists no plugin instance (no entry with `init`) is
 * not a host config: `os serve` boots the standalone stack and does not load
 * the authored `plugins` entries. It refuses that boot when one of those
 * entries may provide the crypto provider (`crypto-provider`), naming it:
 *
 *  - a package specifier that does not import: nothing says what it provides;
 *  - an entry that declares the crypto provider in `providesServices`;
 *  - CONTROL: an entry that declares another service: the boot goes on;
 *  - CONTROL: a stack with no `plugins` at all boots.
 *
 * A real `os serve` process per case (`runServe`): the check sits in `run()`,
 * before the standalone stack replaces the authored list.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe } from './helpers/serve-process.js';

/** Either terminal outcome: the complete ready banner, or the refusal line. */
const SETTLED = /Press Ctrl\+C to stop|Refusing to boot/;
const REFUSED = /Refusing to boot/;

const OBJECT = `objects: [{ name: 'csa_probe', label: 'Probe', fields: { title: { type: 'text', label: 'Title' } } }],`;

const CONFIGS = {
  unresolvable: `export default {
  plugins: ['@acme/not-installed-crypto-provider'],
  ${OBJECT}
};
`,
  declaring: `export default {
  plugins: [{ name: 'com.acme.kms-crypto-provider', version: '1.0.0', providesServices: ['crypto-provider'] }],
  ${OBJECT}
};
`,
  otherService: `export default {
  plugins: [{ name: 'com.acme.widgets', version: '1.0.0', providesServices: ['acme-widgets'] }],
  ${OBJECT}
};
`,
  noPlugins: `export default {
  ${OBJECT}
};
`,
} as const;

const dirs: Partial<Record<keyof typeof CONFIGS, string>> = {};

beforeAll(() => {
  for (const [key, config] of Object.entries(CONFIGS) as Array<[keyof typeof CONFIGS, string]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-crypto-plugin-set-aside-${key}-`));
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

describe('os serve — a plugins entry the standalone boot sets aside and that may provide the crypto provider', () => {
  it('a specifier that does not import: the boot is refused, naming it', async () => {
    const { output, port } = await boot('unresolvable');
    expect(output, output).toMatch(REFUSED);
    expect(output).toContain('@acme/not-installed-crypto-provider');
    expect(output).toContain("'crypto-provider'");
    expect(port, 'a refused boot binds nothing').toBeUndefined();
  }, 180_000);

  it('an entry that declares the crypto provider: the boot is refused, naming it', async () => {
    const { output, port } = await boot('declaring');
    expect(output, output).toMatch(REFUSED);
    expect(output).toContain('com.acme.kms-crypto-provider');
    expect(output).toContain("'crypto-provider'");
    expect(port).toBeUndefined();
  }, 180_000);

  it('CONTROL: an entry that declares another service: the boot goes on', async () => {
    const { output, port } = await boot('otherService');
    expect(output, output).not.toMatch(REFUSED);
    expect(port).toBeGreaterThan(0);
  }, 180_000);

  it('CONTROL: a stack with no plugins boots', async () => {
    const { output, port } = await boot('noPlugins');
    expect(output, output).not.toMatch(REFUSED);
    expect(port).toBeGreaterThan(0);
  }, 180_000);
});
