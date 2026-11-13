// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32442, ruling A — the read half] The runtime's MCP bridge attests a system
 * object's read opt-in, `enable.aiReadable: true`, through `isAiReadExposed`
 * (`@objectstack/spec/data`) over the object's whole served definition.
 *
 * The tool layer (`packages/mcp`, `mcp-system-object-ai-read.test.ts`) admits a
 * `sys_*` object to the five read tools exactly when this answers `true`. This
 * file pins the answer the one production HTTP bridge gives:
 *
 *   - a system object that declares `enable.aiReadable: true` → `true`;
 *   - a system object that declares nothing, or `false`, or a truthy
 *     non-boolean → `false`;
 *   - the stored-metadata family → `false`, declared or not (refused before
 *     the key is read);
 *   - a business object → `false` (the key means nothing there; the tool layer
 *     never asks for one);
 *   - a name nothing serves → `false`.
 *
 * The objects here are test doubles, never the platform's.
 */

import { describe, it, expect, vi } from 'vitest';

// Paid at collection: the dispatcher's reach loads it lazily (check:test-source-alias).
import '@objectstack/metadata';

import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';

import { HttpDispatcher } from './http-dispatcher.js';

const [FAMILY] = [...STORED_METADATA_BODY_OBJECTS];

function bridgeOver(objects: any[], protocol: any = null) {
    const byName = (n: string) => objects.find((o) => o.name === n);
    const metadata: any = {
        load: vi.fn(async () => null),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => objects),
        getObject: vi.fn(async (n: string) => byName(n)),
    };
    const ql: any = { getSchema: byName, registry: { getObject: byName, getItem: () => undefined } };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'protocol' ? protocol : null),
        },
    };
    const ctx: any = {
        request: {},
        environmentId: 'platform',
        executionContext: { userId: 'u_agent', permissions: [], systemPermissions: [] },
    };
    return (new HttpDispatcher(kernel) as any).buildMcpBridge(ctx);
}

describe('[#32442] the HTTP MCP bridge attests enable.aiReadable with isAiReadExposed', () => {
    const bridge = bridgeOver([
        { name: 'sys_probe_request', fields: {}, enable: { aiReadable: true } },
        { name: 'sys_probe_closed', fields: {}, enable: { aiReadable: false } },
        { name: 'sys_probe_silent', fields: {} },
        { name: 'sys_probe_stringly', fields: {}, enable: { aiReadable: 'true' } },
        { name: FAMILY, fields: {}, enable: { aiReadable: true } },
        { name: 'probe_task', fields: {}, enable: { aiReadable: true } },
    ]);

    it('answers true for a system object that declares aiReadable: true', async () => {
        expect(await bridge.aiReadExposed('sys_probe_request')).toBe(true);
    });

    it.each(['sys_probe_closed', 'sys_probe_silent', 'sys_probe_stringly'])(
        'answers false for %s (declared false, nothing, or a non-boolean)',
        async (name) => {
            expect(await bridge.aiReadExposed(name)).toBe(false);
        },
    );

    it('answers false for the stored-metadata family even when it declares the key', async () => {
        expect(await bridge.aiReadExposed(FAMILY)).toBe(false);
    });

    it('answers false for a business object and for a name nothing serves', async () => {
        expect(await bridge.aiReadExposed('probe_task')).toBe(false);
        expect(await bridge.aiReadExposed('sys_probe_missing')).toBe(false);
    });
});

describe('[#32442] the bridge reads the merged listing once for every aiReadExposed ask it answers', () => {
    it('answers several names from one merged read', async () => {
        const getMetaItems = vi.fn(async () => ({
            type: 'object',
            items: [
                { name: 'sys_probe_request', fields: {}, enable: { aiReadable: true } },
                { name: 'sys_probe_silent', fields: {} },
            ],
        }));
        const bridge = bridgeOver([], { getMetaItems });
        expect(await bridge.aiReadExposed('sys_probe_request')).toBe(true);
        expect(await bridge.aiReadExposed('sys_probe_silent')).toBe(false);
        expect(await bridge.aiReadExposed('sys_probe_missing')).toBe(false);
        expect(getMetaItems).toHaveBeenCalledTimes(1);
    });
});
