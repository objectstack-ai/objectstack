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

/**
 * Packaged artifacts of three regimes: behavioral (`flow`), overlay (`view`), rolled-back overlay (`page`) —
 * plus `action`, which ADR-0126 §3 also puts in Regime C but whose sanctioned paths are not the flow's.
 */
const ARTIFACTS = new Map<string, Map<string, unknown>>([
    ['flow', new Map([['pkg_flow', shipped('pkg_flow', { type: 'autolaunched', nodes: [], edges: [] })]])],
    ['view', new Map([['pkg_view', shipped('pkg_view')]])],
    ['page', new Map([['pkg_page', shipped('pkg_page')]])],
    ['action', new Map([['pkg_action', shipped('pkg_action')]])],
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

/**
 * [#20819, ADR-0126 §2] The refusal's SENTENCE is chosen per regime, from one
 * table keyed on the type's declared regime. The code, the status and which
 * writes are refused are the matrix above, unchanged.
 *
 * A Regime C type (`flow`) names Regime C's sanctioned paths — the clone under
 * a new name (§7.1) and the enable/disable switch (§7.2) — cites ADR-0126, and
 * names neither the `OS_METADATA_WRITABLE` hatch nor a redeploy an installed
 * package's administrator cannot make. Every other type's sentence is
 * byte-identical to what it was (the controls): `page` has no regime, and
 * `action` is Regime C on paper but its sanctioned paths are not the flow's
 * routes, so it keeps its sentence until its own paths are declared.
 */
describe('packagedBaseRefusal — the sentence is chosen per ADR-0126 regime', () => {
    const CLONE = 'POST /api/v1/automation/:name/clone';
    const TOGGLE = 'POST /api/v1/automation/:name/toggle';
    const ADR_0126 = 'docs/adr/0126-packaged-metadata-customization-model.md';

    /** The package-less sentence every regime-less type keeps (`refusePackagedBaseOverride`). */
    const LEGACY_SAVE = (type: string, name: string) =>
        `Metadata item '${type}/${name}' is provided by a code package `
        + 'and the type has not opted into per-org overlay writes (allowOrgOverride=false). '
        + 'Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch. '
        + 'See docs/adr/0005-metadata-customization-overlay.md.';
    /** …and its removal twin (`refusePackagedBaseRemoval`). */
    const LEGACY_DELETE = (type: string, name: string) =>
        `Metadata item '${type}/${name}' is provided by a code package `
        + 'and the type has not opted into per-org overlay writes. '
        + 'See docs/adr/0005-metadata-customization-overlay.md.';

    for (const environmentId of [undefined, 'env_1']) {
        for (const operation of ['save', 'delete'] as const) {
            it(`a packaged flow's ${operation} refusal names clone and the switch, cites ADR-0126, and names no hatch `
                + `(${environmentId ? 'environment' : 'host-config'} kernel)`, () => {
                const refusal: any = protocolOn(environmentId)
                    .packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation });
                expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                const message = String(refusal.message);
                expect(message.startsWith("Metadata item 'flow/pkg_flow' is provided by a code package")).toBe(true);
                expect(message).toContain(CLONE);
                expect(message).toContain(TOGGLE);
                expect(message).toContain(ADR_0126);
                expect(message).not.toContain('OS_METADATA_WRITABLE');
                expect(message).not.toContain('redeploy');
                expect(message).not.toContain('0005-metadata-customization-overlay');
                // The REST door truncates a client message at 500 characters;
                // the whole sentence, ADR citation included, must arrive.
                expect(message.length).toBeLessThan(500);
            });
        }
    }

    it('the regime is read on the canonical type — a plural spelling gets the same sentence', () => {
        const p = protocolOn(undefined);
        const plural: any = p.packagedBaseRefusal({ type: 'flows', name: 'pkg_flow', operation: 'save' });
        const singular: any = p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' });
        expect(plural.message).toBe(singular.message);
    });

    it('the /meta doors throw the same regime sentence the value carries (one emitter)', async () => {
        const p = protocolOn('env_1');
        const thrownBy = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);
        const save: any = await thrownBy(p.saveMetaItem({ type: 'flow', name: 'pkg_flow', item: { name: 'pkg_flow', label: 'x' } }));
        const del: any = await thrownBy(p.deleteMetaItem({ type: 'flow', name: 'pkg_flow' }));
        expect(save?.message).toContain(CLONE);
        expect(del?.message).toContain(TOGGLE);
    });

    it('control: a type with no declared regime (`page`) keeps its sentence byte for byte', () => {
        const p = protocolOn('env_1');
        const refusal: any = p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' });
        expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(refusal.message).toBe(LEGACY_SAVE('page', 'pkg_page'));
    });

    it('control: `action` — Regime C on paper, with sanctioned paths that are not the flow\'s — keeps both sentences byte for byte', () => {
        const p = protocolOn('env_1');
        const save: any = p.packagedBaseRefusal({ type: 'action', name: 'pkg_action', operation: 'save' });
        const del: any = p.packagedBaseRefusal({ type: 'action', name: 'pkg_action', operation: 'delete' });
        expect(shape(save)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(shape(del)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(save.message).toBe(LEGACY_SAVE('action', 'pkg_action'));
        expect(del.message).toBe(LEGACY_DELETE('action', 'pkg_action'));
    });
});
