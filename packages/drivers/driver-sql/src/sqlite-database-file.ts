// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * A SQLite database file this driver cannot open or create (#23696), or one
 * whose bytes are not a SQLite database (#24960).
 *
 * Thrown by `SqlDriver.connect()`, so the boot's connect refusal (ADR-0062 D5,
 * `datasource '<name>': connect failed — <reason>`) carries the path and the
 * operating system's own answer instead of waiting for a plugin start timeout.
 * `code` is the underlying error's (`ENOENT`, `EACCES`, `ENOTDIR`,
 * `SQLITE_CANTOPEN`, `SQLITE_NOTADB`, …) and `cause` the error itself.
 */
export class SqliteDatabaseFileError extends Error {
  readonly code: string | undefined;
  readonly filename: string;
  /** The error the operating system or SQLite answered. */
  readonly cause: unknown;

  constructor(filename: string, detail: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const code = (cause as { code?: unknown } | null | undefined)?.code;
    const where = isAbsolute(filename) ? `'${filename}'` : `'${filename}' (resolved: '${resolve(filename)}')`;
    super(`SQLite database file ${where} ${detail}: ${reason}`);
    this.name = 'SqliteDatabaseFileError';
    this.code = typeof code === 'string' ? code : undefined;
    this.filename = filename;
    this.cause = cause;
  }
}

/**
 * Make `dir` exist, creating each missing level with a NON-recursive `mkdir`,
 * and reject at once with the first level the operating system refuses.
 *
 * ## Why not `mkdir(dir, { recursive: true })`
 *
 * Node's recursive mkdir (v22.22.0, measured; sync and async alike) never
 * settles when a level answers `ENOENT` although its parent exists. On
 * `/proc/os-23696` it loops `mkdir("/proc/os-23696") = ENOENT`,
 * `mkdir("/proc") = EEXIST`, `statx("/proc")` (a directory, so retry the
 * child) without end — about 1,640 failing `mkdir` calls a second, all of
 * it system CPU. A declared SQLite datasource whose directory lay on such a
 * path never finished its connect, and the boot was refused only by a plugin
 * start timeout that named neither the datasource nor the path.
 *
 * The walk below is bounded by the path's depth: find the nearest level that
 * exists, then create the missing ones top-down. `EEXIST` on a level is a
 * concurrent creator winning the race and is accepted; any other refusal is
 * the answer. When a file holds the nearest existing name, the operating
 * system answers for it too: `ENOTDIR` from the first missing level under it,
 * or `EEXIST` from asking for `dir` itself.
 */
export async function makeDatabaseDirectory(dir: string): Promise<void> {
  const missing: string[] = [];
  let level = resolve(dir);
  for (;;) {
    try {
      if (!(await stat(level)).isDirectory() && missing.length === 0) await mkdir(level);
      break;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== 'ENOENT') throw e;
      missing.push(level);
      const parent = dirname(level);
      if (parent === level) break;
      level = parent;
    }
  }
  for (const each of missing.reverse()) {
    try {
      await mkdir(each);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== 'EEXIST') throw e;
    }
  }
}
