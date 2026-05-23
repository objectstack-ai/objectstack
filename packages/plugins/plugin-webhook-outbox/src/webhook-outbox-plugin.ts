// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IClusterService } from '@objectstack/spec/contracts';
import { WebhookDispatcher, type DispatcherOptions } from './dispatcher.js';
import { MemoryWebhookOutbox } from './memory-outbox.js';
import type { IWebhookOutbox } from './outbox.js';

export interface WebhookOutboxPluginOptions
    extends Partial<Omit<DispatcherOptions, 'cluster' | 'outbox' | 'nodeId'>> {
    /**
     * Override the outbox backend. If omitted a fresh `MemoryWebhookOutbox`
     * is used — fine for local development, **not for production**: each
     * node will see only its own rows.
     */
    outbox?: IWebhookOutbox;
    /**
     * Stable node id. If omitted, uses `process.env.OBJECTSTACK_NODE_ID`
     * or a random UUID generated at plugin init.
     */
    nodeId?: string;
    /**
     * If `false`, the plugin registers the outbox/dispatcher services but
     * does NOT auto-start the loop — useful for tests that want to step
     * the dispatcher manually via `dispatcher.tick()`.
     *
     * Default: true.
     */
    autoStart?: boolean;
}

/**
 * Wires a persistent, cluster-aware webhook outbox into the kernel.
 *
 * Registered services:
 *   - `webhook.outbox`     → `IWebhookOutbox` (enqueue / claim / ack / list)
 *   - `webhook.dispatcher` → `WebhookDispatcher` (manual `tick()` if needed)
 *
 * Producer code should call `ctx.getService('webhook.outbox').enqueue(...)`
 * after persisting business state — the dispatcher takes care of the rest.
 *
 * **Cluster requirement** — this plugin depends on the cluster service
 * (`ClusterServicePlugin`). With the default `memory` driver the
 * dispatcher works correctly inside a single process; with a real driver
 * (`@objectstack/service-cluster-redis`) it correctly coordinates work
 * across nodes.
 */
export class WebhookOutboxPlugin implements Plugin {
    name = 'com.objectstack.plugin-webhook-outbox';
    version = '1.0.0';
    type = 'standard' as const;
    dependencies = ['com.objectstack.service-cluster'];

    private dispatcher: WebhookDispatcher | undefined;

    constructor(private readonly options: WebhookOutboxPluginOptions = {}) {}

    async init(ctx: PluginContext): Promise<void> {
        const cluster = ctx.getService<IClusterService>('cluster');
        if (!cluster) {
            throw new Error(
                'WebhookOutboxPlugin: required service "cluster" not found — register ClusterServicePlugin first',
            );
        }
        const outbox = this.options.outbox ?? new MemoryWebhookOutbox();
        const nodeId =
            this.options.nodeId ??
            process.env.OBJECTSTACK_NODE_ID ??
            `node-${Math.random().toString(36).slice(2, 10)}`;

        const dispatcher = new WebhookDispatcher({
            nodeId,
            cluster,
            outbox,
            partitionCount: this.options.partitionCount,
            batchSize: this.options.batchSize,
            intervalMs: this.options.intervalMs,
            lockTtlMs: this.options.lockTtlMs,
            claimTtlMs: this.options.claimTtlMs,
            fetchImpl: this.options.fetchImpl,
            onAttempt: this.options.onAttempt,
            rng: this.options.rng,
            logger: ctx.logger,
        });
        this.dispatcher = dispatcher;

        ctx.registerService('webhook.outbox', outbox);
        ctx.registerService('webhook.dispatcher', dispatcher);

        if (this.options.autoStart !== false) {
            dispatcher.start();
        }

        ctx.logger.info?.('[webhook-outbox] initialised', {
            nodeId,
            partitions: this.options.partitionCount ?? 8,
            interval: this.options.intervalMs ?? 250,
        });
    }

    async dispose(): Promise<void> {
        await this.dispatcher?.stop();
    }
}
