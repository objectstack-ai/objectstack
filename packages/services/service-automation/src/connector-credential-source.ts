// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The connector credential source — lending an instance's credential (ADR-0015 D7)
 *
 * An API-backed datasource names a declared connector instance in
 * `external.connector` and borrows that instance's credential (ADR-0015
 * amendment D7). This is the lending half: the
 * {@link IConnectorCredentialSource} the plugin registers under
 * `CONNECTOR_CREDENTIAL_SOURCE_SERVICE` (the contract and the call rule a
 * driver presents through live in `@objectstack/types`).
 *
 * A borrow judges the DECLARATION — the same declared items the reconcile
 * materializes from — and resolves no value. A handle resolves the
 * instance's `auth.credentialRef` through the same chain the connector itself
 * resolves it through (`./connector-credentials.ts`: env → the
 * `sys_connector_credential` row → the host's resolver; no stored arm under a
 * walled tenancy posture), so one credential set under Setup → Connector
 * credentials serves the connector's actions and the datasource's records.
 *
 * Today's instances carry the static kinds (bearer, API key, basic), which
 * ADR-0143 D4 leaves resolved once rather than per dispatch. A handle keeps
 * the value it resolved until one of two things: a `refresh()` (the
 * driver's `401` path, so a rotated credential is picked up by the first
 * request it refuses), or a credential write or reconcile in this plugin (the
 * {@link ConnectorCredentialSourceDeps.generation} moves). The handle does not
 * watch the declaration itself: a change to the instance (disabled, its
 * `auth` rewritten) is seen after the next reconcile, which every declaration
 * path runs, or on a `refresh()`. The grant-bearing kinds ADR-0143 adds answer
 * through the same handle, per dispatch, when they land.
 *
 * Each granted borrow is announced to the source's `onLent` subscribers by
 * the instance's name alone, so a datasource the boot recorded as unable to
 * borrow is re-judged the moment its instance lends again (the datasource
 * connection service subscribes).
 *
 * ⛔ A value leaves this module only as the return of a handle's `get` /
 * `refresh`. Every refusal names the instance and the reference, never a
 * value, and a host resolver's own message is not interpolated.
 */

import {
    connectorCredentialRefusal,
    type BorrowedConnectorAuth,
    type BorrowedConnectorCredential,
    type ConnectorCredentialHandle,
    type IConnectorCredentialSource,
} from '@objectstack/types';
import type { ConnectorInstanceAuth } from '@objectstack/spec/integration';
import {
    missingCredentialReason,
    resolveConnectorCredential,
    type ConnectorCredentialChain,
    type ConnectorCredentialRecord,
} from './connector-credentials.js';

/** The slice of a declared `connectors:` entry a borrow reads — raw as authored. */
export interface LendableConnectorItem {
    name?: string;
    enabled?: boolean;
    provider?: string;
    auth?: ConnectorInstanceAuth;
}

/** What the source reads through — the plugin's own readers, injected so the source holds no plugin state. */
export interface ConnectorCredentialSourceDeps {
    /**
     * The declared `connectors:` items, as the reconcile reads them.
     * `undefined` when nothing is declared at all (no registry). Throws when
     * the declaration cannot be read now.
     */
    readDeclared(): Promise<readonly unknown[] | undefined>;
    /** The resolver chain for this deployment's tenancy posture. Throws when the posture cannot be read. */
    chain(): Promise<ConnectorCredentialChain>;
    /** Whether the host injected a resolver — named in a missing credential's remedy. */
    vaultWired(): boolean;
    /** A counter the plugin moves on every credential write and reconcile; a handle re-resolves when it moved. */
    generation(): number;
}

type Lendable = LendableConnectorItem & { name: string; provider: string; auth: Exclude<ConnectorInstanceAuth, { type: 'none' }> };

function findDeclared(items: readonly unknown[] | undefined, name: string): LendableConnectorItem | undefined {
    for (const raw of items ?? []) {
        const item = raw as LendableConnectorItem | null;
        if (item && typeof item === 'object' && item.name === name) return item;
    }
    return undefined;
}

/**
 * Why `item` cannot lend a credential, or `undefined` when it can. The three
 * authoring findings `collectDatasourceConnectorErrors` (`@objectstack/spec`,
 * `stack.zod.ts`) refuses at build, judged again here because a
 * runtime-created datasource never passes through `defineStack`, and a
 * declaration can change after a build. Plus the one the build accepts: a
 * disabled instance turns the vendor off for its records as for its actions.
 */
function lendRefusal(connector: string, item: LendableConnectorItem | undefined): string | undefined {
    const subject = `connector instance '${connector}' (named by this datasource's external.connector)`;
    if (item === undefined) {
        return `${subject} is not declared in this stack's connectors. Declare it — a connectors entry named '${connector}' `
            + 'with a provider and an auth credential — or correct the name.';
    }
    if (typeof item.provider !== 'string' || item.provider.length === 0) {
        return `${subject} declares no provider: a connector entry with no provider is a catalog descriptor and holds no `
            + 'credential to lend. Give it the provider that serves this vendor and an auth credential.';
    }
    const auth = item.auth;
    if (!auth || typeof auth !== 'object' || auth.type === 'none') {
        return `${subject} declares no auth credential, so there is nothing to borrow. Declare its auth, or remove `
            + 'external.connector from the datasource if the upstream needs no credential.';
    }
    if (item.enabled === false) {
        return `${subject} is disabled (enabled: false), which turns the vendor off for this datasource's records as for `
            + "the connector's actions. Enable the instance to read through it.";
    }
    return undefined;
}

function borrowedAuthOf(auth: Lendable['auth'], value: string): BorrowedConnectorAuth {
    switch (auth.type) {
        case 'bearer':
            return { type: 'bearer', token: value };
        case 'api-key':
            return {
                type: 'api-key',
                key: value,
                headerName: auth.headerName ?? 'X-API-Key',
                ...(auth.paramName !== undefined ? { paramName: auth.paramName } : {}),
            };
        case 'basic':
            return { type: 'basic', username: auth.username, password: value };
    }
}

const unavailable = (message: string): Error => connectorCredentialRefusal(message, 'SERVICE_UNAVAILABLE', 503);

/**
 * The source. One per automation plugin; it holds nothing but the handles'
 * caches, and each handle holds only its own instance's last value.
 */
export function createConnectorCredentialSource(deps: ConnectorCredentialSourceDeps): IConnectorCredentialSource {
    const readDeclared = async (connector: string): Promise<readonly unknown[] | undefined> => {
        try {
            return await deps.readDeclared();
        } catch {
            throw unavailable(
                `the connector declarations could not be read, so connector instance '${connector}' cannot be lent to a `
                    + 'datasource now; it is retried on the next connect.',
            );
        }
    };

    /** The value `entry`'s reference resolves to now, through the chain. */
    const resolve = async (connector: string, entry: Lendable): Promise<BorrowedConnectorCredential> => {
        const ref = entry.auth.credentialRef;
        let chain: ConnectorCredentialChain;
        try {
            chain = await deps.chain();
        } catch {
            throw unavailable(
                `the tenancy posture could not be read, so where credential '${ref}' of connector instance '${connector}' `
                    + 'is kept cannot be told now; the next request retries.',
            );
        }
        // One row read for this reference, never the store's listing: `resolve`
        // reads the row's value only when it is the one that answers.
        let rows: Map<string, ConnectorCredentialRecord> | undefined = new Map();
        if (chain.store) {
            try {
                const row = await chain.store.read(ref);
                if (row) rows.set(ref, row);
            } catch {
                rows = undefined;
            }
        }
        let resolution: Awaited<ReturnType<typeof resolveConnectorCredential>>;
        try {
            resolution = await resolveConnectorCredential(chain, ref, rows);
        } catch {
            // The host's resolver threw. Its message is not ours to vouch for.
            throw unavailable(
                `the host's credential resolver failed on credential '${ref}' of connector instance '${connector}'; `
                    + 'the next request retries.',
            );
        }
        if (resolution.kind === 'resolved') return { auth: borrowedAuthOf(entry.auth, resolution.value) };
        if (resolution.kind === 'missing') {
            throw unavailable(`connector instance '${connector}': ${missingCredentialReason(ref, deps.vaultWired())}.`);
        }
        throw unavailable(`connector instance '${connector}': ${resolution.reason}`);
    };

    /** The instance's current declaration, judged; a refusal here is a condition the request cannot change, so `503`. */
    const currentEntry = async (connector: string): Promise<Lendable> => {
        const item = findDeclared(await readDeclared(connector), connector);
        const refusal = lendRefusal(connector, item);
        if (refusal) throw unavailable(refusal);
        return item as Lendable;
    };

    const lentListeners = new Set<(connector: string) => void>();
    /** Tell every `onLent` subscriber; a listener's throw stays its own. */
    const announceLent = (connector: string): void => {
        for (const listener of [...lentListeners]) {
            try {
                listener(connector);
            } catch {
                /* the borrow was granted either way */
            }
        }
    };

    return {
        onLent(listener: (connector: string) => void): () => void {
            lentListeners.add(listener);
            return () => void lentListeners.delete(listener);
        },
        async borrow(connector: string): Promise<ConnectorCredentialHandle> {
            const refusal = lendRefusal(connector, findDeclared(await readDeclared(connector), connector));
            if (refusal) throw connectorCredentialRefusal(refusal, 'VALIDATION_ERROR', 422);
            announceLent(connector);

            let held: { generation: number; credential: BorrowedConnectorCredential } | undefined;
            let inflight: Promise<BorrowedConnectorCredential> | undefined;
            // Single flight: concurrent requests that find no held value, or
            // that all saw a `401`, share one resolution.
            const fill = (): Promise<BorrowedConnectorCredential> => {
                inflight ??= (async () => {
                    const generation = deps.generation();
                    const credential = await resolve(connector, await currentEntry(connector));
                    held = { generation, credential };
                    return credential;
                })().finally(() => { inflight = undefined; });
                return inflight;
            };
            return {
                connector,
                async get() {
                    if (held && held.generation === deps.generation()) return held.credential;
                    return fill();
                },
                async refresh() {
                    held = undefined;
                    return fill();
                },
            };
        },
    };
}
