// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31554] Read the shared cloud binding credential BEFORE the kernel boots.
 *
 * The multi-node licence gate runs before the kernel: the host evaluates its
 * config module, then decides whether this replica may join a cluster. A cold
 * cluster has no peer grant and no entitlement file anywhere, so the gate's way
 * out is a first-boot exchange with the control plane, and that exchange
 * presents the binding credential. With several replicas declared, the
 * credential lives in the shared `sys_cloud_binding_credential` row
 * (`connection-credential-ledger.ts`), which the plugin reads only at
 * `kernel:ready` — too late for the gate. This is the one read that happens
 * earlier, called from the host's config.
 *
 * What it does, and what it never does:
 *
 *   - **Only when the deployment shares the credential**: replicas declared
 *     (`declaresMultiNode`, the predicate the entitlement half reads too) AND
 *     the cluster driver is `redis` ({@link sharesCloudBindingCredential}).
 *     Anything else answers `not-shared` without calling `openDriver`: a single
 *     node, the in-process driver and any other driver open nothing.
 *   - **One connection, opened by the host, closed here**: `openDriver` returns
 *     a connected driver over the configured datasource, and its disconnect is
 *     initiated on every path: also when the open lands after the time bound,
 *     the moment it lands. When the read answers inside the bound, the call
 *     waits for the disconnect with what is left of the bound; on the timeout
 *     path the disconnect is initiated and not awaited. No pool is kept: this
 *     one connection is all the call opens.
 *   - **Read only**: no schema sync and no write. A database that has never held
 *     the row (a first boot) reads as unavailable, not as an error to raise.
 *   - **The engine's own decrypt**: a bare ObjectQL engine over that one driver,
 *     with only the credential object registered, reads the row through the
 *     same `SharedConnectionCredentialLedger.load()` the plugin uses, so the
 *     secret is dereferenced by `resolveSecretField` and nothing else.
 *   - **Bounded and soft**: open, read and close share ONE deadline, taken
 *     when the call starts ({@link PREBOOT_CREDENTIAL_TIMEOUT_MS} by default).
 *     The open and the read race it; the close gets only the budget left, and
 *     at least 50 ms (`PREBOOT_CLOSE_FLOOR_MS`) when the read answers at the very
 *     end of it. So the call returns within the bound, or within that floor
 *     after it, and never waits on a disconnect that hangs. Any failure answers
 *     `unavailable` with a reason and never throws, so the replica boots exactly
 *     as an unbound one does today.
 *
 * ⛔ The credential never appears in a reason: a reason names the store, the
 * failure and the remedy.
 */

import { ObjectQL } from '@objectstack/objectql';
import type { ICryptoProvider, IDataDriver } from '@objectstack/spec/contracts';
import type { StoredConnectionCredential } from './connection-credential-store.js';
import {
    SharedConnectionCredentialLedger,
    SharedCredentialUnavailableError,
    sharesCloudBindingCredential,
    type BindingCredentialEngine,
} from './connection-credential-ledger.js';
import { SysCloudBindingCredential } from './sys-cloud-binding-credential.object.js';

/** The default bound on the pre-boot open, read and close together. */
export const PREBOOT_CREDENTIAL_TIMEOUT_MS = 3_000;

/**
 * The least time a close is waited for when the read answered so near the
 * deadline that less than this is left: a healthy disconnect takes a few ms,
 * and this lets it finish rather than be left initiated. It is the only time
 * the call may run past `timeoutMs`.
 */
const PREBOOT_CLOSE_FLOOR_MS = 50;

export interface CloudBindingCredentialBeforeBootOptions {
    /**
     * Open ONE connected driver over the datasource the replicas share. Called
     * at most once, and only when the deployment shares the credential; the
     * reader disconnects what it returns.
     */
    openDriver: () => Promise<IDataDriver>;
    /** The crypto provider the replicas seal with (the local provider over `OS_SECRET_KEY`, or the host's KMS provider). */
    cryptoProvider: ICryptoProvider;
    /** Read for the replica declaration and `OS_CLUSTER_DRIVER`. Default `process.env`. */
    env?: Readonly<Record<string, string | undefined>>;
    /** The cluster driver id, when the host configures it somewhere other than `OS_CLUSTER_DRIVER`. */
    clusterDriver?: string;
    /**
     * The one deadline for open, read and close together, in ms from the call.
     * Default {@link PREBOOT_CREDENTIAL_TIMEOUT_MS}. A close that starts with
     * less than 50 ms left is waited for 50 ms; on the timeout path the
     * disconnect is initiated and not awaited.
     */
    timeoutMs?: number;
}

/**
 * What the pre-boot read found:
 *  - `not-shared` — the deployment keeps the credential in the local file;
 *    nothing was opened (read the file as before);
 *  - `read` — the row was read; `credential` is `null` when nothing is bound;
 *  - `unavailable` — the row could not be read in time or at all; boot as an
 *    unbound replica, and `reason` says why.
 */
export type CloudBindingCredentialBeforeBoot =
    | { status: 'not-shared' }
    | { status: 'read'; credential: StoredConnectionCredential | null }
    | { status: 'unavailable'; reason: string };

const UNAVAILABLE_PREFIX = 'The shared cloud binding credential could not be read before boot, so this replica starts unbound';

/** Read the shared binding credential once, before the kernel, within a time bound. Never throws. */
export async function readCloudBindingCredentialBeforeBoot(
    options: CloudBindingCredentialBeforeBootOptions,
): Promise<CloudBindingCredentialBeforeBoot> {
    const env = options.env ?? process.env;
    const clusterDriver = options.clusterDriver ?? env.OS_CLUSTER_DRIVER;
    if (!sharesCloudBindingCredential(env, clusterDriver)) return { status: 'not-shared' };

    const timeoutMs = options.timeoutMs ?? PREBOOT_CREDENTIAL_TIMEOUT_MS;
    // ONE deadline for open, read and close: the close below gets what is left.
    const deadline = Date.now() + timeoutMs;
    let opened: IDataDriver | undefined;
    let closing: Promise<void> | undefined;
    let abandoned = false;
    const close = (): Promise<void> => {
        if (!opened) return Promise.resolve();
        closing ??= Promise.resolve().then(() => opened!.disconnect()).catch(() => { /* already gone */ });
        return closing;
    };

    const attempt = (async (): Promise<StoredConnectionCredential | null> => {
        opened = await options.openDriver();
        // The bound passed while the connection was opening: close it, read nothing.
        if (abandoned) {
            await close();
            throw new SharedCredentialUnavailableError('the connection opened after the time bound');
        }
        const engine = new ObjectQL();
        engine.registerDriver(opened, true);
        // The namespace the plugin's manifest registers it under, so the name
        // (and the table it maps to) is the one every replica writes.
        engine.registerObject(SysCloudBindingCredential as never, 'com.objectstack.cloud.connection.credential', 'sys');
        engine.setCryptoProvider(options.cryptoProvider);
        return new SharedConnectionCredentialLedger(() => engine as unknown as BindingCredentialEngine).load();
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.max(deadline - Date.now(), 0));
    });
    try {
        const outcome = await Promise.race([
            attempt.then((credential) => ({ credential }), (error: unknown) => ({ error })),
            timedOut,
        ]);
        if (outcome === 'timeout') {
            abandoned = true;
            // Closing the connection is what ends a read still in flight; an
            // open still pending closes itself when it lands (above). The
            // disconnect is initiated, not awaited: the bound is spent.
            attempt.catch(() => { /* reported below as the timeout */ });
            void close();
            return {
                status: 'unavailable',
                reason: `${UNAVAILABLE_PREFIX}: the database did not answer within ${timeoutMs} ms.`,
            };
        }
        if ('error' in outcome) return { status: 'unavailable', reason: `${UNAVAILABLE_PREFIX}: ${describe(outcome.error)}` };
        return { status: 'read', credential: outcome.credential };
    } finally {
        if (timer) clearTimeout(timer);
        if (!abandoned) await boundedClose(close(), Math.max(deadline - Date.now(), PREBOOT_CLOSE_FLOOR_MS));
    }
}

/**
 * Wait for the close, but only for `budgetMs`, what is left of the call's one
 * deadline: a hung disconnect must not hold the boot. Past the budget the
 * disconnect stays initiated and is not awaited.
 */
async function boundedClose(closing: Promise<void>, budgetMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closing, new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); })]);
    if (timer) clearTimeout(timer);
}

/**
 * A failure as a reason. The ledger's own refusals already name the remedy; a
 * driver's message is a read's (`no such table`, a refused connection), and a
 * read carries no credential, so it is passed through as the cause.
 */
function describe(error: unknown): string {
    if (error instanceof SharedCredentialUnavailableError) return error.message;
    const message = error instanceof Error ? error.message : String(error);
    return `the read failed (${message}). A first boot, before any replica has created the shared row, reads this way too.`;
}
