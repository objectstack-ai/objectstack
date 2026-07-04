// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    IClusterService,
    IPubSub,
    ILock,
    IKV,
    ICounter,
} from '@objectstack/spec/contracts';
import type { ClusterCapabilityConfigInput } from '@objectstack/spec/kernel';
import { ClusterCapabilityConfigSchema } from '@objectstack/spec/kernel';

import { MemoryPubSub } from './memory/pubsub.js';
import { MemoryLock } from './memory/lock.js';
import { MemoryKV } from './memory/kv.js';
import { MemoryCounter } from './memory/counter.js';

/**
 * Compose four cluster primitives into a single `IClusterService` facade.
 * Useful for custom driver authors who want to mix and match.
 */
export class ComposedClusterService implements IClusterService {
    constructor(
        public readonly nodeId: string,
        public readonly driver: string,
        public readonly pubsub: IPubSub,
        public readonly lock: ILock,
        public readonly kv: IKV,
        public readonly counter: ICounter,
    ) { }

    async close(): Promise<void> {
        // Reverse order, swallow errors so a slow close doesn't block siblings.
        const closers = [this.counter, this.kv, this.lock, this.pubsub];
        for (const c of closers) {
            try {
                await c.close();
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[ClusterService] close error:', err);
            }
        }
    }
}

/**
 * Build an `IClusterService` from a `ClusterCapabilityConfig`. The only
 * driver shipped from this package is `memory`; other drivers (postgres,
 * redis, nats) live in dedicated packages and register themselves via
 * `registerClusterDriver()`.
 *
 * @example
 *   const cluster = defineCluster({ driver: 'memory' });
 *   await cluster.pubsub.publish('metadata.changed', { id: 'x' });
 */
export function defineCluster(
    config: ClusterCapabilityConfigInput = {},
): IClusterService {
    const parsed = ClusterCapabilityConfigSchema.parse(config);
    const nodeId = parsed.nodeId ?? generateNodeId();

    if (parsed.driver === 'memory') {
        return new ComposedClusterService(
            nodeId,
            'memory',
            new MemoryPubSub({ nodeId }),
            new MemoryLock({ defaultTtlMs: parsed.lockTtlMs }),
            new MemoryKV(),
            new MemoryCounter(),
        );
    }

    const factory = driverRegistry.get(parsed.driver);
    if (!factory) {
        throw new Error(
            `Cluster driver "${parsed.driver}" is not registered. ` +
                `Did you forget to import @objectstack/service-cluster-${parsed.driver} ` +
                `or call registerClusterDriver()? ` +
                `See content/docs/kernel/cluster.mdx §6.`,
        );
    }
    return factory({ ...parsed, nodeId });
}

// ---------------------------------------------------------------------------
// Driver registry (for postgres/redis/nats/custom drivers)
// ---------------------------------------------------------------------------

export interface DriverFactoryConfig {
    driver: string;
    nodeId: string;
    url?: string;
    useExistingPool?: boolean;
    heartbeatMs?: number;
    lockTtlMs?: number;
    tenantIsolation?: string;
    driverOptions?: Record<string, unknown>;
}

export type ClusterDriverFactory = (config: DriverFactoryConfig) => IClusterService;

const driverRegistry = new Map<string, ClusterDriverFactory>();

/**
 * Register a custom cluster driver. Driver packages (e.g.
 * `@objectstack/service-cluster-postgres`) should call this at module
 * load time so `defineCluster({ driver: 'postgres' })` resolves them.
 */
export function registerClusterDriver(
    name: string,
    factory: ClusterDriverFactory,
): void {
    if (name === 'memory') {
        throw new Error('The "memory" driver is reserved.');
    }
    driverRegistry.set(name, factory);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateNodeId(): string {
    // Avoid the `crypto` import dance for a single use; this is dev-only
    // randomness and the driver upgrades replace it.
    const rand = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36);
    return `node-${ts}-${rand}`;
}
