// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
    readAuthzGrantsCacheTtlMs,
    reportAuthzCachePosture,
    AUTHZ_GRANTS_CACHE_TTL_ENV,
    type AuthzInvalidationBusState,
} from '@objectstack/core';
import type { IClusterService } from '@objectstack/spec/contracts';
import { isInProcessClusterDriver } from './split-brain-guard.js';

/**
 * ── `authz.invalidated` bridge + the boot-time posture statement (#11968) ────
 *
 * Two jobs, and the second is the reason this plugin belongs in the DEFAULT
 * composition rather than being something an app remembers to add:
 *
 *  1. **Bridge** the engine's write epoch onto the `authz.invalidated` cluster
 *     channel, so a grant change on one replica reaches its peers in one
 *     network hop instead of one TTL. Shaped after
 *     {@link ../metadata-cluster-bridge-plugin.js MetadataClusterBridgePlugin}:
 *     late-binds at `kernel:ready`, duck-types the engine service, and does
 *     nothing when what it needs is absent.
 *
 *  2. ⭐ **State the posture out loud** when a grants cache is enabled and
 *     there is no such bridge. Non-optional by the 2026-08-25 ruling on #11633
 *     (Fork 2 → B). A silently-absent invalidation bridge is #4785's failure
 *     shape — a security control disabled by configuration with nothing said —
 *     and job 2 exists so that cannot recur here.
 *
 * ## Why it registers even when there is no cluster service
 *
 * The metadata bridge may return at `debug` when no `cluster` service exists,
 * because a missed `metadata.changed` costs a stale schema and loses no data.
 * The equivalent silence here would cost a permission honoured past its
 * revocation. So this plugin runs its posture check FIRST and unconditionally:
 * "no cluster service at all" is not a reason to say nothing, it is the loudest
 * case there is.
 *
 * ## Why it is inert until a cache is enabled
 *
 * With {@link AUTHZ_GRANTS_CACHE_TTL_ENV} at its default `0` — the shipped
 * default, ruled at Fork 4 — nothing caches authorization answers, so there is
 * nothing to invalidate and nothing to state. The plugin attaches no bridge,
 * publishes no message and logs no posture line. That is the substrate's
 * acceptance criterion: with no cache consumers, runtime behaviour is
 * unchanged.
 */
export class AuthzClusterBridgePlugin implements Plugin {
    name = 'com.objectstack.service.authz-cluster-bridge';
    version = '1.0.0';
    type = 'standard';

    private detach?: () => void;

    async init(ctx: PluginContext): Promise<void> {
        ctx.hook('kernel:ready', async () => {
            const ttl = readAuthzGrantsCacheTtlMs();

            // ── The silent arm ──────────────────────────────────────────────
            // No cache enabled ⇒ no staleness window exists ⇒ nothing to bridge
            // and nothing to state. A courtesy line on every default boot would
            // train operators to skim past the one that matters.
            if (ttl.ttlMs <= 0 && !ttl.malformed) {
                ctx.logger.debug(
                    'AuthzClusterBridgePlugin: grants cache disabled ' +
                        `(${AUTHZ_GRANTS_CACHE_TTL_ENV}=0); no bridge, no posture line`,
                );
                return;
            }

            const cluster = this.resolveCluster(ctx);
            const engine = this.resolveEngine(ctx);

            let bus: AuthzInvalidationBusState = 'absent';
            if (cluster && engine) {
                if (isInProcessClusterDriver(cluster.driver)) {
                    // A cluster service IS registered — `Runtime` registers the
                    // memory driver by default — but it fans out to nobody.
                    // Reporting this as "bridged" is the exact misreading the
                    // posture statement exists to prevent.
                    bus = 'in-process';
                } else {
                    try {
                        this.detach = engine.attachAuthzInvalidationPubSub(
                            cluster.pubsub,
                            cluster.nodeId,
                        );
                        bus = 'bridged';
                    } catch (err) {
                        ctx.logger.error(
                            'AuthzClusterBridgePlugin: attach failed',
                            err as Error,
                        );
                        bus = 'absent';
                    }
                }
            }

            // ── The loud arm ────────────────────────────────────────────────
            reportAuthzCachePosture(
                {
                    ttlMs: ttl.ttlMs,
                    bus,
                    ...(cluster ? { driver: cluster.driver } : {}),
                    ...(ttl.malformed ? { malformedTtl: { raw: ttl.raw } } : {}),
                },
                ctx.logger,
            );
        });

        ctx.hook('kernel:shutdown', async () => {
            try {
                this.detach?.();
            } catch (err) {
                ctx.logger.error(
                    'AuthzClusterBridgePlugin: detach error',
                    err as Error,
                );
            }
            this.detach = undefined;
        });
    }

    /** The `cluster` service, or undefined when none is registered. */
    private resolveCluster(ctx: PluginContext): IClusterService | undefined {
        try {
            return ctx.getService<IClusterService>('cluster');
        } catch {
            return undefined;
        }
    }

    /**
     * The engine, if it exposes the substrate seam. Duck-typed exactly like
     * `MetadataClusterBridgePlugin` feature-detects `attachClusterPubSub()`:
     * this package must not depend on `@objectstack/objectql`.
     */
    private resolveEngine(
        ctx: PluginContext,
    ):
        | {
              attachAuthzInvalidationPubSub: (
                  pubsub: IClusterService['pubsub'],
                  nodeId: string,
              ) => () => void;
          }
        | undefined {
        let svc: unknown;
        try {
            svc = ctx.getService<unknown>('objectql');
        } catch {
            return undefined;
        }
        const attach = (svc as { attachAuthzInvalidationPubSub?: unknown })
            ?.attachAuthzInvalidationPubSub;
        if (typeof attach !== 'function') return undefined;
        return {
            attachAuthzInvalidationPubSub: (pubsub, nodeId) =>
                (attach as (p: unknown, n: string) => () => void).call(
                    svc,
                    pubsub,
                    nodeId,
                ),
        };
    }
}
