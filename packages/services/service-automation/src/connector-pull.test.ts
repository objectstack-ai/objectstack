// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20919] The connector sync executor's refusals — each one loud, typed and
 * raised BEFORE anything is written.
 *
 * Every case asserts the ADR-0112 pair (`code` + `status`) plus the executor's
 * own discriminator (`reason`), never the message prose, and every case also
 * asserts that no write reached the protocol: a refusal that half-wrote is the
 * silent failure this executor exists to prevent. The end-to-end pull through
 * a real `rest` connector lives in `connector-pull.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    pullConnectorSource,
    ConnectorPullError,
    type ConnectorPullDeps,
    type ConnectorPullRefusalReason,
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

function baseMapping(over: Record<string, unknown> = {}) {
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
        connectorSource: { connector: 'crm_api', action: 'request', input: { method: 'GET', path: '/contacts' } },
        ...over,
    };
}

interface Harness {
    deps: ConnectorPullDeps;
    handler: ReturnType<typeof vi.fn>;
    writes: unknown[];
}

function harness(opts: {
    mapping?: unknown;
    origin?: 'declarative' | 'plugin' | undefined;
    degraded?: string;
    provider?: string | undefined;
    result?: unknown;
    stored?: Array<Record<string, unknown>>;
} = {}): Harness {
    const writes: unknown[] = [];
    const handler = vi.fn(async () => (opts.result ?? { status: 200, ok: true, body: [] }) as Record<string, unknown>);
    const mapping = 'mapping' in opts ? opts.mapping : baseMapping();
    const deps: ConnectorPullDeps = {
        protocol: {
            async getMetaItem({ type, name }) {
                if (type === 'mapping' && mapping && name === (mapping as { name: string }).name) {
                    return { type, name, item: mapping };
                }
                if (type === 'object' && name === 'contact') return { type, name, item: contactObject };
                return undefined;
            },
            async findData() { return { records: opts.stored ?? [] }; },
            async createData(args) { writes.push(args); return { id: 'new' }; },
            async updateData(args) { writes.push(args); return { id: 'upd' }; },
        },
        registry: {
            resolveConnectorAction: (connector, action) =>
                connector === 'crm_api' && action === 'request' ? handler : undefined,
            getConnectorOrigin: (name) =>
                name === 'crm_api' ? ('origin' in opts ? opts.origin : 'declarative') : undefined,
            getConnectorDegradedReason: () => opts.degraded,
        },
        providerOf: (name) => (name === 'crm_api' ? ('provider' in opts ? opts.provider : 'rest') : undefined),
        logger: silent,
    };
    return { deps, handler, writes };
}

async function refusal(h: Harness, mapping = 'crm_contacts'): Promise<ConnectorPullError> {
    const err = await pullConnectorSource(h.deps, { mapping }).then(
        () => undefined,
        (e: unknown) => e,
    );
    expect(err, 'the pull must refuse, not resolve').toBeInstanceOf(ConnectorPullError);
    return err as ConnectorPullError;
}

function expectRefused(
    err: ConnectorPullError,
    want: { code: string; status: number; reason: ConnectorPullRefusalReason },
): void {
    expect({ code: err.code, status: err.status, reason: err.reason, mapping: err.mapping }).toEqual({
        ...want,
        mapping: 'crm_contacts',
    });
}

describe('[#20919] connector pull — the five ordered refusals', () => {
    it('ok:false from the action is EXTERNAL_SERVICE_ERROR 502, and nothing is written', async () => {
        const h = harness({ result: { status: 503, ok: false, body: { error: 'down' } } });
        const err = await refusal(h);
        expectRefused(err, { code: 'EXTERNAL_SERVICE_ERROR', status: 502, reason: 'upstream_not_ok' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.writes).toEqual([]);
    });

    it('a non-array at recordsPath is INTEGRATION_ERROR 502 — the default path (`body`) and a declared one alike', async () => {
        const object = harness({ result: { status: 200, ok: true, body: { results: [{ id: 'c1' }] } } });
        expectRefused(await refusal(object), { code: 'INTEGRATION_ERROR', status: 502, reason: 'records_not_array' });
        expect(object.writes).toEqual([]);

        const declared = harness({
            mapping: baseMapping({
                connectorSource: { connector: 'crm_api', action: 'request', recordsPath: 'body.items' },
            }),
            result: { status: 200, ok: true, body: { results: [{ id: 'c1' }] } },
        });
        expectRefused(await refusal(declared), { code: 'INTEGRATION_ERROR', status: 502, reason: 'records_not_array' });
        expect(declared.writes).toEqual([]);
    });

    it('a plugin-registered connector (not a `connectors[]` entry) is refused before the action runs', async () => {
        const h = harness({ origin: 'plugin' });
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'connector_plugin_origin' });
        expect(h.handler).not.toHaveBeenCalled();
        expect(h.writes).toEqual([]);
    });

    it('a watermark.field no fieldMapping entry copies onto the target is refused before the action runs', async () => {
        const unmapped = harness({
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request',
                    watermark: { field: 'modified', param: 'since' },
                },
            }),
        });
        expectRefused(await refusal(unmapped), { code: 'VALIDATION_ERROR', status: 400, reason: 'watermark_field_unmapped' });
        expect(unmapped.handler).not.toHaveBeenCalled();

        // Mapped, but through a transform: the target does not hold the pulled value.
        const transformed = harness({
            mapping: baseMapping({
                fieldMapping: [
                    { source: 'id', target: 'external_id' },
                    { source: 'updated_at', target: 'synced_at', transform: 'map', params: { valueMap: {} } },
                ],
                connectorSource: {
                    connector: 'crm_api', action: 'request',
                    watermark: { field: 'updated_at', param: 'since' },
                },
            }),
        });
        expectRefused(await refusal(transformed), { code: 'VALIDATION_ERROR', status: 400, reason: 'watermark_field_unmapped' });
        expect(transformed.handler).not.toHaveBeenCalled();
        expect(transformed.writes).toEqual([]);
    });

    it.each(['update', 'upsert'])('mode %s with an empty upsertKey is refused before the action runs', async (mode) => {
        for (const upsertKey of [undefined, [], ['']]) {
            const h = harness({ mapping: baseMapping({ mode, upsertKey }) });
            expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'upsert_key_empty' });
            expect(h.handler).not.toHaveBeenCalled();
            expect(h.writes).toEqual([]);
        }
    });
});

describe('[#20919] connector pull — the binding refusals around them', () => {
    it('an unknown mapping is the import door\'s MAPPING_NOT_FOUND 404', async () => {
        const h = harness();
        const err = await pullConnectorSource(h.deps, { mapping: 'nope' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConnectorPullError);
        expect({ code: (err as ConnectorPullError).code, status: (err as ConnectorPullError).status, reason: (err as ConnectorPullError).reason })
            .toEqual({ code: 'MAPPING_NOT_FOUND', status: 404, reason: 'mapping_not_found' });
    });

    it('a mapping with no connectorSource has nothing to pull', async () => {
        const h = harness({ mapping: baseMapping({ connectorSource: undefined }) });
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'no_connector_source' });
    });

    it('a connector that is not registered at all is refused', async () => {
        const h = harness({ mapping: baseMapping({ connectorSource: { connector: 'ghost', action: 'request' } }) });
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'connector_not_registered' });
    });

    it('a degraded instance is SERVICE_UNAVAILABLE 503, not a pull of nothing', async () => {
        const h = harness({ degraded: 'upstream unavailable' });
        expectRefused(await refusal(h), { code: 'SERVICE_UNAVAILABLE', status: 503, reason: 'connector_degraded' });
        expect(h.handler).not.toHaveBeenCalled();
    });

    it.each([['mcp'], [undefined]])('a declared instance whose provider is %s (not rest/openapi) is refused', async (provider) => {
        const h = harness({ provider });
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'connector_provider_unsupported' });
        expect(h.handler).not.toHaveBeenCalled();
    });

    it('an action the connector does not declare is refused', async () => {
        const h = harness({ mapping: baseMapping({ connectorSource: { connector: 'crm_api', action: 'list' } }) });
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'connector_action_unknown' });
    });

    it('a `javascript` transform is the import door\'s UNSUPPORTED_TRANSFORM, even on an empty pull', async () => {
        const h = harness({
            mapping: baseMapping({
                fieldMapping: [{ source: 'id', target: 'external_id', transform: 'javascript' }],
            }),
        });
        expectRefused(await refusal(h), { code: 'UNSUPPORTED_TRANSFORM', status: 400, reason: 'unsupported_transform' });
        expect(h.handler).not.toHaveBeenCalled();
    });

    it('a record that is not an object is refused, and no row of the response is written', async () => {
        const h = harness({ result: { status: 200, ok: true, body: [{ id: 'c1', name: 'A' }, 'c2'] } });
        expectRefused(await refusal(h), { code: 'INTEGRATION_ERROR', status: 502, reason: 'record_not_object' });
        expect(h.writes).toEqual([]);
    });

    it('a fieldMapping target that is no field of the object is the import door\'s INVALID_FIELD refusal', async () => {
        const h = harness({
            mapping: baseMapping({ fieldMapping: [{ source: 'id', target: 'external_id' }, { source: 'x', target: 'nope' }] }),
        });
        const err = await refusal(h);
        expect({ code: err.code, status: err.status, reason: err.reason })
            .toEqual({ code: 'INVALID_FIELD', status: 400, reason: 'mapping_target_refused' });
        expect(h.handler).not.toHaveBeenCalled();
    });
});

describe('[#20919] connector pull — one action call, the watermark read from the target', () => {
    it('sends the highest stored target value as query[param], merged into the declared input', async () => {
        const h = harness({
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request',
                    input: { method: 'GET', path: '/contacts', query: { limit: 50 } },
                    watermark: { field: 'updated_at', param: 'since' },
                },
            }),
            stored: [{ id: 'r1', synced_at: '2026-01-02T00:00:00.000Z' }],
            result: { status: 200, ok: true, body: [] },
        });
        const findData = vi.spyOn(h.deps.protocol, 'findData');
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({
            method: 'GET', path: '/contacts', query: { limit: 50, since: '2026-01-02T00:00:00.000Z' },
        });
        // The read that produced it: the TARGET field, highest first, one row.
        expect(findData.mock.calls[0][0]).toMatchObject({
            object: 'contact',
            query: { where: { synced_at: { $ne: null } }, orderBy: [{ field: 'synced_at', order: 'desc' }], limit: 1 },
        });
        expect(res.watermark).toEqual({ field: 'updated_at', target: 'synced_at', param: 'since', from: '2026-01-02T00:00:00.000Z' });
        expect(res.pulled).toBe(0);
    });

    it('a first incremental pull (nothing stored yet) sends no starting point and reads the full set', async () => {
        const h = harness({
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request', input: { path: '/contacts' },
                    watermark: { field: 'updated_at', param: 'since' },
                },
            }),
            stored: [],
        });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler.mock.calls[0][0]).toEqual({ path: '/contacts' });
        expect(res.watermark?.from).toBeUndefined();
    });
});
