// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4095 — a config-booted app lost its `onEnable`, so every `script`
 * action was DECLARED and none was EXECUTABLE.
 *
 * `os serve <config>` calls `createStandaloneStack()`, which reads
 * `dist/objectstack.json` and hands back a ready-made `AppPlugin`. That satisfied
 * serve's "does the host already wrap itself?" guard, so the
 * `new AppPlugin(config)` built from the loaded MODULE — the only one carrying
 * the module's `onEnable` — was skipped. A JSON artifact cannot hold a function,
 * so the app booted with all of its metadata and none of its code.
 *
 * Only a test that drives the real command can catch it: the loss happens in the
 * join between the artifact-derived stack and the loaded module, and neither half
 * is wrong on its own.
 *
 * The oracle is the ADR-0110 D5 inventory (visible on the CLI since #4012): a
 * `script` action whose handler is registered in `onEnable` reconciles as BOUND
 * when the hook ran, and is reported under `[action-governance]` when it did not.
 * Confirmed to fail against the pre-fix command, naming `hookfix_task:do_thing`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort, CLI, TSX } from './helpers/serve-process.js';

const execFileP = promisify(execFile);

/**
 * An app whose action is only executable if its module-level `onEnable` runs:
 * `do_thing` is a `script` action with no `body`, targeting a handler that
 * nothing but `onEnable` registers. Compiling this yields an artifact carrying
 * the declaration and — being JSON — none of the code.
 */
const CONFIG = `
export const onEnable = async (ctx) => {
  ctx.ql.registerAction('hookfix_task', 'doThing', () => ({ ok: true }));
};

export default {
  manifest: {
    id: 'com.example.hookfix',
    namespace: 'hookfix',
    version: '1.0.0',
    type: 'app',
    name: 'Runtime Hook Fixture',
  },
  objects: [{
    name: 'hookfix_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
    actions: [{
      name: 'do_thing',
      label: 'Do Thing',
      type: 'script',
      target: 'doThing',
    }],
  }],
};
`;

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-runtime-hooks-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  // The artifact is REQUIRED by this test, and for a positive reason rather than
  // as a workaround: it is what makes `createStandaloneStack()` contribute an
  // artifact-derived `AppPlugin`, which is the bundle whose missing code this
  // regression is about. Without it serve wraps the config directly (#4085/#4110
  // made that path boot), `onEnable` runs for the trivial reason, and the test
  // would pass while exercising nothing.
  await execFileP(TSX, [CLI, 'compile'], {
    cwd: dir,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
}, 240_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os serve — an app booted from its artifact keeps its module code (#4095)', () => {
  it('runs onEnable, so the declared script action has a handler', async () => {
    const { stdout, stderr } = await runServe(dir, ['--port', randomPort()], {
      waitFor: /Press Ctrl\+C to stop/,
    });

    const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

    // Sanity: the boot has to have got far enough for the inventory to run at
    // all, or "no warning" would be vacuously true.
    expect(stderr, `serve never reached its banner${seen}`).toMatch(/Server is ready/);

    // The load-bearing assertion. Pre-fix this reported
    // `{"count":1,"actions":["hookfix_task:do_thing"]}` — declared, no handler.
    expect(stderr, `the action's handler went unregistered${seen}`).not.toContain(
      '[action-governance]',
    );
    expect(stderr).not.toContain('hookfix_task:do_thing');

    // And the config's code was not merely tolerated in silence: nothing should
    // report it as orphaned either. One stream covers both since #7915 — every
    // human line `serve` prints goes to stderr.
    expect(stdout + stderr).not.toContain('no app bundle claimed');
  }, 240_000);
});
