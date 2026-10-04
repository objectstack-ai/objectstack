// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21725 — the metadata-mutation sync arms what the boot arms, and no more.
 *
 * The boot binds flows from the protocol's execution view read with no
 * organization: the env-wide set. A mutation event carries the written row's
 * organization, and the real door refuses an org-scoped flow write
 * (`flow-metadata-save-arming.integration.test.ts` measures that), but a
 * signal can still name one — a delete of a pre-#6190 phantom row, or a peer
 * replica's replay. Handing that organization to the read would arm a row the
 * boot never arms. So the sync reads exactly what the boot reads, whatever the
 * event names.
 *
 * Harness: the automation plugin over a protocol stand-in that records every
 * read and lets the test raise the mutation signal, the shape
 * `flow-publish-rebind.test.ts` uses for `metadata:reloaded`.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

type MutationListener = (evt: { type: string; name: string; state: string; organizationId?: string | null }) => void;

const flow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A protocol whose env-wide view and org view differ, recording each read's request. */
function protocolStandIn() {
    const listeners: MutationListener[] = [];
    const reads: Array<Record<string, unknown>> = [];
    const envWide: unknown[] = [];
    const orgScoped: unknown[] = [flow('org_only')];
    return {
        service: {
            async getMetaItemsForExecution(request: { type: string; organizationId?: string }) {
                reads.push({ ...request });
                if (request.type !== 'flow') return { items: [] };
                return { items: request.organizationId ? [...envWide, ...orgScoped] : envWide };
            },
            onMetadataMutation(listener: MutationListener) {
                listeners.push(listener);
                return () => listeners.splice(listeners.indexOf(listener), 1);
            },
        },
        envWide,
        reads,
        emit: (evt: Parameters<MutationListener>[0]) => listeners.forEach((l) => l(evt)),
    };
}

async function boot(proto: ReturnType<typeof protocolStandIn>) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    kernel.use({
        name: 'test.harness',
        type: 'standard',
        version: '1.0.0',
        dependencies: [],
        async init(ctx: { registerService(name: string, svc: unknown): void }) {
            ctx.registerService('protocol', proto.service);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return { kernel, engine: kernel.getService<AutomationEngine>('automation') };
}

describe('the metadata-mutation sync reads what the boot reads (#21725)', () => {
    it("never hands the event's organization to the read, so an org-only row is not armed", async () => {
        const proto = protocolStandIn();
        const { kernel, engine } = await boot(proto);
        proto.reads.length = 0;

        proto.emit({ type: 'flow', name: 'org_only', state: 'active', organizationId: 'org_a' });
        // `destroy()` waits for every queued flow sync.
        await kernel.shutdown();

        expect(proto.reads, 'one read, of the env-wide view').toEqual([{ type: 'flow' }]);
        expect(await engine.getFlow('org_only')).toBeNull();
    });

    it('arms an env-wide flow the same signal names — the control for the row above', async () => {
        const proto = protocolStandIn();
        const { kernel, engine } = await boot(proto);
        proto.envWide.push(flow('env_flow'));

        proto.emit({ type: 'flow', name: 'env_flow', state: 'active', organizationId: null });
        await kernel.shutdown();

        expect(await engine.getFlow('env_flow')).not.toBeNull();
    });
});
