// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os verify --app <dir>/objectstack.config.mjs`, run from a working
 * directory that is NOT the app's, boots the app anchored at the app's own
 * directory (#22301).
 *
 * ## The defect
 *
 * `bootStack` composes what `objectstack serve` composes from a configuration
 * (ruling A on #22301): the providers its `requires` names and the plugins of
 * its own `plugins` array. Every app-relative read of that composition is
 * anchored at `BootOptions.hostRoot` — a declarative connector's
 * package-relative file ref, a string `plugins` entry, the multi-tenant
 * package — and `os verify` handed it no `hostRoot`, so it defaulted to the
 * process cwd. Measured in CI (`Dogfood Verify CLI`, which runs
 * `os verify --app examples/app-showcase/objectstack.config.ts --rls` from the
 * repository root): the boot refused the showcase's `showcase_status_openapi`
 * connector, its `./src/system/connectors/status-openapi.json` resolved
 * against the repository root (ENOENT). `serve` anchors the same reads at the
 * directory holding the config; `os verify` now does too.
 *
 * ## What is pinned
 *
 * The app declares a string `plugins` entry that only ITS directory can
 * resolve: a package installed in the app's own `node_modules` and declared in
 * the app's own `package.json`. Run from an empty directory elsewhere, the
 * verify still loads it — the plugin's `init` leaves a marker beside the
 * package — and the run passes. Anchored at the cwd instead, the entry does
 * not resolve and the boot refuses it, naming `plugins[0]`.
 *
 * Spawned rather than run in-process: the subject is the process working
 * directory, which only a real process has.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

/** A package only the app's own directory declares and installs. */
const APP_ONLY_PLUGIN = '@fixture/verify-host-root-plugin';
/** What the plugin's `init` writes beside itself, so its having run is observable from outside. */
const MOUNTED_MARKER = 'mounted.marker';

const STACK = {
  manifest: {
    id: 'com.example.verify-host-root',
    namespace: 'vhr',
    version: '1.0.0',
    name: 'Verify Host Root',
    type: 'app',
    engines: { protocol: '^17' },
  },
  objects: [
    {
      name: 'vhr_note',
      label: 'Note',
      pluralLabel: 'Notes',
      sharingModel: 'private',
      fields: {
        title: { type: 'text', label: 'Title', required: true },
      },
    },
  ],
  plugins: [APP_ONLY_PLUGIN],
};

/** The plugin package, written into the app's own `node_modules`. */
function installAppOnlyPlugin(appDir: string): string {
  const pkgDir = join(appDir, 'node_modules', ...APP_ONLY_PLUGIN.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: APP_ONLY_PLUGIN, version: '1.0.0', type: 'module', exports: { '.': './index.js' } }),
  );
  writeFileSync(
    join(pkgDir, 'index.js'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      'export default {',
      "  name: 'com.fixture.verify-host-root',",
      "  version: '1.0.0',",
      "  type: 'standard',",
      '  async init() {',
      `    writeFileSync(fileURLToPath(new URL('./${MOUNTED_MARKER}', import.meta.url)), 'mounted');`,
      '  },',
      '};',
      '',
    ].join('\n'),
  );
  return pkgDir;
}

describe('os verify anchors the app at its own directory, not the process cwd (#22301)', () => {
  let appDir: string;
  let elsewhere: string;
  let pluginDir: string;
  let run: { status: number | null; stdout: string; stderr: string };

  beforeAll(() => {
    appDir = mkdtempSync(join(tmpdir(), 'os-verify-host-root-app-'));
    elsewhere = mkdtempSync(join(tmpdir(), 'os-verify-host-root-cwd-'));
    writeFileSync(join(appDir, 'objectstack.config.mjs'), defineStackSource(STACK));
    // The declaration the host importer reads: the app — and only the app — declares the package.
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: 'verify-host-root-app', version: '0.0.0', dependencies: { [APP_ONLY_PLUGIN]: '1.0.0' } }),
    );
    linkSpec(appDir);
    pluginDir = installAppOnlyPlugin(appDir);

    // Through tsx, so the child runs this checkout's `src/` (see verify-json-stdout.test.ts).
    const r = spawnSync(TSX, [CLI, 'verify', '--app', join(appDir, 'objectstack.config.mjs')], {
      cwd: elsewhere,
      encoding: 'utf8',
      env: childEnv({ NO_COLOR: '1' }),
      maxBuffer: 64 * 1024 * 1024,
    });
    run = { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }, 360_000);

  afterAll(() => {
    for (const dir of [appDir, elsewhere]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('premise: the working directory is not the app directory, and declares nothing', () => {
    expect(elsewhere).not.toBe(appDir);
    expect(existsSync(join(elsewhere, 'package.json'))).toBe(false);
  });

  it("loads the app's own plugin from the app's directory, and the verify passes", () => {
    expect(run.status, `os verify failed from a foreign cwd:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect(existsSync(join(pluginDir, MOUNTED_MARKER)), "the app's plugin never ran").toBe(true);
    expect(run.stdout).toContain('verify passed');
  });
});
