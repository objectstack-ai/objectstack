// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FIXTURE — not part of this app's suite.
 *
 * `vitest.config.ts` excludes `test/fixtures/**`, so a normal
 * `pnpm --filter @objectstack/example-showcase test` never collects this file.
 * It is run only by `test/vitest-console-teardown-race.test.ts`, which spawns
 * vitest against THIS directory as its root (at which point the exclude no
 * longer matches, because the path is relative to the root being used).
 *
 * WHAT IT REPRODUCES. The file passes its one assertion and then leaves a
 * `console.log` rescheduling itself past the end of the file — the shape #9371
 * had (a messaging dispatcher that outlived its test file) and the shape any
 * leaked timer, poll or fire-and-forget write has. In a worker whose console is
 * intercepted, each of those logs is an `onUserConsoleLog` RPC whose promise
 * vitest discards, so one landing inside the teardown window is rejected with
 * `EnvironmentTeardownError` and nobody holds it — an unhandled rejection, and
 * vitest fails a run on an unhandled error even with zero failed assertions.
 *
 * ⛔ Do not "fix" the leak here. The leak IS the instrument.
 */

import { it, expect } from 'vitest';

it('passes, and leaves a console.log rescheduling past the end of the file', () => {
  const tick = (): void => {
    console.log('late log from a callback that outlived the test file');
    setImmediate(tick).unref?.();
  };
  setImmediate(tick).unref?.();

  expect(1).toBe(1);
});
