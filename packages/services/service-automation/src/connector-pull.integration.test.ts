// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20919] The connector sync executor end to end: a declared `rest`
 * connector instance, materialized by this plugin through the REAL `rest`
 * provider (`@objectstack/connector-rest`), reads a local HTTP fixture server
 * over a real socket; the records go through the moved import runner into a
 * real ObjectQL engine on SQLite.
 *
 * Two pulls on one mapping (`mode: 'upsert'`, `upsertKey: ['external_id']`,
 * `watermark: { field: 'updated_at', param: 'since' }`):
 *
 *   1. the first sends no `since` (nothing is stored yet) and creates both
 *      records;
 *   2. the second sends `since` = the highest `synced_at` STORED in the
 *      target — the field `fieldMapping` copies `updated_at` onto (W1: the
 *      watermark is read from the target, never kept anywhere else) — and the
 *      server answers with one changed record and one new one: the changed one
 *      is UPDATED by its match key, the new one created.
 *
 * `connector-rest` is imported from its source by relative path: its own
 * dev-dependency on this package means a manifest edge back would close a
 * cycle, so the read is declared as a cross-package test input instead.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ConnectorRestPlugin } from '../../../connectors/connector-rest/src/index.js';
import { AutomationServicePlugin } from './plugin.js';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ConnectorPullProtocol } from './connector-pull.js';

const CONTACT = {
    name: 'contact',
    label: 'Contact',
    fields: {
        external_id: { name: 'external_id', label: 'External id', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        synced_at: { name: 'synced_at', label: 'Synced at', type: 'text' },
    },
};

const MAPPING = {
    name: 'crm_contacts',
    targetObject: 'contact',
    fieldMapping: [
        { source: 'id', target: 'external_id' },
        { source: 'name', target: 'name' },
        { source: 'updated_at', target: 'synced_at' },
    ],
    mode: 'upsert',
    upsertKey: ['external_id'],
    connectorSource: {
        connector: 'crm_api',
        action: 'request',
        input: { method: 'GET', path: '/contacts' },
        recordsPath: 'body.results',
        watermark: { field: 'updated_at', param: 'since' },
    },
};

const SYSTEM = { isSystem: true };

/** The fixture CRM: answers `GET /contacts` from `pages`, recording each request's query. */
function startFixture(pages: Array<Array<Record<string, unknown>>>): Promise<{ server: Server; base: string; seen: URLSearchParams[] }> {
    const seen: URLSearchParams[] = [];
    let call = 0;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://fixture');
        if (req.method !== 'GET' || url.pathname !== '/contacts') {
            res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
            return;
        }
        seen.push(url.searchParams);
        const results = pages[Math.min(call++, pages.length - 1)];
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results }));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, base: `http://127.0.0.1:${port}`, seen });
        });
    });
}

type InsertOptions = NonNullable<Parameters<ObjectQL['insert']>[2]>;
type UpdateOptions = NonNullable<Parameters<ObjectQL['update']>[2]>;

/** The import runner's protocol surface over a real ObjectQL engine, plus the metadata read. */
function protocolOver(ql: ObjectQL): ConnectorPullProtocol {
    return {
        async getMetaItem({ type, name }) {
            if (type === 'mapping' && name === MAPPING.name) return { type, name, item: MAPPING };
            if (type === 'object') {
                const item = ql.registry.getObject(name);
                return item ? { type, name, item } : undefined;
            }
            return undefined;
        },
        async findData({ object, query, context }) {
            const { object: _omit, ...rest } = (query ?? {}) as EngineQueryOptions & { object?: string };
            const options: EngineQueryOptions = { ...rest, context: context as EngineQueryOptions['context'] };
            return { object, records: await ql.find(object, options) };
        },
        async createData({ object, data, context }) {
            const options: InsertOptions = { context: context as InsertOptions['context'] };
            return ql.insert(object, data, options);
        },
        async updateData({ object, id, data, context }) {
            const options: UpdateOptions = { where: { id }, context: context as UpdateOptions['context'] };
            return ql.update(object, data, options);
        },
    };
}

describe('[#20919] connector pull, end to end through a real rest connector', () => {
    let kernel: LiteKernel | undefined;
    let server: Server | undefined;

    afterEach(async () => {
        try { await kernel?.shutdown(); } catch { /* noop */ }
        await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
        kernel = undefined;
        server = undefined;
    });

    it('writes the pulled rows, then upserts by match key with the watermark read from the target', async () => {
        const fixture = await startFixture([
            [
                { id: 'c1', name: 'Ada', updated_at: '2026-01-01T00:00:00.000Z' },
                { id: 'c2', name: 'Grace', updated_at: '2026-01-02T00:00:00.000Z' },
            ],
            [
                { id: 'c2', name: 'Grace Hopper', updated_at: '2026-01-03T00:00:00.000Z' },
                { id: 'c3', name: 'Edsger', updated_at: '2026-01-04T00:00:00.000Z' },
            ],
        ]);
        server = fixture.server;

        const ql = new ObjectQL();
        ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
        await ql.init();
        ql.registry.registerObject(CONTACT as any);
        await ql.syncSchemas();

        const automation = new AutomationServicePlugin({ suspendedRunStore: 'memory' });
        kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(automation);
        kernel.use(new ConnectorRestPlugin());
        kernel.use({
            name: 'test.harness',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: any) {
                // The declared `connectors[]` entry, as `registerApp` stores it.
                ctx.registerService('objectql', {
                    registry: {
                        listItems: (type: string) => (type === 'connector'
                            ? [{ name: 'crm_api', label: 'CRM', type: 'api', provider: 'rest', providerConfig: { baseUrl: fixture.base } }]
                            : []),
                    },
                });
                ctx.registerService('protocol', protocolOver(ql));
            },
            async start() {},
        } as never);
        await kernel.bootstrap();

        // Pull 1: nothing stored, so no starting point — the full set.
        const first = await automation.pullConnectorSource({ mapping: 'crm_contacts', context: SYSTEM });
        expect(first.summary.errors, JSON.stringify(first.summary.results)).toBe(0);
        expect({ pulled: first.pulled, created: first.summary.created, updated: first.summary.updated })
            .toEqual({ pulled: 2, created: 2, updated: 0 });
        expect(fixture.seen[0].has('since')).toBe(false);
        expect(first.watermark).toEqual({ field: 'updated_at', target: 'synced_at', param: 'since', from: undefined });

        // Pull 2: the starting point is the highest `synced_at` stored by pull 1.
        const second = await automation.pullConnectorSource({ mapping: 'crm_contacts', context: SYSTEM });
        expect(fixture.seen[1].get('since')).toBe('2026-01-02T00:00:00.000Z');
        expect(second.watermark?.from).toBe('2026-01-02T00:00:00.000Z');
        expect(second.summary.errors, JSON.stringify(second.summary.results)).toBe(0);
        expect({ pulled: second.pulled, created: second.summary.created, updated: second.summary.updated })
            .toEqual({ pulled: 2, created: 1, updated: 1 });

        const rows = await ql.find('contact', { orderBy: [{ field: 'external_id', order: 'asc' }], context: SYSTEM });
        expect(rows.map((r: any) => ({ external_id: r.external_id, name: r.name, synced_at: r.synced_at }))).toEqual([
            { external_id: 'c1', name: 'Ada', synced_at: '2026-01-01T00:00:00.000Z' },
            { external_id: 'c2', name: 'Grace Hopper', synced_at: '2026-01-03T00:00:00.000Z' },
            { external_id: 'c3', name: 'Edsger', synced_at: '2026-01-04T00:00:00.000Z' },
        ]);
    });
});
