// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20761, ADR-0126 §2, ADR-0131 D6] `tenantAuthoredWriteRefusal` — the ONE
 * authoring rule every flow write door asks (the automation create, update and
 * clone doors, and `/meta`), and `packagedArtifactOwner` — the loader's-set read
 * it, the locked-base verdict and the automation engine's classification share.
 *
 * The matrix (the ruling recorded on the card, points 2 and 5):
 *  - a name the loader's set holds is a locked base — `packagedBaseRefusal`'s
 *    own answer, reused (so a shipped flow's round trip is refused);
 *  - any other name, with stamps that would classify the body as code-shipped,
 *    is refused `INVALID_METADATA` / 422 — unless the stamps agree with the
 *    server's fact: the package a stored row of that name is bound to, or the
 *    base the write itself names;
 *  - everything else is admitted, and every type but `flow` is untouched.
 *
 * The registry double serves only `getArtifactItem` — what the real
 * `SchemaRegistry` returns for an artifact a code package registered. The
 * engine double serves only `findOne` over `sys_metadata` rows (and records
 * `insert`, which a refused save must never reach). `@objectstack/objectql`
 * cannot be imported here: it depends on this package.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

const PACKAGE_ID = 'com.example.pkg';

const flowBody = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
});

/** What the loader registered: one packaged flow and one packaged view. */
const ARTIFACTS = new Map<string, Map<string, unknown>>([
    ['flow', new Map([['pkg_flow', flowBody('pkg_flow', { _packageId: PACKAGE_ID, _provenance: 'package' })]])],
    ['view', new Map([['pkg_view', { name: 'pkg_view', _packageId: PACKAGE_ID, _provenance: 'package' }]])],
]);

/** The stamps a caller would send to claim the real package's provenance. */
const ASSERTED = { _packageId: PACKAGE_ID, _provenance: 'package' };

interface StoredRow { type: string; name: string; package_id: string | null }

function protocolWith(opts: { rows?: StoredRow[]; findOne?: () => Promise<unknown>; environmentId?: string } = {}) {
    const rows = opts.rows ?? [];
    const insert = vi.fn(async () => ({ id: 'never' }));
    const engine = {
        registry: { getArtifactItem: (type: string, name: string) => ARTIFACTS.get(type)?.get(name) },
        findOne: opts.findOne ?? (async (table: string, query: { where: Record<string, unknown> }) => {
            assertEngineFindOnePredicate(table, query);
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => Object.entries(query.where).every(([k, v]) => (r as any)[k] === v)) ?? null;
        }),
        insert,
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), opts.environmentId);
    return { protocol, insert };
}

const shape = (e: any) => (e ? { code: e.code, status: e.status } : null);

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('packagedArtifactOwner — the loader\'s set, read', () => {
    it('names the package that ships a flow, and nothing for a name no package ships', () => {
        const { protocol } = protocolWith();
        expect(protocol.packagedArtifactOwner({ type: 'flow', name: 'pkg_flow' })).toBe(PACKAGE_ID);
        expect(protocol.packagedArtifactOwner({ type: 'flows', name: 'pkg_flow' })).toBe(PACKAGE_ID);
        expect(protocol.packagedArtifactOwner({ type: 'flow', name: 'customer_flow' })).toBeUndefined();
    });
});

describe('tenantAuthoredWriteRefusal — every flow written through an authoring door is tenant-authored', () => {
    it('a name the loader\'s set holds is a locked base: the round trip of a shipped flow is refused with the lock\'s own answer', async () => {
        for (const environmentId of [undefined, 'env_1']) {
            const { protocol } = protocolWith({ environmentId });
            const served = ARTIFACTS.get('flow')!.get('pkg_flow');

            const refusal: any = await protocol.tenantAuthoredWriteRefusal({ type: 'flow', name: 'pkg_flow', item: served });
            const lock: any = protocol.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' });

            expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(refusal.message).toBe(lock.message);
        }
    });

    it('with the operator hatch open the lock admits the write, and the body\'s stamps decide nothing', async () => {
        process.env.OS_METADATA_WRITABLE = 'flow';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const { protocol } = protocolWith();
        expect(await protocol.tenantAuthoredWriteRefusal({ type: 'flow', name: 'pkg_flow', item: flowBody('pkg_flow', ASSERTED) })).toBeNull();
    });

    it('a body claiming a package\'s provenance for a name no package ships is refused INVALID_METADATA / 422', async () => {
        const { protocol } = protocolWith();
        const refusal: any = await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', ASSERTED),
        });
        expect(shape(refusal)).toEqual({ code: 'INVALID_METADATA', status: 422 });
        // A stamp with no provenance key beside it still classifies as code-shipped.
        expect(shape(await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', { _packageId: 'app.anything' }),
        }))).toEqual({ code: 'INVALID_METADATA', status: 422 });
    });

    it('folds the type at the producer — a plural spelling cannot address around the rule', async () => {
        const { protocol } = protocolWith();
        expect(shape(await protocol.tenantAuthoredWriteRefusal({
            type: 'flows', name: 'customer_flow', item: flowBody('customer_flow', ASSERTED),
        }))).toEqual({ code: 'INVALID_METADATA', status: 422 });
    });

    it('a tenant row\'s own stamps are a no-op: tenant provenance, the stored-row sentinel, and no stamps at all', async () => {
        const { protocol } = protocolWith();
        for (const stamps of [{ _packageId: 'app.crm', _provenance: 'org' }, { _packageId: 'sys_metadata' }, {}]) {
            expect(await protocol.tenantAuthoredWriteRefusal({
                type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', stamps),
            })).toBeNull();
        }
    });

    it('a package stamp that echoes the binding of the stored row of that name agrees with the server, and is a no-op', async () => {
        const { protocol } = protocolWith({ rows: [{ type: 'flow', name: 'bound_flow', package_id: 'com.tenant.base' }] });
        expect(await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'bound_flow', item: flowBody('bound_flow', { _packageId: 'com.tenant.base' }),
        })).toBeNull();
        // …and one that names ANOTHER package disagrees with it.
        expect(shape(await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'bound_flow', item: flowBody('bound_flow', ASSERTED),
        }))).toEqual({ code: 'INVALID_METADATA', status: 422 });
    });

    it('a package stamp naming the base the write itself names agrees with that write', async () => {
        const { protocol } = protocolWith();
        expect(await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'new_flow', item: flowBody('new_flow', { _packageId: 'com.tenant.base' }), packageId: 'com.tenant.base',
        })).toBeNull();
        expect(shape(await protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'new_flow', item: flowBody('new_flow', ASSERTED), packageId: 'com.tenant.base',
        }))).toEqual({ code: 'INVALID_METADATA', status: 422 });
    });

    it('a store that cannot be read is re-raised, never turned into a verdict; an unprovisioned one holds no row', async () => {
        const down = protocolWith({ findOne: async () => { throw new Error('connect ECONNREFUSED'); } });
        await expect(down.protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', ASSERTED),
        })).rejects.toMatchObject({ status: 503 });

        const missing = protocolWith({ findOne: async () => { throw new Error('no such table: sys_metadata'); } });
        expect(shape(await missing.protocol.tenantAuthoredWriteRefusal({
            type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', ASSERTED),
        }))).toEqual({ code: 'INVALID_METADATA', status: 422 });
    });

    it('every other metadata type is untouched — the same stamps on a view are not this rule\'s to judge', async () => {
        const { protocol } = protocolWith();
        expect(await protocol.tenantAuthoredWriteRefusal({ type: 'view', name: 'customer_view', item: { name: 'customer_view', ...ASSERTED } })).toBeNull();
        expect(await protocol.tenantAuthoredWriteRefusal({ type: 'view', name: 'pkg_view', item: { name: 'pkg_view', ...ASSERTED } })).toBeNull();
    });
});

describe('saveMetaItem applies the rule to a flow, before anything is written', () => {
    it('refuses the assertion with the rule\'s own envelope and writes nothing', async () => {
        for (const environmentId of [undefined, 'env_1']) {
            const { protocol, insert } = protocolWith({ environmentId });
            const thrown: any = await protocol.saveMetaItem({
                type: 'flow', name: 'customer_flow', item: flowBody('customer_flow', ASSERTED),
            }).then(() => undefined, (e) => e);

            expect(shape(thrown)).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(insert).not.toHaveBeenCalled();
        }
    });

    it('asks the rule on an authoring save, and not on the two server-stated rewrites of stored rows', async () => {
        const ask = (request: Record<string, unknown>) => {
            const { protocol } = protocolWith();
            const spy = vi.spyOn(protocol, 'tenantAuthoredWriteRefusal');
            return protocol.saveMetaItem({ type: 'flow', name: 'customer_flow', item: flowBody('customer_flow'), ...request } as never)
                .then(() => spy.mock.calls.length, () => spy.mock.calls.length);
        };
        expect(await ask({})).toBe(1);
        expect(await ask({ writeFace: 'meta-envelope' })).toBe(1);
        expect(await ask({ source: 'migrate-stored' })).toBe(0);
        expect(await ask({ writeFace: 'package-duplicate' })).toBe(0);
    });
});
