// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20679, ADR-0126 §2] `packagedBaseRefusal` — the `/meta` door's
 * locked-base verdict, as a value, for a second door onto the same artifact.
 *
 * It is not a new rule. It hands out the SAME verdict `saveMetaItem` and
 * `deleteMetaItem` reach — the package doors both now call, lifted out of them
 * unchanged, `refusePackagedBaseOverride` / `refusePackagedBaseRemoval` — so this file
 * pins two things and only two:
 *
 *  1. it answers exactly what those two methods throw for the same item (the
 *     ONE-emitter claim: same code, status and sentence);
 *  2. its matrix is the metadata door's matrix, including the answers that are
 *     deliberately `null` — a name no package ships, a Regime O overlay type,
 *     the #6960 delete carve-out, and the operator hatch.
 *
 * The registry double serves only `getArtifactItem`, which is all the verdict
 * reads; what it returns is what the real `SchemaRegistry` returns for an
 * artifact a code package registered (`_packageId` stamped, package
 * provenance). `@objectstack/objectql` cannot be imported here: it depends on
 * this package.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

const PACKAGE_ID = 'com.example.pkg';

const shipped = (name: string, extra: Record<string, unknown> = {}) =>
    ({ name, label: name, _packageId: PACKAGE_ID, _provenance: 'package', ...extra });

/** Packaged artifacts of three regimes: behavioral (`flow`), overlay (`view`), rolled-back overlay (`page`). */
const ARTIFACTS = new Map<string, Map<string, unknown>>([
    ['flow', new Map([['pkg_flow', shipped('pkg_flow', { type: 'autolaunched', nodes: [], edges: [] })]])],
    ['view', new Map([['pkg_view', shipped('pkg_view')]])],
    ['page', new Map([['pkg_page', shipped('pkg_page')]])],
]);

function protocolOn(environmentId: string | undefined): ObjectStackProtocolImplementation {
    const registry = { getArtifactItem: (type: string, name: string) => ARTIFACTS.get(type)?.get(name) };
    return new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), environmentId);
}

const shape = (e: any) => (e ? { code: e.code, status: e.status } : null);

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('packagedBaseRefusal — the /meta door\'s locked-base verdict, handed to a second door', () => {
    for (const environmentId of [undefined, 'env_1']) {
        it(`refuses a packaged flow's save AND removal on ${environmentId ? 'an environment' : 'a host-config'} kernel`, () => {
            const p = protocolOn(environmentId);
            expect(shape(p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' })))
                .toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(shape(p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' })))
                .toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        });
    }

    it('ONE emitter: the value equals what saveMetaItem / deleteMetaItem throw for the same item', async () => {
        const p = protocolOn('env_1');
        const thrownBy = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);

        const save = await thrownBy(p.saveMetaItem({ type: 'flow', name: 'pkg_flow', item: { name: 'pkg_flow', label: 'x' } }));
        const saveVerdict: any = p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' });
        expect({ ...shape(save), message: save?.message }).toEqual({ ...shape(saveVerdict), message: saveVerdict?.message });

        const del = await thrownBy(p.deleteMetaItem({ type: 'flow', name: 'pkg_flow' }));
        const delVerdict: any = p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' });
        expect({ ...shape(del), message: del?.message }).toEqual({ ...shape(delVerdict), message: delVerdict?.message });
    });

    it('folds the type at the producer — a plural spelling cannot address around the lock', () => {
        const p = protocolOn(undefined);
        expect(shape(p.packagedBaseRefusal({ type: 'flows', name: 'pkg_flow', operation: 'save' })))
            .toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
    });

    it('a name no code package ships is not locked — creation is not this verdict\'s question', () => {
        const p = protocolOn(undefined);
        expect(p.packagedBaseRefusal({ type: 'flow', name: 'customer_flow', operation: 'save' })).toBeNull();
        expect(p.packagedBaseRefusal({ type: 'flow', name: 'customer_flow', operation: 'delete' })).toBeNull();
    });

    it('a Regime O overlay type (allowOrgOverride) is never refused on this ground', () => {
        const p = protocolOn(undefined);
        expect(p.packagedBaseRefusal({ type: 'view', name: 'pkg_view', operation: 'save' })).toBeNull();
        expect(p.packagedBaseRefusal({ type: 'view', name: 'pkg_view', operation: 'delete' })).toBeNull();
    });

    it('mirrors the #6960 carve-out: a rolled-back overlay type refuses the write but not the removal', () => {
        const p = protocolOn(undefined);
        expect(shape(p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' })))
            .toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'delete' })).toBeNull();
    });

    it('a lookup that FAILS is re-raised, never handed out as a verdict', () => {
        // The lifted helpers throw, as the inline code did; only the refusal is
        // turned into a value. A registry that cannot answer must not become a
        // well-formed "refused" (or "allowed") — it stays the fault it is.
        const registry = { getArtifactItem: () => { throw new Error('registry unreadable'); } };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), undefined);
        expect(() => p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' }))
            .toThrow('registry unreadable');
        expect(() => p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' }))
            .toThrow('registry unreadable');
    });

    it('reads the operator hatch through the same predicate the metadata door reads', () => {
        process.env.OS_METADATA_WRITABLE = 'flow';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        const p = protocolOn(undefined);
        expect(p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' })).toBeNull();
        expect(p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' })).toBeNull();
    });
});
