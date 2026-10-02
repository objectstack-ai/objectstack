// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] C1 — the clone door (`POST /automation/:name/clone`) refuses a
 * source that holds a credential at ANY position of the flow
 * credential-location table: a literal in its definition (a packaged flow's
 * source) or one the write-only flow credential channel holds — the inbound
 * hook secret and the outbound signing secret alike (Q4 A). A copy would
 * share it, and two flows never share a secret (Q2 A); the refusal names the
 * positions by class and prescribes authoring the copy with its own secret.
 *
 * ⚠️ The accepted cost, pinned as such: a packaged inbound flow (the ADR-0126
 * §7.1 customization path) is no longer cloned in one step.
 *
 * Each refusal asserts the ADR-0112 envelope (`code` + `status`), that nothing
 * was registered, and that the answer carries no value.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMetadataTypeRedactor, registerMetadataTypeRedactor } from '@objectstack/spec/kernel';
import type { MetadataTypeRedactor } from '@objectstack/spec/kernel';

import { HttpDispatcher } from '../http-dispatcher.js';
import {
    FLOW_CLONE_CREDENTIAL_REFUSAL_CODE,
    FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS,
    type FlowCloneCredentialHolding,
} from '../flow-clone.js';

const CTX = { request: {}, executionContext: { userId: 'user_1', systemPermissions: ['manage_metadata'] } } as any;
const LITERAL = 'pin-clone-literal-6c3e';

function inbound(name: string, startConfig: Record<string, unknown> = {}) {
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

/** The automation service double: `getFlow` / `registerFlow`, plus (optionally) the engine's credential answer. */
function makeDispatcher(
    seed: Record<string, unknown>[],
    holdings?: (name: string) => FlowCloneCredentialHolding[],
) {
    const flows = new Map<string, Record<string, unknown>>(seed.map((f) => [f.name as string, f]));
    const spies: Record<string, unknown> = {
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        registerFlow: vi.fn((name: string, definition: unknown) => {
            flows.set(name, definition as Record<string, unknown>);
        }),
    };
    if (holdings) spies.flowCredentialHoldings = vi.fn(holdings);
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), spies };
}

const clone = (dispatcher: HttpDispatcher, source: string) =>
    dispatcher.handleAutomation(`/${source}/clone`, 'POST', { name: `${source}_copy`, label: 'Copy' }, CTX);

function expectRefused(result: Awaited<ReturnType<typeof clone>>, spies: Record<string, unknown>, classes: string[]) {
    expect(result.handled).toBe(true);
    expect(result.response?.status).toBe(FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS);
    expect(FLOW_CLONE_CREDENTIAL_REFUSAL_STATUS).toBe(409);
    const error = result.response?.body?.error;
    expect(result.response?.body?.success).toBe(false);
    expect(error?.code).toBe(FLOW_CLONE_CREDENTIAL_REFUSAL_CODE);
    expect(error?.code).toBe('RESOURCE_CONFLICT');
    expect(error?.httpStatus).toBe(409);
    const message: string = error?.message ?? '';
    for (const c of classes) expect(message).toContain(c);
    // Q2 A's prescription: the copy is authored with its own secret.
    expect(message).toContain('cannot be cloned in one step');
    expect(message).toContain('create a new flow under a new machine name');
    expect(JSON.stringify(result.response?.body)).not.toContain(LITERAL);
    expect(spies.registerFlow).not.toHaveBeenCalled();
}

describe('[#20790] C1 — a source that holds a credential is never cloned in one step', () => {
    it('refuses a source whose inbound secret the write-only channel holds', async () => {
        const { dispatcher, spies } = makeDispatcher([inbound('held_intake')], (name) =>
            name === 'held_intake' ? [{ key: 'secret', label: 'the inbound hook secret', held: 'channel' }] : [],
        );
        const result = await clone(dispatcher, 'held_intake');
        expectRefused(result, spies, ['the inbound hook secret', '`config.secret` on its start node']);
    });

    it('refuses a source whose definition carries a literal — a packaged inbound flow (the accepted cost)', async () => {
        const { dispatcher, spies } = makeDispatcher([inbound('packaged_intake', { secret: LITERAL })], (name) =>
            name === 'packaged_intake' ? [{ key: 'secret', label: 'the inbound hook secret', held: 'literal' }] : [],
        );
        expectRefused(await clone(dispatcher, 'packaged_intake'), spies, ['the inbound hook secret']);
    });

    it('refuses a source whose outbound signing secret is held (Q4 A) — a copy would deliver unsigned', async () => {
        const { dispatcher, spies } = makeDispatcher([inbound('signed_callout')], () => [
            { key: 'signingSecret', label: 'an outbound signing secret', held: 'channel' },
        ]);
        expectRefused(await clone(dispatcher, 'signed_callout'), spies, [
            'an outbound signing secret',
            '`config.signingSecret` on each http node that signs',
        ]);
    });

    it('clones a source that holds no credential, as before', async () => {
        const { dispatcher, spies } = makeDispatcher([inbound('quiet_flow')], () => []);
        const result = await clone(dispatcher, 'quiet_flow');
        expect(result.response?.status).toBe(200);
        expect(spies.registerFlow).toHaveBeenCalledTimes(1);
    });

    describe('an automation service that does not report holdings', () => {
        let previous: MetadataTypeRedactor | undefined;
        beforeAll(() => {
            previous = getMetadataTypeRedactor('flow');
            // The table's projection as the automation plugin registers it:
            // the start node's `secret` is a credential position.
            registerMetadataTypeRedactor('flow', (item) => {
                const nodes = item.nodes as any[];
                const redactedKeys: string[] = [];
                nodes.forEach((n, i) => {
                    if (n?.type === 'start' && n.config && 'secret' in n.config && n.config.secret !== '') {
                        redactedKeys.push(`nodes.${i}.config.secret`);
                    }
                });
                return { item, redactedKeys };
            });
        });
        afterAll(() => {
            if (previous) registerMetadataTypeRedactor('flow', previous);
        });

        it('still refuses a literal-held source, read through the registered credential table', async () => {
            const { dispatcher, spies } = makeDispatcher([inbound('foreign_engine_flow', { secret: LITERAL })]);
            expectRefused(await clone(dispatcher, 'foreign_engine_flow'), spies, ['the credential at `secret`']);
        });
    });
});
