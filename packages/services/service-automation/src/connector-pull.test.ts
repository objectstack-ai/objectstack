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
import { buildFieldMetaMap, runImport } from '@objectstack/core';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { SchemaRegistry } from '@objectstack/objectql';
import { mappingNameResolver } from './connector-package-scope.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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
    /** The `inputSchema` the action declares on `GET /connectors`; absent ⇒ none declared. */
    inputSchema?: Record<string, unknown>;
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
            getConnectorDescriptors: () => [{
                name: 'crm_api', label: 'CRM', type: 'api', origin: 'declarative', state: 'ready',
                actions: [{ key: 'request', label: 'HTTP Request', inputSchema: opts.inputSchema }],
            }],
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

/**
 * [#28040] The pull door judges the input it is about to send against the
 * action's declared `inputSchema` — the check the `connector_action` node
 * runs (#27995), through the same helper — and refuses BEFORE dispatch. The
 * pin is the upstream call count: a refused pull never calls the action.
 */
describe('[#28040] connector pull — the input is checked against the action\'s inputSchema before dispatch', () => {
    /** An action whose `query.since` is required and whose `query.limit` is an integer. */
    const SINCE_REQUIRED = {
        type: 'object',
        properties: {
            method: { type: 'string' },
            path: { type: 'string' },
            query: {
                type: 'object',
                properties: { since: { type: 'string' }, limit: { type: 'integer' } },
                required: ['since'],
            },
        },
        required: ['path', 'query'],
    };

    it('an input missing a required parameter is VALIDATION_ERROR 400 naming it, and the action is never called', async () => {
        const h = harness({
            inputSchema: SINCE_REQUIRED,
            mapping: baseMapping({
                connectorSource: { connector: 'crm_api', action: 'request', input: { path: '/contacts', query: {} } },
            }),
        });
        const err = await refusal(h);
        expectRefused(err, { code: 'VALIDATION_ERROR', status: 400, reason: 'input_schema_mismatch' });
        expect(err.message).toContain("missing required 'query.since'");
        expect(h.handler).toHaveBeenCalledTimes(0);
        expect(h.writes).toEqual([]);
    });

    it('a missing required section names the parameters it requires', async () => {
        const h = harness({ inputSchema: SINCE_REQUIRED });
        const err = await refusal(h);
        expectRefused(err, { code: 'VALIDATION_ERROR', status: 400, reason: 'input_schema_mismatch' });
        expect(err.message).toContain("missing required 'query' (with 'query.since')");
        expect(h.handler).toHaveBeenCalledTimes(0);
        expect(h.writes).toEqual([]);
    });

    it('a parameter of the wrong type is refused the same way, and text is not converted to the integer', async () => {
        const h = harness({
            inputSchema: SINCE_REQUIRED,
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request',
                    input: { path: '/contacts', query: { since: '2026-01-01', limit: '50' } },
                },
            }),
        });
        const err = await refusal(h);
        expectRefused(err, { code: 'VALIDATION_ERROR', status: 400, reason: 'input_schema_mismatch' });
        expect(err.message).toContain("'query.limit' must be integer, got string");
        // The pull door runs no CEL, so its hint says what JSON to write, not which cast to use.
        expect(err.message).toContain('as a JSON number or boolean');
        expect(err.message).not.toMatch(/CEL|int\(\)|double\(\)|bool\(\)/);
        expect(h.handler).toHaveBeenCalledTimes(0);
        expect(h.writes).toEqual([]);
    });

    it('the input judged is the one sent: a watermark that supplies the required parameter pulls', async () => {
        const h = harness({
            inputSchema: SINCE_REQUIRED,
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request', input: { path: '/contacts', query: { limit: 50 } },
                    watermark: { field: 'updated_at', param: 'since' },
                },
            }),
            stored: [{ synced_at: '2026-01-02T00:00:00.000Z' }],
        });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(h.handler.mock.calls[0][0]).toEqual({
            path: '/contacts', query: { limit: 50, since: '2026-01-02T00:00:00.000Z' },
        });
        expect(res.pulled).toBe(0);
    });

    it('a valid input still pulls and writes', async () => {
        const h = harness({
            inputSchema: SINCE_REQUIRED,
            mapping: baseMapping({
                connectorSource: {
                    connector: 'crm_api', action: 'request', input: { path: '/contacts', query: { since: '2026-01-01' } },
                },
            }),
            result: { status: 200, ok: true, body: [{ id: 'c1', name: 'Ada', updated_at: '2026-01-02' }] },
        });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.handler).toHaveBeenCalledTimes(1);
        expect(res.pulled).toBe(1);
        expect(h.writes).toHaveLength(1);
    });
});

describe('[#31810] connector pull — a record whose match key is blank is a row error, never a create', () => {
    /** The source dropped its `id` column for the changed record: `external_id` maps to nothing. */
    const noKey = { name: 'Grace Hopper', updated_at: '2026-01-03' };

    it('upsert: the keyless record is not created, and it is counted as an error naming the mapping and the key', async () => {
        const h = harness({ result: { status: 200, ok: true, body: [{ id: 'c1', name: 'Ada', updated_at: '2026-01-02' }, noKey] } });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        // Only the keyed record reached the protocol: no row with a blank external_id.
        expect(h.writes).toHaveLength(1);
        expect((h.writes[0] as { data: Record<string, unknown> }).data.external_id).toBe('c1');
        // `errors` is the tally the job's run outcome reads: above zero, the run is degraded, not success.
        expect({ created: res.summary.created, updated: res.summary.updated, skipped: res.summary.skipped, errors: res.summary.errors })
            .toEqual({ created: 1, updated: 0, skipped: 0, errors: 1 });
        const refused = res.summary.results.find((r) => r.row === 2);
        expect(refused).toMatchObject({ ok: false, action: 'failed', code: 'BLANK_MATCH_KEY' });
        expect(refused?.error).toContain('crm_contacts');
        expect(refused?.error).toContain('external_id');
    });

    it('update: the keyless record is counted as an error too, not a silent skip', async () => {
        const h = harness({
            mapping: baseMapping({ mode: 'update' }),
            result: { status: 200, ok: true, body: [noKey] },
        });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(h.writes).toHaveLength(0);
        expect({ skipped: res.summary.skipped, errors: res.summary.errors }).toEqual({ skipped: 0, errors: 1 });
        expect(res.summary.results[0]).toMatchObject({ ok: false, action: 'failed', code: 'BLANK_MATCH_KEY' });
    });

    it('CONTROL: a record that still carries its key upserts as before — the stored row is updated, nothing is refused', async () => {
        const h = harness({
            stored: [{ id: 'rec_1', external_id: 'c1', name: 'Ada', synced_at: '2026-01-01' }],
            result: { status: 200, ok: true, body: [{ id: 'c1', name: 'Ada Lovelace', updated_at: '2026-01-02' }] },
        });
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect({ created: res.summary.created, updated: res.summary.updated, skipped: res.summary.skipped, errors: res.summary.errors })
            .toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
        expect(h.writes).toHaveLength(1);
        expect(h.writes[0]).toMatchObject({ object: 'contact', id: 'rec_1' });
    });

    it('CONTROL: the import door itself is unchanged — runImport with skipBlankMatchKey false still creates the blank-key row', async () => {
        const h = harness();
        const summary = await runImport({
            p: h.deps.protocol,
            objectName: 'contact',
            rows: [{ name: 'Grace Hopper' }],
            metaMap: buildFieldMetaMap(contactObject),
            writeMode: 'upsert',
            matchFields: ['external_id'],
            dryRun: false,
            runAutomations: true,
            trimWhitespace: true,
            createMissingOptions: false,
            skipBlankMatchKey: false,
        });
        expect({ created: summary.created, errors: summary.errors }).toEqual({ created: 1, errors: 0 });
        expect(h.writes).toHaveLength(1);
    });
});

describe('a failed pull logs one warn line naming the mapping and the reason', () => {
    function recording(h: Harness): { warns: Array<{ message: string; meta?: Record<string, unknown> }> } {
        const warns: Array<{ message: string; meta?: Record<string, unknown> }> = [];
        h.deps.logger = { ...silent, warn: (message: string, meta?: Record<string, unknown>) => { warns.push({ message, meta }); } } as ConnectorPullDeps['logger'];
        return { warns };
    }

    it('a mapping naming a datasource, not a connector: one warn line, and the refusal still reaches the caller', async () => {
        const h = harness({ mapping: baseMapping({ connectorSource: { connector: 'legacy_db', action: 'request' } }) });
        const { warns } = recording(h);
        expectRefused(await refusal(h), { code: 'VALIDATION_ERROR', status: 400, reason: 'connector_not_registered' });
        expect(warns).toHaveLength(1);
        expect(warns[0].meta).toEqual({ mapping: 'crm_contacts', reason: 'connector_not_registered' });
        expect(warns[0].message).toContain('"crm_contacts"');
        expect(warns[0].message).toContain('connector_not_registered');
    });

    it('a throw that is not a typed refusal is logged too, and rethrown as it was', async () => {
        const h = harness();
        h.handler.mockRejectedValueOnce(new Error('socket hang up'));
        const { warns } = recording(h);
        const err = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' }).catch((e: unknown) => e);
        expect((err as Error).message).toBe('socket hang up');
        expect(warns.map((w) => w.meta)).toEqual([{ mapping: 'crm_contacts', reason: 'failed' }]);
    });

    it('CONTROL: a pull that succeeds logs no warn line', async () => {
        const h = harness({ result: { status: 200, ok: true, body: [{ id: 'c1', name: 'Ada' }] } });
        const { warns } = recording(h);
        const res = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(res.pulled).toBe(1);
        expect(warns).toEqual([]);
    });
});

/**
 * [#32071, ADR-0150 D3] `mapping` is addressed by `(package, name)`. A pull
 * whose request names no package (no `callerPackageId`) reads the mapping by
 * the protocol's by-name read as a caller with no package. Driven here over the
 * REAL read — `ObjectStackProtocolImplementation` over a real `SchemaRegistry`
 * — for the mapping, the harness for everything else.
 */
describe('[#32071] connector pull — a mapping name two packages hold is refused, never pulled through the first', () => {
    const ALPHA = 'com.acme.alpha';
    const BETA = 'com.acme.beta';

    function overRealMappingRead(holders: readonly string[]): Harness & { real: ObjectStackProtocolImplementation } {
        const h = harness();
        const registry = new SchemaRegistry({ multiTenant: false });
        for (const packageId of holders) {
            registry.installPackage(
                { id: packageId, name: packageId, version: '1.0.0', type: 'app', namespace: packageId.split('.').pop() } as never,
                'code',
            );
            registry.registerItem('mapping', baseMapping({ label: packageId }) as never, 'name' as never, packageId);
        }
        // The engine as the protocol reads it: the registry, and an empty
        // stored-metadata store (no environment row of the name).
        const engine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        const real = new ObjectStackProtocolImplementation(engine as never);
        const fake = h.deps.protocol;
        h.deps.protocol = {
            ...fake,
            getMetaItem: (request) => (request.type === 'mapping' ? real.getMetaItem(request) : fake.getMetaItem(request)),
        };
        return { ...h, real };
    }

    it('two holders: refused with the read\'s own 409, naming both; no action call, nothing written', async () => {
        const h = overRealMappingRead([ALPHA, BETA]);
        const err = await refusal(h);
        const read = await h.real.getMetaItem({ type: 'mapping', name: 'crm_contacts' }).catch((e: unknown) => e);
        expect(read).toBeInstanceOf(PackageScopedNameRefusedError);
        const refused = read as PackageScopedNameRefusedError;
        expect(err.reason).toBe('mapping_name_refused');
        expect({ code: err.code, status: err.status }).toEqual({ code: refused.code, status: 409 });
        expect(err.message).toContain(ALPHA);
        expect(err.message).toContain(BETA);
        expect(h.handler).not.toHaveBeenCalled();
        expect(h.writes).toHaveLength(0);
    });

    it('a refusal recognised by shape (a plain object, no class): refused with its own code and status, naming both', async () => {
        const h = harness();
        const message = `The mapping 'crm_contacts' is held by ${ALPHA} and ${BETA}. Nothing picks one of them: address it by its package.`;
        const fake = h.deps.protocol;
        h.deps.protocol = {
            ...fake,
            getMetaItem: (request) => (request.type === 'mapping'
                ? Promise.reject({ code: 'RESOURCE_CONFLICT', status: 409, message, refusal: { status: 'refused', message } })
                : fake.getMetaItem(request)),
        };
        const err = await refusal(h);
        expect(err.reason).toBe('mapping_name_refused');
        expect({ code: err.code, status: err.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(err.message).toContain(ALPHA);
        expect(err.message).toContain(BETA);
        expect(h.handler).not.toHaveBeenCalled();
        expect(h.writes).toHaveLength(0);
    });

    it('CONTROL: one package holder is pulled exactly as before', async () => {
        const h = overRealMappingRead([ALPHA]);
        const result = await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(result.targetObject).toBe('contact');
        expect(h.handler).toHaveBeenCalledTimes(1);
    });
});

/**
 * [#32071 Part B, ADR-0150 D3] A pull naming the package that declares its job
 * (`callerPackageId`) reads the mapping from that package through the injected
 * registry resolver (`mappingNameResolver`): its own mapping, else the one
 * holder in its declared closure plus `sys`, else a refusal. A pull naming no
 * package keeps the protocol's read (Part A). Each holder's mapping pulls a
 * path of its own, so which mapping a pull read is the path the action got.
 */
describe('[#32071] connector pull — a package caller reads the mapping from its own package', () => {
    const ALPHA = 'com.acme.alpha';
    const BETA = 'com.acme.beta';
    const CALLER = 'com.acme.caller';

    function overRegistry(setup: (r: SchemaRegistry) => void): Harness & { registry: SchemaRegistry } {
        const h = harness();
        const registry = new SchemaRegistry({ multiTenant: false });
        setup(registry);
        h.deps.mappingByPackage = mappingNameResolver({ getService: <T>() => ({ registry }) as T });
        const engine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        const real = new ObjectStackProtocolImplementation(engine as never);
        const fake = h.deps.protocol;
        h.deps.protocol = {
            ...fake,
            getMetaItem: (request) => (request.type === 'mapping' ? real.getMetaItem(request) : fake.getMetaItem(request)),
        };
        return { ...h, registry };
    }
    const install = (r: SchemaRegistry, id: string, deps: string[] = []) => r.installPackage(
        {
            id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(),
            ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
        } as never,
        'code',
    );
    const mappingOf = (tag: string) => baseMapping({
        label: tag,
        connectorSource: { connector: 'crm_api', action: 'request', input: { method: 'GET', path: `/${tag}` } },
    });
    const ship = (r: SchemaRegistry, packageId: string) =>
        r.registerItem('mapping', mappingOf(packageId.split('.').pop()!) as never, 'name' as never, packageId);
    const pathPulled = (h: Harness) => JSON.stringify(h.handler.mock.calls[0] ?? []).match(/"path":"\/(\w+)"/)?.[1];

    it('two holders, the caller one of them: the caller\'s own mapping is pulled (no-package: 409)', async () => {
        const h = overRegistry((r) => { install(r, ALPHA); install(r, BETA); ship(r, ALPHA); ship(r, BETA); });
        const noPackage = await refusal(h);
        expect(noPackage.reason).toBe('mapping_name_refused');
        h.handler.mockClear();
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: BETA });
        expect(pathPulled(h)).toBe('beta');
        h.handler.mockClear();
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: ALPHA });
        expect(pathPulled(h)).toBe('alpha');
    });

    it('CONTROL: a runtime row over the package\'s mapping is its overlay (ADR-0005), served to both callers alike', async () => {
        // A package-less row of a name a package ships is no second holder:
        // the registry files it as that package's overlay, so the package
        // caller's own item IS the row, as the no-package read's is.
        const h = overRegistry((r) => {
            install(r, ALPHA);
            ship(r, ALPHA);
            r.registerItem('mapping', { ...mappingOf('env'), _provenance: 'org' } as never, 'name' as never);
        });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(pathPulled(h)).toBe('env');
        h.handler.mockClear();
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: ALPHA });
        expect(pathPulled(h)).toBe('env');
    });

    it('D3 (c): the only holder is outside the caller\'s closure — refused naming it, before any call or write', async () => {
        const h = overRegistry((r) => { install(r, BETA); install(r, CALLER); ship(r, BETA); });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(pathPulled(h), 'no-package: the one holder is pulled').toBe('beta');
        h.handler.mockClear();
        const writesBefore = h.writes.length;
        const err = await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: CALLER }).then(
            () => undefined,
            (e: unknown) => e as ConnectorPullError,
        );
        expect(err).toBeInstanceOf(ConnectorPullError);
        const refused = err as ConnectorPullError;
        expect(refused.reason).toBe('mapping_name_refused');
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(refused.message).toContain(BETA);
        expect(h.handler).not.toHaveBeenCalled();
        expect(h.writes).toHaveLength(writesBefore);
    });

    it('D3 (a): a package caller whose name only the environment holds is refused naming the environment (no binder reaches it)', async () => {
        const h = overRegistry((r) => {
            install(r, CALLER);
            r.registerItem('mapping', { ...mappingOf('env'), _provenance: 'org' } as never, 'name' as never);
        });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
        expect(pathPulled(h), 'no-package: the environment\'s own').toBe('env');
        h.handler.mockClear();
        const err = await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: CALLER }).then(
            () => undefined,
            (e: unknown) => e as ConnectorPullError,
        );
        expect(err).toBeInstanceOf(ConnectorPullError);
        expect((err as ConnectorPullError).reason).toBe('mapping_name_refused');
        expect((err as ConnectorPullError).status).toBe(409);
        expect(h.handler).not.toHaveBeenCalled();
    });

    it('the one holder in the caller\'s declared closure is pulled', async () => {
        const h = overRegistry((r) => { install(r, ALPHA); install(r, BETA); install(r, CALLER, [ALPHA]); ship(r, ALPHA); ship(r, BETA); });
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: CALLER });
        expect(pathPulled(h)).toBe('alpha');
    });

    const pullError = (h: Harness, callerPackageId?: string) =>
        pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId }).then(
            () => undefined,
            (e: unknown) => e as ConnectorPullError,
        );
    const answerOf = (err: ConnectorPullError | undefined) =>
        err === undefined ? 'pulled' : `${err.status} ${err.reason}`;

    it('a disabled package\'s own mapping answers mapping_not_found for its caller, as the no-package read does', async () => {
        const h = overRegistry((r) => { install(r, CALLER); ship(r, CALLER); r.disablePackage(CALLER); });
        expect(answerOf(await pullError(h)), 'no-package (main)').toBe('404 mapping_not_found');
        expect(answerOf(await pullError(h, CALLER))).toBe('404 mapping_not_found');
        expect(h.handler).not.toHaveBeenCalled();
    });

    it('a disabled package\'s own mapping beside an enabled holder: its caller reads its own, withheld — 404 (no package: the enabled holder\'s, #32183)', async () => {
        // The one refusal that becomes a miss (declared in the changeset):
        // the caller's own item is step 1, then withheld as disabled.
        const h = overRegistry((r) => { install(r, ALPHA); install(r, CALLER); ship(r, ALPHA); ship(r, CALLER); r.disablePackage(CALLER); });
        expect(answerOf(await pullError(h, CALLER))).toBe('404 mapping_not_found');
        expect(h.handler).not.toHaveBeenCalled();
        // [#32183] A disabled package holds no name, so the read naming no
        // package has one holder: alpha's mapping (BASE f0f729e7: 409 naming both).
        expect(answerOf(await pullError(h)), 'no-package').toBe('pulled');
        expect(pathPulled(h)).toBe('alpha');
    });

    it('a disabled closure holder\'s mapping answers mapping_not_found, as the no-package read does', async () => {
        const h = overRegistry((r) => { install(r, ALPHA); install(r, CALLER, [ALPHA]); ship(r, ALPHA); r.disablePackage(ALPHA); });
        expect(answerOf(await pullError(h)), 'no-package (main)').toBe('404 mapping_not_found');
        expect(answerOf(await pullError(h, CALLER))).toBe('404 mapping_not_found');
        expect(h.handler).not.toHaveBeenCalled();
        // Re-enabled, the same caller pulls it: the withholding is the disable, nothing else.
        h.registry.enablePackage(ALPHA);
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: CALLER });
        expect(pathPulled(h)).toBe('alpha');
    });

    it('a disabled sole holder outside the closure answers mapping_not_found, not a refusal naming it', async () => {
        const h = overRegistry((r) => { install(r, BETA); install(r, CALLER); ship(r, BETA); r.disablePackage(BETA); });
        expect(answerOf(await pullError(h)), 'no-package (main)').toBe('404 mapping_not_found');
        expect(answerOf(await pullError(h, CALLER))).toBe('404 mapping_not_found');
    });

    it('[#32183] a disabled holder beside an enabled one in the closure holds no name: the enabled holder\'s mapping is pulled; re-enabled, refused naming both', async () => {
        // BASE (main f0f729e7): the disabled holder still counted, so both the
        // package caller and the read naming no package were refused 409
        // naming both. The served holder set (`packageScopedHoldersOf`) now
        // leaves it out, for this resolver as for every D3 door.
        const h = overRegistry((r) => {
            install(r, ALPHA); install(r, BETA); install(r, CALLER, [ALPHA, BETA]);
            ship(r, ALPHA); ship(r, BETA); r.disablePackage(ALPHA);
        });
        expect(answerOf(await pullError(h, CALLER))).toBe('pulled');
        expect(pathPulled(h)).toBe('beta');
        h.handler.mockClear();
        expect(answerOf(await pullError(h)), 'no-package').toBe('pulled');
        expect(pathPulled(h)).toBe('beta');
        h.handler.mockClear();
        h.registry.enablePackage(ALPHA);
        const err = await pullError(h, CALLER);
        expect(answerOf(err)).toBe('409 mapping_name_refused');
        expect(err?.message).toContain(ALPHA);
        expect(err?.message).toContain(BETA);
        expect(answerOf(await pullError(h)), 'no-package').toBe('409 mapping_name_refused');
        expect(h.handler).not.toHaveBeenCalled();
    });

    describe('a multi-package artifact\'s residual owner (ADR-0130 D4: no package row)', () => {
        // The residual rule files a stack's unclaimed top-level items under the
        // top-level id, which is no package (`recordResidualOwner`); a body is
        // a package. The binder sends no package for a residual job.
        const TOP = 'com.acme.top';

        it('a residual job (no package) pulls the mapping a body declares, as on main', async () => {
            const h = overRegistry((r) => { install(r, BETA); ship(r, BETA); });
            await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
            expect(pathPulled(h)).toBe('beta');
        });

        it('a residual job (no package) pulls a mapping filed under the residual owner, as on main', async () => {
            const h = overRegistry((r) => { install(r, BETA); ship(r, TOP); });
            await pullConnectorSource(h.deps, { mapping: 'crm_contacts' });
            expect(pathPulled(h)).toBe('top');
        });

        it('MIRROR: a body\'s job pulling a mapping filed under the residual owner is refused outside-closure (no package: pulled)', async () => {
            const h = overRegistry((r) => { install(r, BETA); ship(r, TOP); });
            const err = await pullError(h, BETA);
            expect(answerOf(err)).toBe('409 mapping_name_refused');
            expect(err?.message).toContain(TOP);
            expect(h.handler).not.toHaveBeenCalled();
        });
    });

    it('CONTROL: an absent, null or empty caller package reads by no package; no registry to ask reads by no package', async () => {
        for (const callerPackageId of [undefined, null, '']) {
            const h = overRegistry((r) => { install(r, ALPHA); ship(r, ALPHA); });
            await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId });
            expect(pathPulled(h), String(callerPackageId)).toBe('alpha');
        }
        const h = overRegistry((r) => { install(r, BETA); install(r, CALLER); ship(r, BETA); });
        h.deps.mappingByPackage = () => undefined;
        await pullConnectorSource(h.deps, { mapping: 'crm_contacts', callerPackageId: CALLER });
        expect(pathPulled(h), 'no registry: the protocol read, as before').toBe('beta');
    });
});
