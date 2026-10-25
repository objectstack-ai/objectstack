// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `api` flow whose start node NAMES its inbound hook secret
 * (`config.secretRef`) instead of carrying it — the form an app package ships,
 * so no credential is published with it. The engine registers it on the
 * strength of the reference and hands its trigger a binding that resolves the
 * name through the credential resolver at every post.
 *
 * Pinned against a recording `api` trigger: the reader resolves at every call
 * (a rotation reaches the next post); a name with no value REJECTS with the
 * ADR-0112 unavailable pair, naming the flow and the reference and never a
 * value; the default resolver reads the environment; the channel is never
 * asked, even where it holds the position; and a reference the spec refuses is
 * refused at registration rather than armed.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationEngine } from './engine.js';
import type { FlowCredentialSource, FlowTrigger, FlowTriggerBinding } from './engine.js';
import { FlowCredentialUnresolvableError } from './flow-credential-channel.js';

const REF = 'PIN_HOOK_SECRET_REF_4B1E';
const FILLED = 'pin-ref-filled-0d93';
const ROTATED = 'pin-ref-rotated-71a8';
const HELD = 'pin-ref-channel-held-c6f2';

function quiet() {
    return { debug() {}, info() {}, warn() {}, error() {} } as any;
}

function inbound(name: string, startConfig: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'api',
        status: 'active',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { hookId: 'h1', ...startConfig } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    };
}

describe('config.secretRef — an api flow names its hook secret; the deployment fills it', () => {
    let started: FlowTriggerBinding[];
    const trigger: FlowTrigger = { type: 'api', start: (b) => { started.push(b); }, stop: () => {} };
    const saved = process.env[REF];

    beforeEach(() => {
        started = [];
        delete process.env[REF];
    });
    afterEach(() => {
        if (saved === undefined) delete process.env[REF];
        else process.env[REF] = saved;
    });

    function engineWith(values: Map<string, string>, asked: string[] = []): AutomationEngine {
        const engine = new AutomationEngine(quiet(), undefined, {
            credentialResolver: (ref) => {
                asked.push(ref);
                return values.get(ref);
            },
        });
        engine.registerTrigger(trigger);
        return engine;
    }

    it('registers with no secret in its definition, and its binding resolves the name at every post', async () => {
        const values = new Map<string, string>([[REF, FILLED]]);
        const asked: string[] = [];
        const engine = engineWith(values, asked);
        await engine.registerFlow('ref_flow', inbound('ref_flow', { secretRef: REF }) as never);

        expect(started).toHaveLength(1);
        const binding = started[0]!;
        expect(binding.config).toEqual({ hookId: 'h1', secretRef: REF });
        expect(typeof binding.resolveSecret).toBe('function');
        // Registration asked nothing: the name is read per post, never at bind.
        expect(asked).toEqual([]);

        expect(await binding.resolveSecret!()).toBe(FILLED);
        values.set(REF, ROTATED);
        expect(await binding.resolveSecret!()).toBe(ROTATED);
        expect(asked).toEqual([REF, REF]);
    });

    it('a name with no value rejects every post as unavailable — naming the flow and the reference, never a value', async () => {
        const values = new Map<string, string>();
        const engine = engineWith(values);
        await engine.registerFlow('ref_flow', inbound('ref_flow', { secretRef: REF }) as never);
        const binding = started[0]!;

        for (const unfilled of [undefined, '', '   ']) {
            if (unfilled === undefined) values.delete(REF);
            else values.set(REF, unfilled);
            const err = await binding.resolveSecret!().then(
                () => { throw new Error('resolved'); },
                (e: unknown) => e,
            );
            expect(err).toBeInstanceOf(FlowCredentialUnresolvableError);
            expect((err as FlowCredentialUnresolvableError).code).toBe('SERVICE_UNAVAILABLE');
            expect((err as FlowCredentialUnresolvableError).status).toBe(503);
            expect((err as Error).message).toContain(`Flow 'ref_flow'`);
            expect((err as Error).message).toContain(`'${REF}'`);
        }
        // Filled later, the very same binding verifies the next post.
        values.set(REF, FILLED);
        expect(await binding.resolveSecret!()).toBe(FILLED);
    });

    it('the default resolver reads the environment variable of that name', async () => {
        const engine = new AutomationEngine(quiet());
        engine.registerTrigger(trigger);
        await engine.registerFlow('env_flow', inbound('env_flow', { secretRef: REF }) as never);
        const binding = started[0]!;

        await expect(binding.resolveSecret!()).rejects.toBeInstanceOf(FlowCredentialUnresolvableError);
        process.env[REF] = FILLED;
        expect(await binding.resolveSecret!()).toBe(FILLED);
    });

    it('the channel is never asked for a referenced secret, even where it holds that position', async () => {
        const values = new Map<string, string>([[REF, FILLED]]);
        const engine = engineWith(values);
        const channelAsked: string[] = [];
        const source: FlowCredentialSource = {
            holds: () => true,
            held: () => [{ nodeId: 'begin', key: 'secret' }],
            resolve: async (f, n, k) => { channelAsked.push(`${f}/${n}/${k}`); return HELD; },
        };
        engine.setFlowCredentialSource(source);
        await engine.registerFlow('ref_flow', inbound('ref_flow', { secretRef: REF }) as never);

        expect(await started[0]!.resolveSecret!()).toBe(FILLED);
        expect(channelAsked).toEqual([]);
    });

    it('refuses at registration a reference the spec refuses — never arms it', () => {
        const engine = engineWith(new Map([[REF, FILLED]]));
        const refused: Array<[string, Record<string, unknown>]> = [
            ['reserved', { secretRef: 'OS_AUTH_SECRET' }],
            ['blank', { secretRef: '' }],
            ['beside a literal', { secretRef: REF, secret: 'pin-literal-ignored' }],
        ];
        for (const [label, config] of refused) {
            // `registerFlow` parses first and throws the parse's refusal, located at the reference.
            expect(() => engine.registerFlow(`bad_${label.replace(/ /g, '_')}`, inbound('bad', config) as never), label)
                .toThrow(/"secretRef"/);
        }
        expect(started).toEqual([]);
    });
});
