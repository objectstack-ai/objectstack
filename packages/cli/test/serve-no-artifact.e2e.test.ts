// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4085 — `os serve` boots WITHOUT a compiled `dist/objectstack.json`.
 *
 * ObjectStack is a development platform: the artifact defines an *application*,
 * and the platform must start with no application at all. Config-boot is a
 * first-class documented path (`serve` prints `Loading objectstack.config.ts…`),
 * and a freshly authored project has no `dist/` until its first `os compile`.
 *
 * It nevertheless died in Phase 1 with `Service 'manifest' is async - use await`
 * whenever the artifact was absent — two faults, both invisible:
 *
 *   1. `serve` registered the config-derived `AppPlugin` BEFORE the stack's own
 *      `plugins[]` (ObjectQLPlugin, which registers `manifest`/`objectql`;
 *      DefaultDatasourcePlugin, which connects the DB the app seeds through).
 *      Registration order IS the kernel's init/start order. The artifact path
 *      never hit it because `createStandaloneStack` appends ITS AppPlugin after
 *      the engine — which is what made a plugin-ORDER bug look
 *      artifact-related.
 *   2. `MetadataPlugin` treated its absent `local-file` artifact as fatal, so
 *      even a stack with no app at all could not boot.
 *
 * Both live above the kernel — in what the command assembles and in what boot
 * treats as fatal — so only a test driving the real `os serve` process pins
 * them. These two boots are that pin: no `os compile` anywhere in this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort } from './helpers/serve-process.js';

/** An ordinary app: manifest + an object, exactly what `os init` scaffolds. */
const APP_CONFIG = `
export default {
  manifest: {
    id: 'com.example.noartifact',
    version: '1.0.0',
    type: 'app',
    name: 'No Artifact Fixture',
  },
  objects: [{
    name: 'noart_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
  }],
};
`;

/**
 * The platform with NO application: no manifest, no objects, nothing to
 * compile. This is what "the platform does not need an app to start" means at
 * its limit, and it is the shape `os init` leaves before any metadata is
 * authored.
 */
const BARE_CONFIG = `
export default {};
`;

/**
 * An app payload with no `manifest.id`/`name` — the one envelope `AppPlugin`
 * rejects by construction. The platform must still serve (a bad app is not a
 * bad platform), but it has to SAY the app was skipped: the CLI used to swallow
 * this into a silent `catch`, leaving a server answering with zero objects and
 * no stated reason — the same invisible-boot-failure class as #4085 itself.
 */
const UNREGISTERABLE_CONFIG = `
export default {
  objects: [{
    name: 'orphan_task',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

let appDir: string;
let bareDir: string;
let orphanDir: string;

beforeAll(() => {
  appDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-app-'));
  writeFileSync(join(appDir, 'objectstack.config.ts'), APP_CONFIG, 'utf8');

  bareDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-bare-'));
  writeFileSync(join(bareDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');

  orphanDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-orphan-'));
  writeFileSync(join(orphanDir, 'objectstack.config.ts'), UNREGISTERABLE_CONFIG, 'utf8');
});

afterAll(() => {
  for (const dir of [appDir, bareDir, orphanDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('os serve — boots without a compiled artifact (#4085)', () => {
  it(
    'serves an app defined only by objectstack.config.ts',
    async () => {
      const { stdout, stderr } = await runServe(appDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      // No artifact was built — the whole point.
      expect(existsSync(join(appDir, 'dist/objectstack.json'))).toBe(false);

      expect(stdout, `serve never reported ready${seen}`).toContain('Server is ready');
      // The exact Phase-1 death this issue filed, in either of its spellings
      // (the misleading "is async" one and the truthful "not found" the kernel
      // now reports).
      expect(stdout + stderr).not.toMatch(/Service 'manifest' (is async|not found)/);
      expect(stdout + stderr).not.toMatch(/Service 'objectql' (is async|not found)/);
      expect(stdout + stderr).not.toContain('rollback complete');

      // Not merely "did not crash": the config-derived app is IN the started
      // plugin set, so its init registered the manifest and its start seeded
      // through a connected datasource. A failure in either aborts boot before
      // the banner, so reaching this line with the app listed is the real
      // guarantee.
      expect(stdout, `app plugin missing from the boot banner${seen}`).toMatch(
        /Plugins:[\s\S]*noartifact/,
      );

      // A missing artifact is a normal state, so it must not be reported as a
      // failure — it reads as a build problem and sends readers hunting.
      expect(stdout + stderr).not.toContain('artifact read FAILED');
    },
    240_000,
  );

  it(
    'serves a config with no application at all',
    async () => {
      const { stdout, stderr } = await runServe(bareDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      expect(stdout, `bare platform never reported ready${seen}`).toContain('Server is ready');
      expect(stdout + stderr).not.toContain('rollback complete');
      // MetadataPlugin's own fatal on the absent `dist/objectstack.json`.
      expect(stdout + stderr).not.toContain('Cannot read artifact file');
    },
    240_000,
  );

  it(
    'serves on, and says why, when the config carries an app it cannot register',
    async () => {
      const { stdout, stderr } = await runServe(orphanDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
      const out = stdout + stderr;

      // A rejected app must not take the platform down…
      expect(stdout, `platform died on an unregisterable app${seen}`).toContain('Server is ready');
      // …and must not be swallowed either: the operator has to learn that their
      // objects are NOT being served, and why.
      expect(out, `no warning about the skipped app${seen}`).toContain('Skipped registering the app');
      expect(out, `warning does not name the cause${seen}`).toContain('no manifest.id');
    },
    240_000,
  );
});
