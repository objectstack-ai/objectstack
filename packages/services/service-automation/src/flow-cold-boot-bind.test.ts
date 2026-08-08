// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: a record-triggered flow must bind on a COLD boot.
//
// Flows defined inline in an app manifest are never promoted to standalone
// registry 'flow' items (registerApp stores the app under type 'app'), so the
// automation boot pull (`ql.registry.listItems('flow')`) sees ZERO of them.
// The canonical flattened flow view — `protocol.getMetaItems({ type: 'flow' })`,
// what `GET /meta/flow` serves — does surface them, but nothing bound from it
// on a cold boot: the pre-fix re-sync used `metadata.list('flow')` and only ran
// on 'metadata:reloaded', which never fires on a fresh boot (or in production).
// The bug: record-triggered automations silently never bound on a cold start,
// so they never fired.
//
// The fix binds flows from `protocol.getMetaItems({ type: 'flow' })` at
// 'kernel:ready'. This proves the flow is bound after bootstrap() alone — with
// NO 'metadata:reloaded' ever fired, from the protocol service alone.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A record-after-update triggered flow, the shape the metadata service serves. */
function recordTriggeredFlow(name: string, object: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: { objectName: object, triggerType: 'record-after-update', condition: 'status == "done"' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

/** A recording FlowTrigger of type 'record_change' (stands in for the real one). */
function recordingRecordChangeTrigger() {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return {
        trigger,
        has: (n: string) => bound.has(n),
        fire: async (n: string) => {
            await bound.get(n)?.({ event: 'record_change', params: { flowName: n } } as AutomationContext);
        },
    };
}

/**
 * The protocol's flattened flow view — `getMetaItems({ type: 'flow' })` — served
 * as the `{ items: [...] }` envelope the real protocol returns, so the fix's
 * unwrap path is exercised. No objectql registry, mirroring the empty boot pull.
 */
function fakeProtocolService(flows: unknown[]) {
    return {
        async getMetaItems(q: { type: string }) {
            return { items: q.type === 'flow' ? flows : [] };
        },
    };
}

/**
 * Decorate a flow the way the REAL read path does: `decorateMetadataItem`
 * spreads `_diagnostics` onto every served item, a preview read badges `_draft`,
 * and an overlay row carries its `_packageId`. cloud#971 — the first two are
 * read-time annotations the closed `FlowSchema` (#4001) rejects; the third is
 * ADR-0010 envelope state `FlowSchema` DECLARES (via `MetadataProtectionFields`)
 * and the bind must PRESERVE.
 */
function asServedByProtocol<T extends object>(flow: T) {
    return {
        ...flow,
        _packageId: 'app.pm7k',
        _diagnostics: { valid: true, warnings: [] },
        _draft: true,
    };
}

/**
 * Boot with a protocol service that HAS the flow but NO objectql registry, so
 * the boot pull is empty — exactly the inline-app-flow cold-boot scenario. The
 * recording record-change trigger is registered during init (before
 * kernel:ready), the way the real RecordChangeTriggerPlugin registers its
 * trigger, so the kernel:ready bind can find it.
 */
async function bootKernel(flows: unknown[], rec: ReturnType<typeof recordingRecordChangeTrigger>) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            ctx.registerService('protocol', fakeProtocolService(flows));
            // AutomationServicePlugin.init() ran first (registered above), so the
            // engine service exists; register the trigger before kernel:ready.
            ctx.getService('automation').registerTrigger(rec.trigger);
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    return kernel;
}

describe('record-triggered flow binds on cold boot (kernel:ready sync)', () => {
    it('binds an inline-app record flow after bootstrap() with no metadata:reloaded', async () => {
        const rec = recordingRecordChangeTrigger();
        const kernel = await bootKernel([recordTriggeredFlow('notify_on_done', 'task')], rec);
        await flush();

        // The core fix: the flow is bound to its record-change trigger after a
        // plain cold boot — no 'metadata:reloaded' was ever fired.
        expect(rec.has('notify_on_done'), 'record-triggered flow bound at kernel:ready').toBe(true);

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).toContain('notify_on_done');

        await kernel.shutdown();
    });

    it('does not bind when the metadata service serves no flows', async () => {
        const rec = recordingRecordChangeTrigger();
        const kernel = await bootKernel([], rec);
        await flush();
        expect(rec.has('notify_on_done')).toBe(false);
        await kernel.shutdown();
    });
});

/**
 * cloud#971 — the bind must survive the read path's OWN annotations.
 *
 * The fake above served naked flow bodies; the real `getMetaItems` decorates
 * every item (`_diagnostics`, plus `_draft` on a preview read). Once #4001
 * closed `FlowSchema` — unrecognized keys throw instead of being dropped —
 * `registerFlow` rejected EVERY flow on EVERY cold boot with
 * `unrecognized_keys: ["_diagnostics"]`. Nothing looked broken because the
 * record-change plugin binds record flows by a second path; a flow whose only
 * binding path is this one would simply have stopped firing, silently.
 *
 * So the naked-payload tests above could not have caught it. These serve what
 * the protocol actually serves.
 */
describe('cold-boot bind survives the read path annotations (cloud#971)', () => {
    it('binds a flow served WITH _diagnostics/_draft decorations', async () => {
        const rec = recordingRecordChangeTrigger();
        const kernel = await bootKernel(
            [asServedByProtocol(recordTriggeredFlow('task_hours_pause_project', 'task'))],
            rec,
        );
        await flush();

        expect(
            rec.has('task_hours_pause_project'),
            'a decorated flow must still bind — pre-fix this threw unrecognized_keys and only WARNed',
        ).toBe(true);

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(await engine.getFlow('task_hours_pause_project')).not.toBeNull();

        await kernel.shutdown();
    });

    it('keeps the ADR-0010 protection envelope — the strip is not a blanket "_" purge', async () => {
        // `_packageId` shares the underscore spelling but is envelope state
        // `FlowSchema` declares. Dropping it would erase a packaged flow's
        // provenance on every rebind, so the strip must be exactly the read
        // decorations and nothing more.
        const rec = recordingRecordChangeTrigger();
        const kernel = await bootKernel(
            [asServedByProtocol(recordTriggeredFlow('task_hours_pause_project', 'task'))],
            rec,
        );
        await flush();

        const engine = kernel.getService<AutomationEngine>('automation');
        const parsed = await engine.getFlow('task_hours_pause_project');
        expect((parsed as unknown as { _packageId?: string })?._packageId).toBe('app.pm7k');
        expect(parsed).not.toHaveProperty('_diagnostics');
        expect(parsed).not.toHaveProperty('_draft');

        await kernel.shutdown();
    });

    it('binds a decorated flow served in the `{ item: … }` wrapper shape', async () => {
        // The other envelope `getMetaItems` can hand back — the strip has to
        // happen AFTER the unwrap, not before it.
        const rec = recordingRecordChangeTrigger();
        const kernel = await bootKernel(
            [{ item: asServedByProtocol(recordTriggeredFlow('task_hours_pause_project', 'task')) }],
            rec,
        );
        await flush();
        expect(rec.has('task_hours_pause_project')).toBe(true);
        await kernel.shutdown();
    });
});
