// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0041 — `trigger-api`'s acceptance criteria name "a per-flow secret; HMAC
 * signature verification". A flow whose binding resolves to the `api` trigger
 * and whose start node carries no non-blank `config.secret` is refused at
 * REGISTRATION — the publish seam — so its author learns before deploying.
 * (`@objectstack/trigger-api`'s own `start()` refuses the same binding for a
 * host that binds without this engine; its tests pin that half.)
 *
 * Every refusal case asserts the substance, not only the throw: the flow is
 * absent from the engine afterwards and the api trigger was never started. The
 * contrast cases pin what stays legal — a signed `api` flow registers and its
 * trigger receives that secret, and a flow that binds no `api` trigger needs
 * none.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';

function createTestLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} } as any;
}

/** A minimal registrable flow whose start node carries `config`. */
function flowWith(
    name: string,
    config: Record<string, unknown>,
    type: string = 'api',
    extra: Record<string, unknown> = {},
) {
    return {
        name,
        label: name,
        type,
        status: 'active',
        ...extra,
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

describe('ADR-0041 — an api flow registers only with its per-flow secret', () => {
    let engine: AutomationEngine;
    let started: FlowTriggerBinding[];
    let stopped: string[];

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        started = [];
        stopped = [];
        // A recording `api` trigger, registered BEFORE the flows, so a flow that
        // got past registration would be started on it at once.
        const trigger: FlowTrigger = {
            type: 'api',
            start: (binding) => {
                started.push(binding);
            },
            stop: (flowName) => {
                stopped.push(flowName);
            },
        };
        engine.registerTrigger(trigger);
    });

    const refused: Array<{ label: string; flow: ReturnType<typeof flowWith> }> = [
        { label: "a `type: 'api'` flow with no secret", flow: flowWith('no_secret', {}) },
        { label: "a `type: 'api'` flow with a blank secret", flow: flowWith('blank_secret', { secret: '   ' }) },
        { label: "a `type: 'api'` flow with a non-string secret", flow: flowWith('numeric_secret', { secret: 42 }) },
        {
            label: "a start-node `triggerType: 'api'` flow with no secret",
            flow: flowWith('token_no_secret', { triggerType: 'api', hookId: 'intake' }, 'autolaunched'),
        },
        {
            // Status-agnostic, like every other registration refusal: an
            // `obsolete` flow is re-enabled by a toggle, not by re-registering.
            label: "an obsolete `type: 'api'` flow with no secret",
            flow: flowWith('obsolete_no_secret', {}, 'api', { status: 'obsolete' }),
        },
    ];

    for (const row of refused) {
        it(`refuses ${row.label} at registration, naming the flow and config.secret, and arms nothing`, async () => {
            const name = row.flow.name;
            expect(() => engine.registerFlow(name, row.flow as never)).toThrow(
                new RegExp(`Flow '${name}' rejected: .*\`api\` trigger.*config\\.secret`, 's'),
            );

            // Not registered: nothing to read back, nothing to run, nothing armed.
            expect(await engine.getFlow(name)).toBeNull();
            expect(engine.getFlowRuntimeStates().map((s) => s.name)).not.toContain(name);
            expect(started).toEqual([]);
        });
    }

    it('registers and binds an api flow that carries its secret, handing the trigger that secret', async () => {
        engine.registerFlow('signed_hook', flowWith('signed_hook', { hookId: 'intake', secret: 's3cret' }) as never);

        expect(await engine.getFlow('signed_hook')).not.toBeNull();
        expect(started).toHaveLength(1);
        expect(started[0].flowName).toBe('signed_hook');
        expect(started[0].config).toMatchObject({ hookId: 'intake', secret: 's3cret' });
        const state = engine.getFlowRuntimeStates().find((s) => s.name === 'signed_hook');
        expect(state?.triggerType).toBe('api');
    });

    it('requires nothing of a flow that binds no api trigger — an autolaunched flow registers without a secret', async () => {
        engine.registerFlow('manual', flowWith('manual', {}, 'autolaunched') as never);

        expect(await engine.getFlow('manual')).not.toBeNull();
        expect(started).toEqual([]);
        expect((await engine.execute('manual')).success).toBe(true);
    });

    it('refuses a re-registration that drops the secret, and the registered signed version stays armed', async () => {
        engine.registerFlow('signed_hook', flowWith('signed_hook', { secret: 's3cret' }) as never);
        expect(started).toHaveLength(1);

        expect(() => engine.registerFlow('signed_hook', flowWith('signed_hook', {}) as never)).toThrow(
            /Flow 'signed_hook' rejected: .*config\.secret/s,
        );

        // The refused definition never replaced the stored one, and the trigger
        // was neither stopped nor re-started with the unsigned binding.
        const stored = await engine.getFlow('signed_hook');
        const start = stored?.nodes.find((n) => n.type === 'start');
        expect((start?.config as Record<string, unknown> | undefined)?.secret).toBe('s3cret');
        expect(started).toHaveLength(1);
        expect(stopped).toEqual([]);
    });
});
