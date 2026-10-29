// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { accessSync, constants } from 'node:fs';

// The `test.env` that moves a suite's temp directory onto a memory-backed
// filesystem. A package whose tests write real files under `os.tmpdir()`
// (SQLite databases, scaffolded projects) spreads it into its own config:
//
//   test: { disableConsoleIntercept: true, env: memoryBackedTmpEnv() }
//
// Not a key of `vitest.preset.mts`: that preset carries one setting for every
// re-exporter, and this one belongs only to the suites whose wall time was
// measured against the disk.
//
// ## Why
//
// On a Test Core shard the runner's disk is shared by every suite running
// beside this one. A case that fsyncs a file, or a hook that unlinks a tree of
// them, waits for that disk's queue, so its wall time measures the
// neighbours' I/O, not the code. Measured with four `dd … conv=fsync` writers
// on the same disk (#27076, #27306): cases that take tens of milliseconds idle
// took seconds and timed out, while with TMPDIR on /dev/shm under the same
// writers they stayed at their idle times. The code under test runs unchanged
// on a tmpfs, `fsync` included; only the wait for unrelated I/O is gone.
//
// `os.tmpdir()` reads TMPDIR on every call, and a child process the suite
// spawns inherits it, so the one setting covers both. A path built from the
// package or the repository does not follow TMPDIR and is not moved by this.
//
// A host without a writable /dev/shm (macOS, Windows) keeps its own temp
// directory: the setting is absent there, not an error.
const MEMORY_BACKED_TMP = '/dev/shm';

function writableDir(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function memoryBackedTmpEnv(): Record<string, string> {
  return writableDir(MEMORY_BACKED_TMP) ? { TMPDIR: MEMORY_BACKED_TMP } : {};
}
