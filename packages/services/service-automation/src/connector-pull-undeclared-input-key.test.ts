// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33894] The connector pull door refuses an input key the read action does
 * not declare, as the `connector_action` node does: every door that
 * dispatches a connector action judges its input alike. The undeclared key
 * the author wrote is pinned beside the door's other input refusals in
 * `connector-pull.test.ts`; this file pins the key the door ADDS itself —
 * the watermark parameter, sent as `query[watermark.param]` once the target
 * holds a value — which only the action can declare (for an `openapi`
 * connector, its OpenAPI document).
 *
 * The schemas below are the shapes the shipped producers emit: the `openapi`
 * generator's `{ path, query, header, body }` sections, where a location the
 * operation declares no parameter in is left out, and the `rest` connector's
 * `request`, whose `query` lists no `properties` and so declares open input.
 *
 * Every refusal asserts the ADR-0112 pair (`code` + `status`), the executor's
 * `reason`, the named key, and that neither the action nor a write ran.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    pullConnectorSource,
    ConnectorPullError,
    type ConnectorPullDeps,
} from './connector-pull.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ConnectorPullDeps['logger'];

const contactObject = {
    name: 'contact',
    fields: {
        external_id: { name: 'external_id', type: 'text' },
        name: { name: 'name', type: 'text' },
        synced_at: { name: 'synced_at', type: 'text' },
    },
};

/** An incremental mapping: `updated_at` is copied onto `synced_at`, and sent back as `query.since`. */
function incrementalMapping(input: Record<string, unknown>) {
    return {
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
            connector: 'crm_api', action: 'list_contacts', input,
            watermark: { field: 'updated_at', param: 'since' },
        },
    };
}

/** An `openapi` operation declaring `query.limit` only — the document never names `since`. */
const OPENAPI_LIMIT_ONLY = {
    type: 'object',
    properties: { query: { type: 'object', properties: { limit: { type: 'integer' } } } },
};

/** An `openapi` operation declaring only a header parameter: the generator emits no `query` section at all. */
const OPENAPI_NO_QUERY = {
    type: 'object',
    properties: { header: { type: 'object', properties: { 'X-Tenant': { type: 'string' } } } },
};

/** The same operation once the document declares `since` as an `in: query` parameter. */
const OPENAPI_SINCE_DECLARED = {
    type: 'object',
    properties: {
        query: { type: 'object', properties: { limit: { type: 'integer' }, since: { type: 'string' } } },
    },
};

/** The `rest` connector's `request` action: `query` lists no `properties`, so every query key is open. */
const REST_REQUEST = {
    type: 'object',
    properties: {
        method: { type: 'string' },
        path: { type: 'string' },
        headers: { type: 'object' },
        query: { type: 'object' },
        body: {},
    },
};

const STORED = [{ synced_at: '2026-01-02T00:00:00.000Z' }];

function harness(opts: {
    /** Absent ⇒ the action declares no `inputSchema`. */
    inputSchema: Record<string, unknown> | undefined;
    input: Record<string, unknown>;
    stored?: Array<Record<string, unknown>>;
}) {
    const writes: unknown[] = [];
    const handler = vi.fn(async (_input: Record<string, unknown>) => ({ status: 200, ok: true, body: [] }) as Record<string, unknown>);
    const mapping = incrementalMapping(opts.input);
    const deps: ConnectorPullDeps = {
        protocol: {
            async getMetaItem({ type, name }) {
                if (type === 'mapping' && name === mapping.name) return { type, name, item: mapping };
                if (type === 'object' && name === 'contact') return { type, name, item: contactObject };
                return undefined;
            },
            async findData() { return { records: opts.stored ?? [] }; },
            async createData(args) { writes.push(args); return { id: 'new' }; },
            async updateData(args) { writes.push(args); return { id: 'upd' }; },
        },
        registry: {
            resolveConnectorAction: (connector, action) =>
                connector === 'crm_api' && action === 'list_contacts' ? handler : undefined,
            getConnectorOrigin: (name) => (name === 'crm_api' ? 'declarative' : undefined),
            getConnectorDegradedReason: () => undefined,
            getConnectorDescriptors: () => [{
                name: 'crm_api', label: 'CRM', type: 'api', origin: 'declarative', state: 'ready',
                actions: [{ key: 'list_contacts', label: 'List contacts', inputSchema: opts.inputSchema }],
            }],
        },
        providerOf: (name) => (name === 'crm_api' ? 'openapi' : undefined),
        logger: silent,
    };
    return { deps, handler, writes };
}

async function refusal(h: ReturnType<typeof harness>): Promise<ConnectorPullError> {
    const err = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' }).then(
        () => undefined,
        (e: unknown) => e,
    );
    expect(err, 'the pull must refuse, not resolve').toBeInstanceOf(ConnectorPullError);
    const e = err as ConnectorPullError;
    expect({ code: e.code, status: e.status, reason: e.reason, mapping: e.mapping }).toEqual({
        code: 'VALIDATION_ERROR', status: 400, reason: 'input_schema_mismatch', mapping: 'crm_contacts',
    });
    expect(h.handler).toHaveBeenCalledTimes(0);
    expect(h.writes).toEqual([]);
    return e;
}

describe('[#33894] connector pull — the watermark parameter the door adds is judged like any other input key', () => {
    it('a watermark parameter the operation does not declare is refused, naming it and the OpenAPI fix', async () => {
        const h = harness({ inputSchema: OPENAPI_LIMIT_ONLY, input: { query: { limit: 50 } }, stored: STORED });
        const err = await refusal(h);
        expect(err.message).toContain("'query.since' is not an input the action declares");
        expect(err.message).toContain("watermark parameter 'since'");
        expect(err.message).toContain('OpenAPI document');
    });

    it('an operation that declares no query parameter at all refuses the watermark the same way', async () => {
        const h = harness({ inputSchema: OPENAPI_NO_QUERY, input: {}, stored: STORED });
        const err = await refusal(h);
        expect(err.message).toContain("'query' is not an input the action declares");
        expect(err.message).toContain("watermark parameter 'since'");
    });

    it('an undeclared key the author wrote does not blame the watermark when the watermark is declared', async () => {
        const h = harness({
            inputSchema: OPENAPI_SINCE_DECLARED,
            input: { query: { limit: 50, stale: 'x' } },
            stored: STORED,
        });
        const err = await refusal(h);
        expect(err.message).toContain("'query.stale' is not an input the action declares");
        expect(err.message).not.toContain('watermark parameter');
    });

    it('CONTROL: once the document declares the watermark parameter, the pull sends it', async () => {
        const h = harness({ inputSchema: OPENAPI_SINCE_DECLARED, input: { query: { limit: 50 } }, stored: STORED });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({ query: { limit: 50, since: '2026-01-02T00:00:00.000Z' } });
    });

    it('CONTROL: the first pull, with nothing stored yet, sends no watermark and so is not refused for it', async () => {
        const h = harness({ inputSchema: OPENAPI_LIMIT_ONLY, input: { query: { limit: 50 } } });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({ query: { limit: 50 } });
    });

    it('CONTROL: an openapi operation with no parameter and no body declares no inputSchema, so nothing is judged and the watermark is sent', async () => {
        const h = harness({ inputSchema: undefined, input: {}, stored: STORED });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({ query: { since: '2026-01-02T00:00:00.000Z' } });
    });

    it('CONTROL: a rest connector\'s open query section takes the watermark parameter as before', async () => {
        const h = harness({ inputSchema: REST_REQUEST, input: { method: 'GET', path: '/contacts' }, stored: STORED });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({
            method: 'GET', path: '/contacts', query: { since: '2026-01-02T00:00:00.000Z' },
        });
    });
});
