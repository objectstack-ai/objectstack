// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4012 — boot-phase logger output over the REAL `os serve` process.
 *
 * `serve` blanks stdout while the kernel boots so the banner is readable, and
 * `ObjectLogger` routes `warn` to stdout — so while that window discarded its
 * bytes, no plugin's boot-phase warning reached a terminal on either CLI
 * entrypoint (`os dev` spawns `serve` with inherited stdio, so one drain
 * blinded both). Nothing above the CLI could see it: the kernel logged
 * correctly, the sink was live, and every data-phase line streamed fine.
 *
 * The replay stream moved in #7915: `serve` now forwards everything it and the
 * kernel would write to stdout onto **stderr**, unconditionally, because its
 * stdout belongs to the MCP stdio transport. What #4012 pinned is unchanged —
 * the records must reach a terminal — so the assertions below read stderr.
 *
 * Only a test that drives the actual command can catch that, so this one boots
 * a real stack through `bin/run-dev.js` and reads its output. The positive
 * control is a config-only guarantee that a boot WARN gets emitted: a declared
 * `script` action with no `body` and no registered handler, which the ADR-0110
 * D5 inventory reports as an `unboundDeclarations` finding through
 * `ctx.logger.warn`.
 *
 * That single assertion covers the whole class — it fails whenever boot-phase
 * WARNs are swallowed, whatever re-introduces the swallowing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runServe, randomPort } from './helpers/serve-process.js';

/**
 * A stack whose only interesting property is that booting it MUST log a
 * warning: `orphan_action` is a `script` action with no `body`, and nothing
 * registers a handler under `neverRegistered` — ADR-0078's "button wired to
 * nothing", which the D5 inventory warns about at `kernel:ready`.
 */
const CONFIG = `
export default {
  manifest: {
    id: 'com.example.bootdiag',
    namespace: 'bootdiag',
    version: '1.0.0',
    type: 'app',
    name: 'Boot Diagnostics Fixture',
  },
  objects: [{
    name: 'bootdiag_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
    actions: [{
      name: 'orphan_action',
      label: 'Orphan',
      type: 'script',
      target: 'neverRegistered',
    }],
  }],
};
`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-boot-diagnostics-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  // No `os compile` step. This fixture used to need the artifact beside the
  // config because config-boot itself died in `AppPlugin` with
  // "Service 'manifest' is async - use await" — filed as #4085 and fixed
  // there, so the config alone boots now.
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os serve — boot-phase logger output (#4012)', () => {
  it(
    'prints the boot WARN a plugin logged while the banner was being assembled',
    async () => {
      // Random high port: never contend with a dev server this machine is
      // already running (AGENTS.md multi-agent discipline §8).
      const port = randomPort();
      const { stdout, stderr } = await runServe(dir, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
      });

      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      // The load-bearing assertion. Before the fix this was absent at EVERY
      // log level while thousands of data-phase lines streamed past.
      expect(stderr, `[action-governance] missing from stderr${seen}`).toContain(
        '[action-governance]',
      );
      // …and it names the offender, so the line is actionable rather than just
      // present.
      expect(stderr).toContain('bootdiag_task:orphan_action');
    },
    240_000,
  );

  it(
    'streams boot output live at --log-level debug instead of hiding it',
    async () => {
      // The issue's damning evidence: `--log-level debug` emitted 2,360 lines,
      // none of them from boot — not even the kernel's own plain
      // `logger.debug('Triggering kernel:ready hook')`. At a verbose level the
      // quiet window no longer opens at all.
      const port = randomPort();
      const { stdout, stderr } = await runServe(dir, ['--port', port, '--log-level', 'debug'], {
        waitFor: /Press Ctrl\+C to stop/,
      });

      const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-2000)}`;
      expect(stderr, `boot-phase kernel traces missing${seen}`).toContain('Bootstrap complete');
      expect(stderr, `boot WARN missing at debug level${seen}`).toContain('[action-governance]');
    },
    240_000,
  );
});
