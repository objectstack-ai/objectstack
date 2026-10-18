// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: a test file that boots a real stack pays the boot's FIRST
 * load at module scope, with `await warmUpBoot(...)`, never inside a clocked
 * window.
 *
 * The convention is the repo's: "clocked windows measure behaviour, never
 * loading — a test that boots a real plugin chain pays its first load at
 * module top" (AGENTS.md, Build & Test; `scripts/check-test-source-alias.mjs`
 * carries the measurement behind it). `@vitest/runner` wraps hooks and test
 * bodies in `withTimeout(...)` and reports their duration as the file's time,
 * while it awaits the module's own evaluation during COLLECTION, which no
 * clock covers.
 *
 * Why this package needs it: the first `bootStack` in a test file is 2 to 3 s
 * slower than every later one in that file (measured per boot, isolated,
 * 4 vCPU: 2.7 to 4.2 s against 0.75 to 1.25 s), and the difference is first
 * use, not the boot: the default datasource's drivers and better-auth's
 * entries are `import()`ed lazily from inside the boot, sql.js compiles its
 * WASM, and every path runs cold. Without this, that cost lands in whichever
 * `beforeAll` or `it` boots first, and the hourly timing table charges it to
 * the file. A warm-up took 1.2 to 3.8 s off the clocked time of each of the 24
 * files of this package that the table listed (isolated, one run each).
 *
 * Why a WHOLE throwaway boot rather than a list of module-top imports: the
 * lazily loaded modules (`@objectstack/driver-sql`,
 * `@objectstack/driver-sqlite-wasm`, `better-auth` and its plugins) are not
 * this package's dependencies, so importing them here would be an undeclared
 * import, and a list would drift as the boot changes. Running the boot, a
 * sign-in and a sign-up pays all of it through this package's own harness.
 *
 * What it shares. It boots an app of its own (no objects), under a
 * configuration object of its own, on its own in-memory database, and stops
 * it before the file's first hook runs, so no kernel, row, service instance or
 * configuration claim outlives it. What outlives it is the PROCESS's state —
 * under vitest's per-file isolation, the file's — which the file's own boots
 * then inherit instead of creating:
 *
 *  - the harness's data key: `harnessCryptoProvider()` in `harness.ts` builds
 *    the process's crypto provider on the process's FIRST boot and keeps it, so
 *    every later boot seals and opens under the provider the warm-up built;
 *  - `NODE_ENV`: `bootStack` sets it to `development` and never restores it,
 *    so the module code after the warm-up, and every case before the file's
 *    own first boot, runs under `development` instead of vitest's `test`;
 *  - what the loaded modules keep for the life of the process: the module
 *    registry, sql.js's compiled WASM, the JIT, better-auth's process-global
 *    context holder, and each module's own memos and once-per-process notices.
 *
 * That is safe for a case that asserts on none of it, because none of it
 * changes what a boot does: the provider is built by the same code from the
 * same input whichever boot builds it (a random key, no environment read, no
 * key file), and every `bootStack` sets `NODE_ENV` before it reads anything.
 * Only WHEN that state is created moves, and so under which environment.
 *
 * ⛔ So a file whose case asserts on that state takes no warm-up: on how or
 * under which environment the data key is built, on `NODE_ENV` before its
 * first boot, or on a notice a module says once per process.
 * `harness.key-custody.test.ts` is the measured case: it sets its keyless
 * posture in a hook, a warm-up would build the provider at module scope before
 * that posture exists, and a provider that minted a key file would then mint it
 * outside the posture the file inspects, so the pin would stay green over it.
 *
 * ⛔ Call it at module scope, on a line of its own, never in a hook: vitest
 * clocks a hook with `hookTimeout` exactly as it clocks a test with
 * `testTimeout`. And never answer a recurrence by raising a timeout.
 *
 * ```ts
 * await warmUpBoot({ automation: true });
 * ```
 */

import { bootStack, type BootOptions } from './harness.js';

/** What the throwaway app declares, beside its manifest. */
export interface WarmUpShape {
  /**
   * The capability tokens the file's own app `requires`, so the providers its
   * boot mounts are loaded here too (see `required-providers.ts`).
   */
  requires?: readonly string[];
}

/**
 * Boot a throwaway app with `opts`, sign the seeded admin in, sign one member
 * up, and stop. Pass the options (and the `requires`) the file's own first
 * boot uses, so the same lazily loaded code is paid for here.
 */
export async function warmUpBoot(opts: BootOptions = {}, shape: WarmUpShape = {}): Promise<void> {
  // A fresh configuration object per call: `bootStack`'s instance rule keys on
  // identity, and nothing here may be shared with the file's own boots.
  const config = {
    manifest: { id: 'com.example.boot-warm-up', namespace: 'warmup', version: '0.0.1', type: 'app', name: 'Boot Warm-up' },
    objects: [],
    ...(shape.requires ? { requires: [...shape.requires] } : {}),
  };
  const stack = await bootStack(config, opts);
  try {
    await stack.signIn();
    await stack.signUp('boot-warm-up@verify.test');
  } finally {
    await stack.stop();
  }
}
