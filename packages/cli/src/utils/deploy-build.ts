// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { spawnSync } from 'node:child_process';

/**
 * `os deploy`'s build step: the same compile `os build` runs, in a child
 * `os compile`, its output streamed to this terminal so a failing build shows
 * its own reasons. Returns the child's exit status (`null` → 1).
 *
 * A child rather than an in-process call for the reason every other compile in
 * this CLI is one (`os dev`'s boot and watch compiles, `os start`): the config
 * module is evaluated in a process of its own, so nothing it does to globals
 * or the environment leaks into the publish that follows. No `NODE_ENV` is
 * written into the child — `commands/child-env-source-loader.pin.test.ts`
 * holds every command source to that.
 *
 * Its own module so a test can replace the step without spawning a CLI.
 */
export function compileForDeploy(artifactPath: string): number {
  const result = spawnSync(
    process.execPath,
    [process.argv[1], 'compile', '--output', artifactPath],
    { stdio: 'inherit' },
  );
  return result.status ?? 1;
}
