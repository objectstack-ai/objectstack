// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * `mkdirSync(dir, { recursive: true })`, bounded by the path's depth: make
 * `dir` exist, creating each missing level with a NON-recursive `mkdir`, and
 * throw the operating system's own error at once for the first level it
 * refuses (#23858).
 *
 * ## Why not `mkdirSync(dir, { recursive: true })`
 *
 * Node's recursive mkdir (v22.22.0, measured; sync and async alike) never
 * returns when a level answers `ENOENT` although its parent exists, which is
 * what `/proc` and `/sys` answer for a name they do not have. It loops
 * `mkdir("/proc/x") = ENOENT`, `mkdir("/proc") = EEXIST`, retry, and the
 * synchronous form holds the event loop while it does. Measured on
 * `origin/main` 0744f94366 at `os serve`, each in the serve process itself:
 * under `OS_HOME=/proc/os-23858-dh OS_BOOT_EMPTY=1` the empty-boot stub
 * artifact's directory made 1,107,199 failing `mkdir` calls in 25 s, and under
 * `OS_HOME=/proc/os-23858-ar` with an `http:` `OS_ARTIFACT_URL` the fetched
 * artifact's cache directory made 1,103,490.
 *
 * ## The walk
 *
 * The one `driver-sql`'s connect runs (#23696), made synchronous so it can
 * stand in for `mkdirSync` where it stood: find the nearest level that exists,
 * then create the missing ones top-down. This package's standalone host
 * prepares its SQLite directory with it too (`makeSqliteDatabaseDirectory` in
 * `standalone-stack.ts`, #24090).
 *
 * - `EEXIST` on a created level is a concurrent creator winning the race, and
 *   it is accepted only when what now stands there is a directory, as the
 *   recursive form accepts it. Anything else is the refusal, at once.
 * - A file holding the nearest existing name is answered by the operating
 *   system too: `ENOTDIR` from the first level under it, or `EEXIST` from
 *   asking for `dir` itself.
 *
 * Every input the recursive form makes, this makes; every input it refuses,
 * this refuses, with the operating system's code (`ENOENT`, `ENOTDIR`,
 * `EEXIST`, `EACCES`, …) and the path in the message. The one difference is
 * the input it never answered at all.
 *
 * Returns what the recursive form returns: the first directory this call
 * created, as an absolute path, or `undefined` when `dir` already existed.
 *
 * ⛔ Module-internal: `src/index.ts` does not export it, and the package's
 * `exports` map names that entry alone.
 */
export function makeDirectorySync(dir: string): string | undefined {
    const missing: string[] = [];
    let level = resolve(dir);
    for (;;) {
        try {
            if (!statSync(level).isDirectory() && missing.length === 0) mkdirSync(level);
            break;
        } catch (e) {
            if (errorCode(e) !== 'ENOENT') throw e;
            missing.push(level);
            const parent = dirname(level);
            if (parent === level) break;
            level = parent;
        }
    }
    let first: string | undefined;
    for (const each of missing.reverse()) {
        try {
            mkdirSync(each);
            first ??= each;
        } catch (e) {
            if (errorCode(e) !== 'EEXIST' || !isDirectory(each)) throw e;
        }
    }
    return first;
}

function errorCode(e: unknown): unknown {
    return (e as { code?: unknown } | null)?.code;
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
