// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] The engine's half of the write-only flow credential channel: an
 * inbound flow stored through the metadata save door keeps no secret in its
 * definition, so the engine registers it on the strength of the channel and
 * hands its trigger a binding that reads the secret at VERIFICATION time.
 *
 * Pinned against a recording `api` trigger and an in-memory channel: the
 * binding resolves what the channel holds; the channel's row wins over a
 * packaged flow's literal (Q3 A); a rotation in the channel reaches the next
 * read without a re-registration; a cleared secret is refused whatever the
 * channel still holds; and `flowCredentialHoldings` names every credential a
 * flow holds, by class, for the clone door.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { AutomationEngine } from './engine.js';
import type { FlowCredentialSource, FlowTrigger, FlowTriggerBinding } from './engine.js';

const HELD = 'pin-engine-held-61c2';
const LITERAL = 'pin-engine-literal-9f03';
const ROTATED = 'pin-engine-rotated-2a7e';

function quiet() {
    return { debug() {}, info() {}, warn() {}, error() {} } as any;
}

/** An in-memory channel: `(flow, node, key)` → value. */
function memoryChannel(initial: Record<string, string> = {}) {
    const rows = new Map(Object.entries(initial));
    const k = (f: string, n: string, key: string) => `${f}/${n}/${key}`;
    const source: FlowCredentialSource = {
        holds: (f, n, key) => rows.has(k(f, n, key)),
        held: (f) =>
            [...rows.keys()]
                .filter((x) => x.startsWith(`${f}/`))
                .map((x) => {
                    const [, nodeId, key] = x.split('/');
                    return { nodeId: nodeId!, key: key! };
                }),
        resolve: async (f, n, key) => rows.get(k(f, n, key)),
    };
    return { source, rows, key: k };
}

function inbound(name: string, startConfig: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'api',
        status: 'active',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { hookId: 'h1', ...startConfig } },
            { id: 'call', type: 'http', label: 'Call', config: { url: 'https://example.invalid/x' } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'begin', target: 'call' },
            { id: 'e2', source: 'call', target: 'finish' },
        ],
    };
}

describe('[#20790] an inbound flow whose secret the channel holds', () => {
    let engine: AutomationEngine;
    let started: FlowTriggerBinding[];

    beforeEach(() => {
        engine = new AutomationEngine(quiet());
        started = [];
        const trigger: FlowTrigger = { type: 'api', start: (b) => { started.push(b); }, stop: () => {} };
        engine.registerTrigger(trigger);
    });

    it('registers with no secret in its definition, and its binding reads the held one at verification', async () => {
        const channel = memoryChannel({ 'held_flow/begin/secret': HELD });
        engine.setFlowCredentialSource(channel.source);

        engine.registerFlow('held_flow', inbound('held_flow', {}));

        expect(started).toHaveLength(1);
        const binding = started[0]!;
        // The trigger's config carries no secret — the definition has none.
        expect(JSON.stringify(binding.config)).not.toContain(HELD);
        expect(typeof binding.resolveSecret).toBe('function');
        expect(await binding.resolveSecret!()).toBe(HELD);

        // A rotation in the channel reaches the next read; nothing re-registers.
        channel.rows.set('held_flow/begin/secret', ROTATED);
        expect(await binding.resolveSecret!()).toBe(ROTATED);
    });

    it('the channel row wins over a packaged flow\'s literal; the literal is the fallback (Q3 A)', async () => {
        const channel = memoryChannel();
        engine.setFlowCredentialSource(channel.source);
        engine.registerFlow('packaged_flow', inbound('packaged_flow', { secret: LITERAL }));
        const binding = started[0]!;
        expect(await binding.resolveSecret!()).toBe(LITERAL);

        channel.rows.set('packaged_flow/begin/secret', HELD);
        expect(await binding.resolveSecret!()).toBe(HELD);
    });

    it('refuses a flow the channel holds nothing for — the ADR-0041 refusal, unchanged', () => {
        engine.setFlowCredentialSource(memoryChannel().source);
        expect(() => engine.registerFlow('bare_flow', inbound('bare_flow', {}))).toThrow(/declares no `config\.secret`/);
        expect(started).toEqual([]);
    });

    it('refuses a CLEARED secret whatever the channel still holds', () => {
        engine.setFlowCredentialSource(memoryChannel({ 'cleared_flow/begin/secret': HELD }).source);
        expect(() => engine.registerFlow('cleared_flow', inbound('cleared_flow', { secret: '' }))).toThrow(
            /declares no `config\.secret`/,
        );
        expect(started).toEqual([]);
    });

    it('a held secret that does not come back rejects the read — never a silent "no secret"', async () => {
        const channel = memoryChannel({ 'broken_flow/begin/secret': HELD });
        channel.source.resolve = async () => {
            throw Object.assign(new Error('no crypto provider'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        };
        engine.setFlowCredentialSource(channel.source);
        engine.registerFlow('broken_flow', inbound('broken_flow', {}));
        await expect(started[0]!.resolveSecret!()).rejects.toThrow(/no crypto provider/);
    });

    it('names every credential a flow holds by class — literal or held — for the clone door', () => {
        const channel = memoryChannel({ 'mixed_flow/call/signingSecret': HELD });
        engine.setFlowCredentialSource(channel.source);
        engine.registerFlow('mixed_flow', inbound('mixed_flow', { secret: LITERAL }));

        const holdings = engine.flowCredentialHoldings('mixed_flow');
        expect(holdings).toEqual([
            { nodeId: 'begin', key: 'secret', label: 'the inbound hook secret', held: 'literal' },
            { nodeId: 'call', key: 'signingSecret', label: 'an outbound signing secret', held: 'channel' },
        ]);
        for (const s of [HELD, LITERAL]) expect(JSON.stringify(holdings)).not.toContain(s);
        expect(engine.flowCredentialHoldings('no_such_flow')).toEqual([]);
    });
});
