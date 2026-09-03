// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14328] The array-form divergence, end to end: engine → REAL record-change
 * trigger → the loud bind-time refusal.
 *
 * #14328 replaced the engine's hand-kept trigger-kind chain with
 * `@objectstack/spec`'s `resolveFlowTriggerKind`. That resolver deliberately
 * answers NO kind for an array `triggerType` (`['record-after-create',
 * 'record-after-delete']`) — multi-event unions are unsupported (#3457), and
 * reading the shape as "asks for a record-change trigger" would have
 * `defineStack` demand a capability the flow can never use and would widen
 * `@objectstack/lint`'s auto-triggered set. The engine routes it anyway, from an
 * explicit pre-check that runs BEFORE the resolver, for one reason: so this
 * trigger can refuse it LOUDLY at bind time (#3481) rather than the flow folding
 * into "manual" and vanishing from every surface.
 *
 * "Unifying" that divergence away is the single way to get #14328 wrong, and the
 * failure would be SILENT — the flow would still never fire, it would simply stop
 * saying so. Nothing pinned the two halves together end to end: the engine-side
 * routing is pinned in `@objectstack/service-automation`
 * (`flow-trigger-kind-shared-resolver.test.ts`, `trigger-dispatch-observability.test.ts`)
 * against a recording double, and the refusal is pinned here
 * (`record-change-trigger.test.ts`) against a HAND-BUILT binding. Either can stay
 * green while the join between them rots. This file asserts the REFUSAL ITSELF,
 * on a binding the real engine produced from a registered flow.
 *
 * It lives in this package because this is the only side of the edge where both
 * halves exist: `@objectstack/service-automation` is a devDependency here, and
 * `@objectstack/trigger-record-change` is not a dependency of it (adding one
 * would invert the edge the trigger plugin was written to avoid — see
 * `plugin.ts`'s header).
 *
 * Resolution note, same as `reentrant-start-condition.test.ts`: this package's
 * tests resolve `@objectstack/service-automation` through its `exports` to
 * `dist/` (`check:test-source-alias`'s `KNOWN_UNALIASED_TEST_IMPORTS` entry for
 * this package), so this file is a verdict on the BUILT engine — which is what
 * the trigger loads in production, and CI builds the dependency closure before
 * running it. The engine-side pre-check is pinned against source separately, in
 * `service-automation`'s `flow-trigger-kind-shared-resolver.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTrigger, type RecordChangeDataEngine } from './record-change-trigger.js';

function createEngineLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} } as never;
}

/** Fake ObjectQL engine: records the hooks the trigger registers. */
function fakeDataEngine() {
    const hooks: Array<{ event: string; object?: string | string[] }> = [];
    const engine: RecordChangeDataEngine = {
        registerHook(event, _handler, options) {
            hooks.push({ event, object: options?.object });
        },
        unregisterHooksByPackage() {
            return 0;
        },
    };
    return { engine, hooks };
}

function arrayFormFlow(name: string) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: {
                    objectName: 'showcase_task',
                    triggerType: ['record-after-create', 'record-after-delete'],
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

describe('[#14328] array-form triggerType still draws the record-change trigger’s loud refusal', () => {
    /** Real engine + real trigger; the trigger's own logger is the spy. */
    function wire() {
        const warn = vi.fn();
        const { engine: dataEngine, hooks } = fakeDataEngine();
        const trigger = new RecordChangeTrigger(dataEngine, {
            info: () => {},
            warn,
            debug: () => {},
        });
        const automation = new AutomationEngine(createEngineLogger());
        automation.registerTrigger(trigger as never);
        return { automation, trigger, warn, hooks };
    }

    it('refuses the array form by name, and registers NO hook for it', () => {
        const { automation, warn, hooks } = wire();

        automation.registerFlow('array_flow', arrayFormFlow('array_flow') as never);

        // ── The refusal itself, not merely "something happened" ──────────────
        expect(warn, 'the trigger warned exactly once').toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg, 'names the offending flow').toMatch(/array_flow/);
        expect(msg, 'names the shape as an ARRAY').toMatch(/array/i);
        expect(msg, 'says the flow is NOT bound and will never fire').toMatch(
            /NOT bound|never fire/i,
        );
        expect(msg, 'steers to the supported single token').toMatch(/record-after-write/);
        expect(msg, 'cites the standing decision').toMatch(/#3457/);

        // The refusal is a refusal: nothing was armed for this flow.
        expect(hooks, 'no lifecycle hook registered for an array-form flow').toHaveLength(0);
    });

    it('gets there because the ENGINE routed it — the pre-check ahead of the shared resolver', () => {
        const { automation, warn } = wire();
        automation.registerFlow('array_flow', arrayFormFlow('array_flow') as never);

        // If the array pre-check were folded into `resolveFlowTriggerKind`'s
        // answer, the engine would resolve NO kind, hand the binding to nobody,
        // and this trigger would never be called: no warn, and the flow silently
        // reads as manual. That is the failure mode this case exists to catch —
        // the assertion below is the join, and it fails on zero calls.
        expect(warn).toHaveBeenCalled();
        expect(
            automation.getFlowRuntimeStates().find((s) => s.name === 'array_flow')?.triggerType,
            'the engine named record_change for the array form',
        ).toBe('record_change');
    });

    it('leaves a legitimate single record-* token armed, not refused', () => {
        // Anti-vacuity control: the refusal above is specific to the array shape,
        // not something this wiring emits for every record-change flow. Without
        // this, a trigger that refused EVERYTHING would pass the case above.
        const { automation, warn, hooks } = wire();
        const flow = arrayFormFlow('ok_flow');
        (flow.nodes[0].config as Record<string, unknown>).triggerType = 'record-after-update';

        automation.registerFlow('ok_flow', flow as never);

        expect(warn, 'no refusal for a supported single token').not.toHaveBeenCalled();
        expect(hooks.map((h) => h.event)).toEqual(['afterUpdate']);
    });
});
