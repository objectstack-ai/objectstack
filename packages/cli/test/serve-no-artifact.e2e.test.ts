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
 *
 * framework#3887 filed the same crash from the shape every REAL project has —
 * `export default defineStack({…})` — five weeks before #4085 named it, and the
 * fix landed without ever linking it. Its repro gets its own boot below, because
 * the plain object literals above are not a substitute for it: `defineStack`
 * PARSES and NORMALIZES, so what reaches boot from an authored project carries
 * defaults no literal here writes — `datasource: 'default'` on every object and
 * a fully defaulted descriptor on every field. The literals reach boot as typed;
 * only this fixture reaches it as the spec produces it.
 *
 * That it must live under this package rather than the OS tmpdir is the same
 * point in the file system: `@objectstack/spec` is external to the config
 * bundler (`BUNDLE_REQUIRE_EXTERNALS`), so an authored config only resolves
 * where a real `node_modules` does — which is exactly why no test had ever
 * booted one, and why the gap outlived the fix.
 *
 * Scope, so nobody reads more into a green run than it earns: this pins the
 * authored shape END TO END — config loaded, app registered, server ready with
 * no `dist/` — not fault 1's mechanism. Registration order stopped being the
 * load-bearing thing when ADR-0116 (#4131) made plugin ordering a declared,
 * kernel-enforced contract; reverting the CLI-side append alone no longer
 * reproduces the crash. Both guarantees are wanted, and they are pinned at
 * different layers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * framework#3887's repro, verbatim — an authored config, not a hand-rolled
 * envelope. `defineStack` is the documented entry every scaffolded project
 * uses, and running it is the whole point: it validates and fills in defaults,
 * so this is the only fixture in the file whose objects reach boot carrying a
 * `datasource`.
 */
const DEFINE_STACK_CONFIG = `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.test.cfgload', name: 'CfgLoad', type: 'app', version: '1.0.0' },
  objects: [{ name: 'cfg_note', label: 'Note', fields: { title: { type: 'text' } } }],
});
`;

/**
 * That fixture has to RESOLVE `@objectstack/spec`, which an OS-tmpdir project
 * cannot — so it lives under this package, which declares the dependency, and
 * resolves through a real `node_modules` exactly as a user's project does.
 * `tmp/` is gitignored repo-wide; `afterAll` removes the directory regardless.
 */
const CLI_PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

let appDir: string;
let bareDir: string;
let orphanDir: string;
let defineStackDir: string;

beforeAll(() => {
  appDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-app-'));
  writeFileSync(join(appDir, 'objectstack.config.ts'), APP_CONFIG, 'utf8');

  bareDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-bare-'));
  writeFileSync(join(bareDir, 'objectstack.config.ts'), BARE_CONFIG, 'utf8');

  orphanDir = mkdtempSync(join(tmpdir(), 'os-no-artifact-orphan-'));
  writeFileSync(join(orphanDir, 'objectstack.config.ts'), UNREGISTERABLE_CONFIG, 'utf8');

  const sandbox = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sandbox, { recursive: true });
  defineStackDir = mkdtempSync(join(sandbox, 'os-no-artifact-definestack-'));
  writeFileSync(join(defineStackDir, 'objectstack.config.ts'), DEFINE_STACK_CONFIG, 'utf8');
});

afterAll(() => {
  for (const dir of [appDir, bareDir, orphanDir, defineStackDir]) {
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

      expect(stderr, `serve never reported ready${seen}`).toContain('Server is ready');
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
      expect(stderr, `app plugin missing from the boot banner${seen}`).toMatch(
        /Plugins:[\s\S]*noartifact/,
      );

      // A missing artifact is a normal state, so it must not be reported as a
      // failure — it reads as a build problem and sends readers hunting.
      expect(stdout + stderr).not.toContain('artifact read FAILED');
    },
    240_000,
  );

  it(
    'serves a config authored through defineStack(), the shape every real project has (#3887)',
    async () => {
      const { stdout, stderr } = await runServe(defineStackDir, ['--port', randomPort()], {
        waitFor: /Press Ctrl\+C to stop/,
        timeoutMs: 240_000,
      });
      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
      const out = stdout + stderr;

      // Same premise as every boot in this file: nothing was ever compiled.
      expect(existsSync(join(defineStackDir, 'dist/objectstack.json'))).toBe(false);

      expect(stderr, `serve never reported ready${seen}`).toContain('Server is ready');
      // The crash #3887 reported, and the truthful message the kernel replaced
      // it with — neither may return through the authored path either.
      expect(out).not.toMatch(/Service 'manifest' (is async|not found)/);
      expect(out).not.toMatch(/Service 'objectql' (is async|not found)/);
      expect(out).not.toContain('rollback complete');
      expect(out).not.toContain('artifact read FAILED');

      // The fixture `import`s the spec, so a config that failed to load at all
      // fails HERE rather than degrading into a green run against nothing: the
      // app is named in the started plugin set, which it can only reach by
      // having been parsed, registered, and started.
      expect(stderr, `app plugin missing from the boot banner${seen}`).toMatch(
        /Plugins:[\s\S]*cfgload/,
      );

      // And the datasource half of it, which only this fixture can state:
      // `defineStack` stamped `datasource: 'default'` onto `cfg_note`, so the
      // app's start had to find a connected driver behind that name. The banner
      // reports which one resolved, so assert it rather than leave the claim
      // resting on "boot did not throw".
      expect(stderr, `no driver resolved for the stamped datasource${seen}`).toMatch(
        /Driver:\s+\S+/,
      );
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

      expect(stderr, `bare platform never reported ready${seen}`).toContain('Server is ready');
      expect(stdout + stderr).not.toContain('rollback complete');
      // MetadataPlugin's own fatal on the absent `dist/objectstack.json`.
      expect(stdout + stderr).not.toContain('Cannot read artifact file');
    },
    240_000,
  );

  // The other side of the same principle. "The platform boots with no app" is a
  // statement about CAPABILITY, and it does not license guessing that a missing
  // input meant "boot empty". `os serve` was told to load something; the two
  // things that actually happen here are a typo'd filename and the wrong working
  // directory, and inventing a zero-object platform would hide both behind a
  // running server — the exact failure class #4085 was. So it errors, and it says
  // where it looked, which is what makes "wrong cwd" self-evident.
  it(
    'refuses, and names where it looked, when there is no config and no artifact',
    async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'os-nothing-to-serve-'));
      try {
        const { stdout, stderr } = await runServe(emptyDir, ['--port', randomPort()], {
          // It never boots, so wait on something that can only appear on the way
          // down; the harness resolves on exit regardless.
          waitFor: /Nothing to serve/,
          timeoutMs: 120_000,
          // An inherited OS_ARTIFACT_PATH would send this down the
          // artifact-fallback branch instead. Unset it for the child.
          env: { OS_ARTIFACT_PATH: undefined, OS_BOOT_EMPTY: undefined },
        });
        const out = stdout + stderr;
        const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

        expect(out, `did not refuse${seen}`).toContain('Nothing to serve');
        // Both searched locations, by absolute path.
        expect(out, `config location not named${seen}`).toContain(
          join(emptyDir, 'objectstack.config.ts'),
        );
        expect(out, `artifact location not named${seen}`).toContain('dist/objectstack.json');
        // And it points at the command that DOES boot an app-less platform,
        // instead of silently becoming it.
        expect(out).toContain('objectstack start');
        // It must not have booted.
        expect(out).not.toContain('Server is ready');
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    },
    120_000,
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
      expect(stderr, `platform died on an unregisterable app${seen}`).toContain('Server is ready');
      // …and must not be swallowed either: the operator has to learn that their
      // objects are NOT being served, and why.
      expect(out, `no warning about the skipped app${seen}`).toContain('Skipped registering the app');
      expect(out, `warning does not name the cause${seen}`).toContain('no manifest.id');
    },
    240_000,
  );
});
