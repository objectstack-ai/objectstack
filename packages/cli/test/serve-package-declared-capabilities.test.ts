// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22288 — `os serve` reads a multi-package config's PACKAGE-OWNED keys
 * through its package bodies, as it reads a one-package config's top level.
 *
 * `composeStacks([a, b], { manifest: 'preserve' })` carries each package-owned
 * collection once, inside the body of the package that declared it (ADR-0130
 * D4, 2026-09-22 addendum); its top level keeps `manifest`, `packages` and the
 * other envelope keys, and nothing a package owns. `os serve` read four such
 * keys off the top level alone. Measured on `6729e107` with bounded boots of
 * these fixtures, before the fix:
 *
 *     two packages                                       one package (control)
 *     requires ['automation']  provider not mounted;     mounted
 *                              `Optional service not present: automation`
 *     requires ['ai']          boots, no AI               exit 1 `Capability "ai" resolves to …`
 *     analyticsCubes           `Service started with 0 cubes` (os dev too)   1 cube
 *     flows, no automation     no "declared but not enabled" line (os dev too)   printed
 *     tiers without 'auth'     ignored: auth mounted, boots   refused: no auth
 *
 * The `requires` rows reach a CONFIG boot with no compiled artifact: an
 * artifact boot (`os dev`, `os start`, or `os serve` beside a built
 * `dist/objectstack.json`) already mounted the declared providers, because
 * `createStandaloneStack` resolves the artifact's packages and
 * `mergeBootConfig` lays its `requires` over the top level — measured on the
 * same tree. `tiers`, `analyticsCubes` and the flow count are not carried by
 * that path, so those rows reached every door.
 *
 * The `ai` and `tiers` rows are the two behaviours that NARROW: a package's own
 * declaration is now honoured, so the two-package app refuses exactly as the
 * one-package app always has.
 *
 * Spawned, because the decision is made inside the `serve` command body and the
 * boot banner is its contract with the operator. `runServe(` puts this file in
 * the integration tier (`packages/cli/vitest-tiers.ts`), which runs on every
 * PR. ⛔ Not named `*.e2e.test.ts`: that name moves a file to the nightly tier
 * (`vitest.config.ts`), and these pins must gate the merge. The source-level
 * enumeration of every such read is `test/normalized-call-sites.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { randomPort, runServe } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

/** The ready line. The banner it opens (`Plugins: N loaded`, `Flows:`) prints AFTER it. */
const READY = /Server is ready/;
/** The banner's LAST line: wait for it, or the plugin list and the flow line are not printed yet. */
const BANNER_END = /Press Ctrl\+C to stop/;
/** A boot that ends either way: the whole banner, or a fatal `✗` line before the child exits. */
const BANNER_END_OR_FATAL = /Press Ctrl\+C to stop|✗ [^\n]+\n/;

/** The definitions every fixture shares, as module source. */
const PIECES = `
import { defineStack, composeStacks } from '@objectstack/spec';
const svcManifest = { id: 'com.example.pdc.svc', name: 'PDC Service', namespace: 'pdc', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.pdc.app', name: 'PDC App', namespace: 'pdc', version: '1.0.0', type: 'app' };
const note = { name: 'pdc_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } } };
const ticket = { name: 'pdc_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } } };
const cube = { name: 'pdc_note_cube', title: 'Notes', sql: 'pdc_note',
  measures: { count: { label: 'Count', type: 'count', sql: '*' } },
  dimensions: { name: { label: 'Name', type: 'string', sql: 'name' } } };
const screenFlow = { name: 'pdc_screen_flow', label: 'Screen', type: 'screen',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [] };
`;

/** A two-package config whose SERVICE package carries `svcExtra`. */
const twoPackages = (svcExtra: string) => `${PIECES}
const svc = defineStack({ manifest: svcManifest, objects: [note], ${svcExtra} } as any);
const appStack = defineStack({ manifest: appManifest, objects: [ticket] } as any);
export default composeStacks([svc, appStack], { manifest: 'preserve' });
`;

const CONFIGS: Record<string, string> = {
  automationTwo: twoPackages(`requires: ['automation']`),
  automationOne: `${PIECES}
export default defineStack({ manifest: appManifest, objects: [ticket, note], requires: ['automation'] } as any);
`,
  aiTwo: twoPackages(`requires: ['ai']`),
  cubesAndFlowTwo: twoPackages(`analyticsCubes: [cube], flows: [screenFlow]`),
  tiersTwo: twoPackages(`tiers: ['core', 'i18n', 'ui', 'ai']`),
};

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-serve-package-declared-'));
  for (const [name, source] of Object.entries(CONFIGS)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    linkSpec(dir);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** The plugin names the ready banner lists under `Plugins: N loaded`. */
function bannerPlugins(output: string): string[] {
  const lines = output.split('\n');
  const at = lines.findIndex((line) => /Plugins: \d+ loaded/.test(line));
  if (at === -1 || at + 1 >= lines.length) return [];
  return lines[at + 1]!.split(',').map((name) => name.trim()).filter(Boolean);
}

const boot = async (name: string, waitFor: RegExp, extra: string[] = []) => {
  const run = await runServe(dirs[name], ['--port', randomPort(), ...extra], { waitFor, timeoutMs: 150_000 });
  return run.stdout + run.stderr;
};

describe('#22288 — `requires` a package declares mounts its provider at boot', () => {
  it('two packages: the service package\'s `automation` is mounted', async () => {
    const out = await boot('automationTwo', BANNER_END);
    expect(out).toMatch(READY);
    expect(bannerPlugins(out)).toContain('AutomationServicePlugin');
  }, 180_000);

  it('control, one package: the same `requires` mounts the same provider', async () => {
    const out = await boot('automationOne', BANNER_END);
    expect(out).toMatch(READY);
    expect(bannerPlugins(out)).toContain('AutomationServicePlugin');
  }, 180_000);

  it('two packages, a declared capability with no provider: the boot refuses, as one package always has', async () => {
    const out = await boot('aiTwo', BANNER_END_OR_FATAL);
    expect(out).not.toMatch(READY);
    expect(out).toMatch(/✗ Capability "ai"/);
  }, 180_000);
});

describe('#22288 — the other package-owned keys `os serve` reads', () => {
  it('two packages: a package\'s cubes reach the analytics provider, and its flow is counted', async () => {
    const out = await boot('cubesAndFlowTwo', BANNER_END, ['--log-level', 'info']);
    expect(out).toMatch(READY);
    const started = out.split('\n').find((line) => line.includes('[Analytics] Service started'));
    expect(started, out).toBeDefined();
    expect(started).toContain('pdc_note_cube');
    expect(out).toMatch(/Flows:\s+1 flow\(s\) declared/);
  }, 180_000);

  it('two packages: a package\'s `tiers` are honoured, so a stack without `auth` is refused', async () => {
    const out = await boot('tiersTwo', BANNER_END_OR_FATAL);
    expect(out).not.toMatch(READY);
    expect(out).toMatch(/✗ [^\n]*mounts no auth/);
  }, 180_000);
});
