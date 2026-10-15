// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding for the two `storage-upload-*.wall.test.ts` files: each pays
 * its booted wall's FIRST load at module scope, with
 * `await warmUpUploadWallBoot()`, never inside a clocked window.
 *
 * The convention is the repo's: "clocked windows measure behaviour, never
 * loading — a test that boots a real plugin chain pays its first load at
 * module top" (AGENTS.md, Build & Test). vitest clocks a file's hooks and test
 * bodies and reports their sum as the file's duration — the module line the
 * hourly timing table reads — while the module's own evaluation runs during
 * COLLECTION, which no clock covers.
 *
 * Why these files need it: both boot the same walled stack in their
 * `beforeAll`, and the first `bootStack` in a process is 2.3 to 2.8 s slower
 * than every later one (measured per boot, 4 vCPU: 3.2 to 3.8 s against 0.9 to
 * 1.2 s). The difference is first use, not the boot: the default datasource's
 * driver and better-auth's entries are `import()`ed lazily from inside the
 * boot, sql.js compiles its WASM, and every path runs cold. Without this, that
 * cost lands in the `beforeAll`, and the timing table charges it to the file.
 *
 * It is `@objectstack/verify`'s `warmUpBoot` (`boot-warm-up.testkit.ts`, which
 * that package does not export) with this package's boot: the same two plugins
 * the files mount, under the same two environment variables, set before the
 * boot and restored after it. So the lazily loaded code is loaded under the
 * environment the files' own boots load it under, and a module that reads its
 * environment once, when it is first loaded, reads the same values either way.
 *
 * ⛔ It shares nothing a case asserts on. It boots an app of its own (no
 * objects), on its own in-memory database and its own storage root, with
 * plugin instances of its own, and stops it before the file's first hook runs.
 * What stays warm is process-level: the module registry, sql.js's compiled
 * WASM and the JIT.
 *
 * ⛔ Call it at module scope, on a line of its own, never in a hook: vitest
 * clocks a hook with `hookTimeout` exactly as it clocks a test with
 * `testTimeout`. And never answer a recurrence by raising a timeout.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { OrganizationsPlugin } from '../organizations-plugin.js';

/** The environment both files' `beforeAll` sets before its boot. */
const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

/**
 * Boot a throwaway app on the walled stack the upload-wall files boot, sign
 * the seeded admin in, sign one member up, and stop.
 */
export async function warmUpUploadWallBoot(): Promise<void> {
  const restoreEnv: Array<[string, string | undefined]> = [];
  for (const [name, value] of WALLED_BOOT_ENV) {
    restoreEnv.push([name, process.env[name]]);
    process.env[name] = value;
  }
  const rootDir = mkdtempSync(join(tmpdir(), 'upload-wall-warm-up-'));
  try {
    // A fresh configuration object per call: `bootStack`'s instance rule keys
    // on identity, and nothing here may be shared with the file's own boot.
    const stack = await bootStack(
      {
        manifest: {
          id: 'com.example.uploadwallwarmup',
          namespace: 'uploadwallwarmup',
          version: '0.0.1',
          type: 'app',
          name: 'Upload Wall Warm-up',
        },
        objects: [],
      } as never,
      {
        extraPlugins: [
          new OrganizationsPlugin(),
          new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        ],
      },
    );
    try {
      await stack.signIn();
      await stack.signUp('upload-wall-warm-up@verify.test');
    } finally {
      await stack.stop();
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
