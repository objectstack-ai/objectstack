// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One bounded way to obtain a `MongoMemoryServer` for this package's suites.
 *
 * `mongodb-memory-server` downloads a ~123 MB MongoDB binary from
 * fastdl.mongodb.org the first time it runs on a machine, at MODULE LOAD time
 * (these suites need the server before `describe.skipIf` can decide anything).
 * The three suites already anticipated that download FAILING: each wrapped the
 * call in try/catch and skipped itself, so a blocked download costs a skipped
 * suite rather than a red `Test Core` — the stated intent in
 * `mongodb-driver.test.ts`'s header.
 *
 * A catch cannot express the other half. When the download HANGS — socket open,
 * no bytes, no error — the top-level `await` never settles, so the suite neither
 * runs nor skips: it stops, silently, and takes the whole monorepo test job with
 * it. Observed twice on one branch (PR #4322): zero output from this package, no
 * skip warning, and `Test Core` force-killed 10 minutes later by the #4250 stall
 * guard with `@objectstack/driver-mongodb#test` as the surviving task. The same
 * task on `main` 40 minutes earlier logged `Downloading MongoDB "8.2.6": 0% …
 * 100%` and passed, so this is the network changing under an unbounded wait, not
 * a code change.
 *
 * `instance.launchTimeout` does NOT cover it: that bounds spawning `mongod`
 * once the binary is on disk, which is a later phase than the fetch.
 *
 * So the wait gets a deadline, and a timeout lands in the branch the suites
 * already had. The degraded outcome is unchanged and still visible — a warning
 * plus a skipped suite — but it is now reached in bounded time instead of never.
 * Real coverage of a real mongod is preserved wherever the binary is reachable
 * (every developer machine, and CI whenever the download works), which is the
 * property that makes skipping acceptable at all.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * How long to wait for the binary fetch + first launch before giving up.
 *
 * Generous against a slow-but-working download (the observed healthy case takes
 * seconds; this allows two orders of magnitude more) and still far inside the
 * stall guard's 10-minute silence budget, so a hung fetch is reported by THIS
 * module — naming the cause — rather than by a guard that can only say the job
 * stopped producing output.
 */
const ACQUIRE_TIMEOUT_MS = 120_000;

/**
 * A started `MongoMemoryServer`, or `undefined` when one could not be obtained
 * within {@link ACQUIRE_TIMEOUT_MS} — for any reason: download blocked, download
 * hung, or launch refused. Callers gate with `describe.skipIf(!mongod)`.
 *
 * @param suite - Suite name for the warning, e.g. `'MongoDBDriver'`.
 */
export async function createTestMongod(suite: string): Promise<MongoMemoryServer | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const started = MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => reject(new Error(
                    `timed out after ${ACQUIRE_TIMEOUT_MS / 1000}s waiting for the MongoDB binary `
                    + '(fastdl.mongodb.org unreachable or hanging)',
                )),
                ACQUIRE_TIMEOUT_MS,
            );
        });
        // Whichever settles first. On timeout the underlying `create()` promise
        // is abandoned rather than cancelled — the library exposes no cancel —
        // but the process is already headed for a skipped suite and vitest tears
        // the worker down at the end of the file.
        return await Promise.race([started, timeout]);
    } catch (err) {
        console.warn(
            `[driver-mongodb] Skipping ${suite} suite — mongodb-memory-server could not start `
            + `(MongoDB binary unavailable / download blocked or hanging): ${(err as Error)?.message ?? String(err)}`,
        );
        return undefined;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
