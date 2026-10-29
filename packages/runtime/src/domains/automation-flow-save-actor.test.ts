// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27414, ADR-0073 D3] The `/automation` definition doors record who saved.
 *
 * `POST /`, `PUT /:name` and `POST /:name/clone` persist through one path,
 * `registerAndSaveFlow`, which called `protocol.saveMetaItem` with no `actor`
 * although the execution context it had just admitted carried the caller's
 * `userId`. So the `sys_metadata` row a signed-in admin created, updated or
 * cloned recorded `null` in `created_by` / `updated_by` and in
 * `sys_metadata_history.recorded_by`. The save now passes the caller's id the
 * way the toggle door does (`activationCaller`), and nothing when the context
 * has no user.
 *
 * ## The rig
 *
 * One REAL store, as in `meta-save-actor.test.ts`: better-sqlite3 `:memory:`,
 * the real `sys_metadata*` objects and a real
 * `ObjectStackProtocolImplementation`, so the claim is about the rows, read
 * back after every save. The automation service is a fake that holds the
 * flows it is given; the door is driven through the real `HttpDispatcher`.
 *
 * The CONTROL is a caller with no user (`isSystem`, the engine's own
 * self-invocation shape): its save records null, as before.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const SOURCE = 'customer_source_flow';

const definitionOf = (name: string, label: string) => ({
    name,
    label,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** An author holds `manage_metadata`, so every door below admits the write. */
const author = (userId: string): HttpProtocolContext => ({
    request: {},
    executionContext: { userId, systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);
/** CONTROL: engine self-invocation, admitted by `isSystem`, with no user to record. */
const SYSTEM = (): HttpProtocolContext => ({ request: {}, executionContext: { isSystem: true } } as HttpProtocolContext);

interface Recorded { created_by: unknown; updated_by: unknown; recorded_by: unknown[] }

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const flows = new Map<string, unknown>([[SOURCE, definitionOf(SOURCE, 'Source')]]);
    const automation = {
        handlerReady: true,
        registerFlow: (name: string, definition: unknown) => { flows.set(name, definition); return definition; },
        unregisterFlow: (name: string) => { flows.delete(name); },
        getFlow: async (name: string) => flows.get(name) ?? null,
        listFlows: async () => [...flows.keys()],
    };
    const services: Record<string, unknown> = { protocol, automation };
    const resolve = (name: string): unknown => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };

    const recorded = async (name: string): Promise<Recorded> => {
        const rows = await engine.find('sys_metadata', { where: { type: 'flow', name } });
        expect(rows ?? [], `one sys_metadata row for ${name}`).toHaveLength(1);
        const history = await engine.find('sys_metadata_history', { where: { type: 'flow', name } });
        return {
            created_by: (rows as any[])[0].created_by ?? null,
            updated_by: (rows as any[])[0].updated_by ?? null,
            recorded_by: [...(history ?? [])]
                .sort((a: any, b: any) => Number(a.version) - Number(b.version))
                .map((h: any) => h.recorded_by ?? null),
        };
    };
    return { dispatcher: new HttpDispatcher(kernel), recorded };
}

const statusOf = (r: { response?: { status?: number } }) => r.response?.status;

describe('[#27414] the /automation definition doors record the user who saved', () => {
    it('POST / records the creator; PUT /:name by another user records that user as the updater', async () => {
        const h = await boot();
        expect(statusOf(await h.dispatcher.handleAutomation('', 'POST', definitionOf('new_flow', 'v1'), author('u_author'), undefined))).toBe(200);
        expect(await h.recorded('new_flow')).toEqual({ created_by: 'u_author', updated_by: 'u_author', recorded_by: ['u_author'] });

        const definition = definitionOf('new_flow', 'v2');
        expect(statusOf(await h.dispatcher.handleAutomation('/new_flow', 'PUT', { definition }, author('u_editor'), undefined))).toBe(200);
        expect(await h.recorded('new_flow')).toEqual({ created_by: 'u_author', updated_by: 'u_editor', recorded_by: ['u_author', 'u_editor'] });
    }, 60_000);

    it('POST /:name/clone records the admin who cloned on the copy', async () => {
        const h = await boot();
        const result = await h.dispatcher.handleAutomation(
            `/${SOURCE}/clone`, 'POST', { name: 'my_copy', label: 'My Copy' }, author('u_admin'), undefined,
        );
        expect(statusOf(result)).toBe(200);
        expect(await h.recorded('my_copy')).toEqual({ created_by: 'u_admin', updated_by: 'u_admin', recorded_by: ['u_admin'] });
    }, 60_000);

    it('CONTROL: a caller with no user records null on all three doors, never a label', async () => {
        const h = await boot();
        expect(statusOf(await h.dispatcher.handleAutomation('', 'POST', definitionOf('sys_flow', 'v1'), SYSTEM(), undefined))).toBe(200);
        expect(statusOf(await h.dispatcher.handleAutomation('/sys_flow', 'PUT', { definition: definitionOf('sys_flow', 'v2') }, SYSTEM(), undefined))).toBe(200);
        expect(await h.recorded('sys_flow')).toEqual({ created_by: null, updated_by: null, recorded_by: [null, null] });

        expect(statusOf(await h.dispatcher.handleAutomation(`/${SOURCE}/clone`, 'POST', { name: 'sys_copy', label: 'System Copy' }, SYSTEM(), undefined))).toBe(200);
        expect(await h.recorded('sys_copy')).toEqual({ created_by: null, updated_by: null, recorded_by: [null] });
    }, 60_000);
});
