// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One bounded way to obtain a `MongoMemoryServer` for this package's suites —
 * and, since #5517, the OPT-IN GATE in front of it.
 *
 * ## Why these suites are opt-in (#5517, maintainer decision 2026-08-05)
 *
 * `mongodb-memory-server` downloads a ~123 MB MongoDB binary from
 * fastdl.mongodb.org the first time it runs on a machine, and seven suites in
 * this package need it. On a runner with a cold binary cache — the normal state
 * of a merge-queue runner — two vitest workers start that download at the same
 * time and the loser corrupts the run. The mechanism is in the library, one
 * unawaited promise, `mongodb-memory-server-core@11.2.0`
 * `lib/util/MongoBinaryDownload.js:405-415`:
 *
 * ```js
 * fileStream.on('finish', async () => {          // async listener, nobody awaits it
 *   ...
 *   await fs.promises.rename(tempDownloadLocation, downloadLocation);   // :413
 *   resolve(downloadLocation);
 * });
 * ```
 *
 * The winner renames `<binary>.tgz.downloading` to `<binary>.tgz`. The loser's
 * `rename` then throws `ENOENT`, and because the listener is `async` and
 * fire-and-forget, that rejection reaches NOBODY: the enclosing `new Promise`
 * neither resolves nor rejects, so
 *
 *   1. the loser's `MongoMemoryServer.create()` never settles — it is
 *      {@link ACQUIRE_TIMEOUT_MS} that ends the wait, which is the observed
 *      "timed out after 120s" skip; and
 *   2. the `ENOENT` surfaces as a process-level **unhandled rejection**, which
 *      vitest reports as `Errors 1 error` and turns into `exit 1` even though
 *      every test passed.
 *
 * That is why the two field shapes #5517 lists — "two suites race" and "one
 * suite times out and its abandoned download blows up the run" — are ONE event
 * seen from two sides, and why no consumer-side `.catch()` on the `create()`
 * promise can fix it: the error never travels through that promise. It cost the
 * merge queue at least three red builds in one day and ejected unrelated PRs.
 *
 * The maintainer's call was to RETIRE the download rather than build
 * single-flight / prewarm infrastructure. Two premises stood behind that call
 * and only one of them survives.
 *
 * The survivor is the MEASURED merge-queue hazard above: the unsettleable
 * promise cost at least three red builds in one day and ejected unrelated PRs,
 * which is what made this download not worth its coverage. That measurement is
 * independent of any investment posture, so the retirement stands on it alone.
 *
 * The premise that is GONE is #5499, this driver family's investment freeze —
 * the clause that used to answer "why not just build the infrastructure
 * instead". It dissolved 2026-08-11 (head note of `@objectstack/spec`'s
 * `aggregation-conformance.ts`).
 *
 * So, still: no `globalSetup` pre-download, no cross-worker lock, no workflow
 * cache warming — but read that as NOBODY HAS BUILT IT, and never as "it must
 * not be built". Nothing forbids building it now; the measured hazard above is
 * why it was not worth building. Whether the opt-in coverage now justifies that
 * infrastructure is a maintainer call about coverage versus CI cost — a
 * separate card, not this file's to settle.
 *
 * The binary-dependent suites simply do not run unless a
 * human asks for them with {@link MONGOD_TESTS_ENV}, and the gate is checked
 * before the library is even imported, so a default run starts zero downloads.
 *
 * The retirement is deliberately LOUD, not silent: every gated suite prints one
 * line naming #5517 and the switch, so the missing coverage is discoverable
 * rather than folklore. What a default run honestly loses: the real-mongod
 * halves of the filter-logic / temporal / pagination conformance matrices.
 * `scripts/check-driver-conformance.mjs` keeps passing on the server-free
 * halves, which still run — see the note recorded in that ledger.
 *
 * ## Running them
 *
 * ```bash
 * OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1 pnpm --filter @objectstack/driver-mongodb test
 * ```
 *
 * The first run downloads the binary; later runs reuse `~/.cache/mongodb-binaries`
 * and never race. An opt-in run that cannot get a binary still DEGRADES to a
 * named skip rather than going red — the pre-#5517 behaviour, kept because a
 * developer's network is not a test failure — and
 * {@link installAbandonedDownloadGuard} keeps the abandoned download from
 * ejecting that run.
 *
 * Deliberately NOT added: an `OS_EXPECT_*` "this runner provisioned it, so a skip
 * is a defect" switch (the `OS_EXPECT_LIVE_DIALECT_MATRIX` shape). Nothing
 * provisions a mongod binary in CI any more, so the flag would have no consumer;
 * it belongs with whatever future decision un-freezes this family.
 */

// Type-only: erased at compile time, so importing THIS module cannot pull in
// `mongodb-memory-server`. The value import lives behind the gate, in
// `createTestMongod`. `mongodb-memory-server-gate.test.ts` pins that property.
import type { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Opt-in switch for every suite in this package that needs a real mongod.
 *
 * `OS_TEST_*` per Prime Directive #9's test/CI-only shape and `_ENABLED` because
 * it is a boolean opt-in — the same spelling as `OS_TEST_MULTI_ORG_ENABLED`.
 */
export const MONGOD_TESTS_ENV = 'OS_TEST_MONGODB_MEMORY_SERVER_ENABLED';

/**
 * How long to wait for the binary fetch + first launch before giving up, on the
 * opt-in path.
 *
 * Generous against a slow-but-working download (a healthy one takes seconds;
 * this allows two orders of magnitude more) and still far inside the CI stall
 * guard's 10-minute silence budget, so a hung fetch is reported by THIS module —
 * naming the cause — rather than by a guard that can only say the job stopped
 * producing output.
 */
const ACQUIRE_TIMEOUT_MS = 120_000;

/**
 * Is the caller asking for the binary-dependent suites?
 *
 * Read per call rather than captured at module load so the gate is testable, and
 * so a value that is set-but-not-`1` can be reported instead of read as "off".
 */
export function mongodTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[MONGOD_TESTS_ENV] === '1';
}

/**
 * Print a notice so that it survives a GREEN run.
 *
 * Not `console.warn`, and this is measured rather than assumed: on vitest 4.1.10
 * with this package's config, the DEFAULT reporter prints nothing that
 * `console.warn` / `console.log` emits from a file whose tests passed or skipped
 * — only `--reporter=verbose` renders those, under a `stderr | <file>` header —
 * while a direct `process.stderr.write` always reaches the log, because it
 * bypasses vitest's console interception entirely. (That asymmetry is also why
 * the field logs in #5517 showed `Downloading MongoDB "8.2.6": 100%`: the library
 * writes its progress straight to stdout.)
 *
 * A skip whose reason nobody can see in a green log is the silent skip this gate
 * exists to avoid, so the notices below do not go through `console`.
 *
 * @param write - Sink seam for tests; defaults to this process's stderr.
 */
export function printMongodNotice(
    message: string,
    write: (chunk: string) => void = (chunk) => {
        process.stderr.write(chunk);
    },
): void {
    write(`${message}\n`);
}

/** The one line a gated-off suite prints. Names the issue and the switch. */
export function mongodSkipReason(suite: string, env: NodeJS.ProcessEnv = process.env): string {
    const raw = env[MONGOD_TESTS_ENV];
    const misset = raw === undefined || raw === ''
        ? ''
        : ` (${MONGOD_TESTS_ENV} is set to "${raw}", which does NOT enable it — only "1" does)`;
    return (
        `[driver-mongodb] SKIP ${suite} — needs a real mongod, and mongodb-memory-server would `
        + 'download a ~123 MB binary; retired from default test runs by #5517 (concurrent downloads '
        + `made green runs exit 1). Set ${MONGOD_TESTS_ENV}=1 to run it${misset}.`
    );
}

/**
 * Does this rejection look like the abandoned download of #5517 — the loser of a
 * concurrent-download race failing to rename a temp file the winner already
 * moved?
 *
 * Deliberately narrow: the exact `fs` error shape `MongoBinaryDownload.js:413`
 * produces (`ENOENT` + `rename` + a source path ending in the library's
 * `.downloading` suffix, built at that file's line 170). Anything else is
 * somebody's real bug and must stay loud — see
 * {@link installAbandonedDownloadGuard}, which re-raises what this does not match.
 */
export function isAbandonedDownloadRejection(reason: unknown): boolean {
    if (typeof reason !== 'object' || reason === null) return false;
    const err = reason as { code?: unknown; syscall?: unknown; path?: unknown };
    return (
        err.code === 'ENOENT'
        && err.syscall === 'rename'
        && typeof err.path === 'string'
        && err.path.endsWith('.downloading')
    );
}

/** The bits of `process` the guard needs — injectable so tests never touch the real one. */
export interface RejectionGuardHost {
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface RejectionGuardOptions {
    host?: RejectionGuardHost;
    /**
     * How a rejection the guard does NOT recognise is re-surfaced. Default:
     * re-throw on a later tick, which lands in vitest's `uncaughtException`
     * listener and fails the run.
     */
    reraise?: (reason: unknown) => void;
    /** Where the recognised-and-swallowed line goes. Default: {@link printMongodNotice}. */
    warn?: (message: string) => void;
}

let disposeGuard: (() => void) | undefined;

/**
 * Swallow the abandoned-download rejection, and ONLY that one, for the rest of
 * this worker's life. Installed by {@link createTestMongod} on the opt-in path
 * only — a default run downloads nothing, so it needs no guard, and vitest's own
 * error handling is left untouched there.
 *
 * Why a process listener is the only place this can be caught: the rejection is
 * born inside the library's unawaited `async` listener (see the module note), so
 * it never passes through the `create()` promise we hold.
 *
 * Why this must re-raise everything else: vitest's worker handler steps aside the
 * moment any other `unhandledRejection` listener exists —
 * `if (processListeners(event).length > 1) return;` in
 * `vitest/dist/chunks/init.*.js` — so a listener that only swallowed would
 * silence every OTHER unhandled rejection in the worker too, which is exactly
 * the class of hidden failure #5517 is about. Re-raising as an uncaught
 * exception keeps the run red; the label changes ("Unhandled Rejection" ->
 * "Uncaught Exception"), the verdict does not.
 *
 * Idempotent: repeat calls (one per gated suite in the worker) install one
 * listener.
 */
export function installAbandonedDownloadGuard(options: RejectionGuardOptions = {}): void {
    if (disposeGuard) return;
    const host = options.host ?? process;
    const warn = options.warn ?? ((message: string) => printMongodNotice(message));
    const reraise = options.reraise
        ?? ((reason: unknown) => {
            setTimeout(() => {
                throw reason;
            }, 0);
        });

    const listener = (reason: unknown): void => {
        if (!isAbandonedDownloadRejection(reason)) {
            reraise(reason);
            return;
        }
        warn(
            '[driver-mongodb] Ignoring the abandoned MongoDB binary download of #5517 '
            + `(${(reason as Error).message}). Another worker won the race and renamed the archive; `
            + 'the suite that lost it has already degraded to a named skip, and this rejection must '
            + 'not fail an otherwise green run.',
        );
    };

    host.on('unhandledRejection', listener);
    disposeGuard = () => host.off('unhandledRejection', listener);
}

/**
 * Remove the guard. Test-only seam: real runs keep it for the worker's lifetime,
 * because the rejection it catches can arrive long after the suite that started
 * the download has finished.
 */
export function disposeAbandonedDownloadGuard(): void {
    disposeGuard?.();
    disposeGuard = undefined;
}

/**
 * A started `MongoMemoryServer`, or `undefined` — in which case the caller must
 * skip, via `describe.skipIf(!mongod)`.
 *
 * `undefined` has two causes, and both print why:
 *   - the {@link MONGOD_TESTS_ENV} gate is closed (the default; no library
 *     import, no download, no launch); or
 *   - the caller opted in and the binary could not be obtained within
 *     {@link ACQUIRE_TIMEOUT_MS} — download blocked, download hung, or launch
 *     refused.
 *
 * @param suite - Suite name for the printed line, e.g. `'MongoDBDriver'`.
 */
export async function createTestMongod(suite: string): Promise<MongoMemoryServer | undefined> {
    if (!mongodTestsEnabled()) {
        printMongodNotice(mongodSkipReason(suite));
        return undefined;
    }

    installAbandonedDownloadGuard();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Behind the gate on purpose: this import is the first step that can lead
        // to a download, so it must not happen in a default run.
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        const started = MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => reject(new Error(
                    `timed out after ${ACQUIRE_TIMEOUT_MS / 1000}s waiting for the MongoDB binary `
                    + '(fastdl.mongodb.org unreachable or hanging, or another worker holds the '
                    + 'download — #5517)',
                )),
                ACQUIRE_TIMEOUT_MS,
            );
        });
        // Whichever settles first. On timeout the underlying `create()` promise is
        // abandoned rather than cancelled — the library exposes no cancel — but
        // `Promise.race` has already attached handlers to it, so ITS rejection is
        // handled. The rejection that is not is the library's internal one, which
        // the guard above owns.
        return await Promise.race([started, timeout]);
    } catch (err) {
        printMongodNotice(
            `[driver-mongodb] SKIP ${suite} — mongodb-memory-server could not start `
            + `(MongoDB binary unavailable / download blocked or hanging): ${(err as Error)?.message ?? String(err)}`,
        );
        return undefined;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
