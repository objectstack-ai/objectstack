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
 *     and the #6960 delete carve-out. [ADR-0131 D6] The operator hatch is no
 *     longer one of them: managed content is sealed, so the verdict on an item
 *     a managed package ships is the same with `OS_METADATA_WRITABLE` set or
 *     not. [#22411] The legacy spelling `OBJECTSTACK_METADATA_WRITABLE`, which
 *     11.0 removed, is not read at all: the hatch is shut under it.
 *
 * The registry double serves `getArtifactItem`, which is all the verdict
 * reads, and `getRegisteredTypes`, which the type listing reads to show the
 * hatch shut under the removed spelling; what `getArtifactItem` returns is what the real `SchemaRegistry` returns for an
 * artifact a code package registered (`_packageId` stamped, package
 * provenance). `@objectstack/objectql` cannot be imported here: it depends on
 * this package.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

const PACKAGE_ID = 'com.example.pkg';

const shipped = (name: string, extra: Record<string, unknown> = {}) =>
    ({ name, label: name, _packageId: PACKAGE_ID, _provenance: 'package', ...extra });

/**
 * Packaged artifacts of three regimes: behavioral (`flow`), overlay (`view`), rolled-back overlay (`page`) —
 * plus `action` and `permission`, which ADR-0126 §3 also puts in Regime C, each with its own sanctioned path.
 */
const ARTIFACTS = new Map<string, Map<string, unknown>>([
    ['flow', new Map([['pkg_flow', shipped('pkg_flow', { type: 'autolaunched', nodes: [], edges: [] })]])],
    ['view', new Map([['pkg_view', shipped('pkg_view')]])],
    ['page', new Map([['pkg_page', shipped('pkg_page')]])],
    ['action', new Map([['pkg_action', shipped('pkg_action')]])],
    ['permission', new Map([['pkg_perm', shipped('pkg_perm')]])],
]);

function protocolOn(environmentId: string | undefined): ObjectStackProtocolImplementation {
    const registry = {
        getArtifactItem: (type: string, name: string) => ARTIFACTS.get(type)?.get(name),
        getRegisteredTypes: () => Array.from(ARTIFACTS.keys()),
    };
    return new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), environmentId);
}

const shape = (e: any) => (e ? { code: e.code, status: e.status } : null);

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    delete process.env.OBJECTSTACK_METADATA_WRITABLE;
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

    it('a Regime O overlay type (allowEnvironmentOverlay) is never refused on this ground', () => {
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

    // [ADR-0131 D6] Managed content is sealed: the hatch opens neither verb on
    // an item a managed package ships — the verdict is the one it gives with
    // the hatch shut, sentence included. Every door that asks this verdict (the
    // `/automation` doors, the read envelope) inherits that.
    for (const environmentId of [undefined, 'env_1']) {
        it(`OS_METADATA_WRITABLE=flow,page does not open a managed item (${environmentId ? 'environment' : 'host-config'} kernel)`, () => {
            const shut = protocolOn(environmentId);
            const sealed = {
                save: shut.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' }) as any,
                delete: shut.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' }) as any,
                page: shut.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' }) as any,
            };
            process.env.OS_METADATA_WRITABLE = 'flow,page';
            ObjectStackProtocolImplementation.resetEnvWritableCache();
            const p = protocolOn(environmentId);
            const open = {
                save: p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' }) as any,
                delete: p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' }) as any,
                page: p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' }) as any,
            };
            for (const verb of ['save', 'delete', 'page'] as const) {
                expect(shape(open[verb]), verb).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                expect(open[verb].message, verb).toBe(sealed[verb].message);
            }
            // The #6960 carve-out and the regime-O overlay keep their `null`.
            expect(p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'delete' })).toBeNull();
            expect(p.packagedBaseRefusal({ type: 'view', name: 'pkg_view', operation: 'save' })).toBeNull();
        });
    }

    // [#22411] The legacy spelling `OBJECTSTACK_METADATA_WRITABLE` was removed in
    // 11.0, and the protocol now reads the setting through the repository's one
    // reader, which reads the preferred spelling only. Under the legacy
    // spelling alone the hatch is SHUT: the type listing reports no env
    // override, and every verdict is the one the shut hatch gives. Control: the
    // preferred spelling still opens the listing.
    for (const environmentId of [undefined, 'env_1']) {
        it(`OBJECTSTACK_METADATA_WRITABLE=flow,page is not read — the hatch is shut (${environmentId ? 'environment' : 'host-config'} kernel)`, async () => {
            const shut = protocolOn(environmentId);
            const sealed = {
                save: shut.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' }) as any,
                delete: shut.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'delete' }) as any,
                page: shut.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' }) as any,
            };
            const hatchOf = async (p: ObjectStackProtocolImplementation) => {
                const { entries } = await (p as any).getMetaTypes();
                return Object.fromEntries(['flow', 'page'].map((t) => {
                    const e = entries.find((x: any) => x.type === t);
                    return [t, { allowEnvironmentOverlay: e?.allowEnvironmentOverlay, overrideSource: e?.overrideSource }];
                }));
            };
            const SHUT = { allowEnvironmentOverlay: false, overrideSource: 'registry' };
            expect(await hatchOf(shut)).toEqual({ flow: SHUT, page: SHUT });

            process.env.OBJECTSTACK_METADATA_WRITABLE = 'flow,page';
            ObjectStackProtocolImplementation.resetEnvWritableCache();
            const legacy = protocolOn(environmentId);
            expect(await hatchOf(legacy)).toEqual({ flow: SHUT, page: SHUT });
            for (const verb of ['save', 'delete', 'page'] as const) {
                const verdict: any = verb === 'page'
                    ? legacy.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' })
                    : legacy.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: verb });
                expect(shape(verdict), verb).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                expect(verdict.message, verb).toBe(sealed[verb].message);
            }

            // Control: the preferred spelling is read, so the same names open the listing.
            process.env.OS_METADATA_WRITABLE = 'flow,page';
            ObjectStackProtocolImplementation.resetEnvWritableCache();
            const OPEN = { allowEnvironmentOverlay: true, overrideSource: 'env' };
            expect(await hatchOf(protocolOn(environmentId))).toEqual({ flow: OPEN, page: OPEN });
        });
    }
});

/**
 * [#20819, ADR-0126 §2] The refusal's SENTENCE is chosen per regime, from one
 * table keyed on the type's declared regime. The code, the status and which
 * writes are refused are the matrix above, unchanged.
 *
 * A Regime C type (`flow`) names Regime C's sanctioned paths — the clone under
 * a new name (§7.1) and the enable/disable switch (§7.2) — cites ADR-0126, and
 * names neither the `OS_METADATA_WRITABLE` hatch nor a redeploy an installed
 * package's administrator cannot make. [#20910] So do `action` and
 * `permission`, from their own rows: an action names its activation switch and
 * no clone (the action-clone half is not chartered), a permission set names its
 * clone and no switch. Every type with no regime reads the managed seal (the
 * control: `page`). [ADR-0131 D6] Every one of them names the managed package
 * first: the install mode is what the refusal is about.
 */
describe('packagedBaseRefusal — the sentence is chosen per ADR-0126 regime', () => {
    const CLONE = 'POST /api/v1/automation/:name/clone';
    const TOGGLE = 'POST /api/v1/automation/:name/toggle';
    const ADR_0126 = 'docs/adr/0126-packaged-metadata-customization-model.md';

    /**
     * [#23577] The package-less sentence every regime-less type's write reads
     * (`refusePackagedBaseOverride`): what the door knows and where the names
     * are listed — no create advice, no source-artifact advice, no hatch.
     */
    const SEALED_SAVE = (type: string, name: string) =>
        `'${type}/${name}' is provided by a managed package and is sealed: it cannot be written here. `
        + `GET /api/v1/meta/${type} lists the names in use.`;
    /** …and its removal twin (`refusePackagedBaseRemoval`), which has no remedy to name. */
    const SEALED_DELETE = (type: string, name: string) =>
        `Metadata item '${type}/${name}' is provided by a managed package and is sealed against removal: `
        + 'its type takes no environment overlay (allowEnvironmentOverlay=false), and OS_METADATA_WRITABLE does not open '
        + 'a managed item. See docs/adr/0131-total-organization-ownership-no-null-organization-id.md.';

    for (const environmentId of [undefined, 'env_1']) {
        for (const operation of ['save', 'delete'] as const) {
            // [#28412, ADR-0146 D9 item 1] The SAVE names the declaration from
            // the base's paired `.custom` in place of the clone: a clone is a
            // second flow beside the base, and both run. The removal keeps
            // the row's prescription.
            it(`a packaged flow's ${operation} refusal names ${operation === 'save' ? 'the declaration' : 'clone'} and the switch, cites ADR-0126, and names no hatch `
                + `(${environmentId ? 'environment' : 'host-config'} kernel)`, () => {
                const refusal: any = protocolOn(environmentId)
                    .packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation });
                expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
                const message = String(refusal.message);
                expect(message.startsWith("Metadata item 'flow/pkg_flow' is provided by a managed package")).toBe(true);
                if (operation === 'save') {
                    expect(message).toContain(`Declare an override from '${PACKAGE_ID}.custom'`);
                    expect(message).not.toContain(CLONE);
                } else {
                    expect(message).toContain(CLONE);
                }
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
        // [#28412] The save names the declaration in place of the clone.
        expect(save?.message).toContain(`Declare an override from '${PACKAGE_ID}.custom'`);
        expect(save?.message).toBe(p.packagedBaseRefusal({ type: 'flow', name: 'pkg_flow', operation: 'save' })?.message);
        expect(del?.message).toContain(TOGGLE);
    });

    it('control: a type with no declared regime (`page`) reads the managed seal', () => {
        const p = protocolOn('env_1');
        const refusal: any = p.packagedBaseRefusal({ type: 'page', name: 'pkg_page', operation: 'save' });
        expect(shape(refusal)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        // [ADR-0146 D2] …and, on a type a declared override can replace, names
        // the two fixes: declare from the base's paired `.custom`, or rename.
        expect(refusal.message).toBe(
            `${SEALED_SAVE('page', 'pkg_page')} To change it, declare an override from '${PACKAGE_ID}.custom' `
            + `(overrides: { package: '${PACKAGE_ID}', basedOn }), or rename the item.`,
        );
        // It never names the hatch as a remedy.
        expect(refusal.message).not.toMatch(/set OS_METADATA_WRITABLE|may set OS_METADATA_WRITABLE/);
    });

    it('a regime-less type\'s removal reads the managed seal too (`object`, no overlay merge at read)', () => {
        // `page` merges its overlay at read, so its removal is the #6960
        // carve-out and never refused; `object` is refused, and reads the seal.
        const registry = { getArtifactItem: (type: string, name: string) => (type === 'object' ? shipped(name) : undefined) };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), 'env_1');
        const del: any = p.packagedBaseRefusal({ type: 'object', name: 'pkg_object', operation: 'delete' });
        expect(shape(del)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(del.message).toBe(SEALED_DELETE('object', 'pkg_object'));
    });
});

/**
 * [#20910, ADR-0126 §2 / §3] ONE regime, PER-TYPE routes: each Regime C type's
 * refusal is built from its own row, and names only the primitives that type
 * has — on save AND on removal.
 */
describe('packagedBaseRefusal — each Regime C type names its OWN sanctioned path', () => {
    const ADR_0126 = 'docs/adr/0126-packaged-metadata-customization-model.md';
    const OPERATOR_ONLY = 'operator-only where one install serves several organizations';

    /**
     * The opening sentence every Regime C refusal shares — the regime's shape,
     * not the type's. [ADR-0131 D6] It names the managed package.
     */
    const LOCKED = (type: string, name: string, operation: 'save' | 'delete') =>
        `Metadata item '${type}/${name}' is provided by a managed package and is sealed `
        + (operation === 'delete' ? 'against removal.' : 'against in-place edits.');

    const refusal = (
        type: string, name: string, operation: 'save' | 'delete', environmentId: string | undefined = 'env_1',
    ): any => protocolOn(environmentId).packagedBaseRefusal({ type, name, operation });
    /** The same verdict on a host-config kernel (no environment id) — not the default parameter. */
    const refusalOnHostConfig = (type: string, name: string, operation: 'save' | 'delete'): any =>
        protocolOn(undefined).packagedBaseRefusal({ type, name, operation });
    const refusalOn = (environmentId: string | undefined, type: string, name: string, operation: 'save' | 'delete') =>
        (environmentId === undefined ? refusalOnHostConfig(type, name, operation) : refusal(type, name, operation, environmentId));

    /** What every Regime C refusal owes, whatever the type: the lock, the ADR, no hatch, no redeploy. */
    const expectRegimeC = (r: any, type: string, name: string, operation: 'save' | 'delete') => {
        expect(shape(r)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        const message = String(r.message);
        expect(message.startsWith(`${LOCKED(type, name, operation)} `)).toBe(true);
        expect(message.endsWith(`See ${ADR_0126}.`)).toBe(true);
        expect(message).not.toContain('OS_METADATA_WRITABLE');
        expect(message).not.toContain('redeploy');
        expect(message).not.toContain('0005-metadata-customization-overlay');
        return message;
    };

    it('`flow` — the sentence, spelled out literally, on save and on removal', () => {
        // Spelled out literally, NOT through the builder: the builder cannot
        // move a byte of the flow sentence without this pin seeing it.
        // [ADR-0131 D6] The opener names the managed package and the seal.
        // [#28412, ADR-0146 D9 item 1] The save names the declaration from the
        // base's paired `.custom` (or a rename) in place of the clone.
        expect(refusal('flow', 'pkg_flow', 'save').message).toBe(
            "Metadata item 'flow/pkg_flow' is provided by a managed package and is sealed "
            + "against in-place edits. Declare an override from 'com.example.pkg.custom' or rename it to customize it, "
            + 'or switch it off (POST /api/v1/automation/:name/toggle, body {enabled: false}; '
            + 'operator-only where one install serves several organizations). '
            + 'See docs/adr/0126-packaged-metadata-customization-model.md.',
        );
        expect(refusal('flow', 'pkg_flow', 'delete').message).toBe(
            "Metadata item 'flow/pkg_flow' is provided by a managed package and is sealed "
            + 'against removal. Clone it under a new name to customize it (POST /api/v1/automation/:name/clone, '
            + 'body {name, label}), or switch it off (POST /api/v1/automation/:name/toggle, body {enabled: false}; '
            + 'operator-only where one install serves several organizations). '
            + 'See docs/adr/0126-packaged-metadata-customization-model.md.',
        );
    });

    for (const environmentId of [undefined, 'env_1']) {
        for (const operation of ['save', 'delete'] as const) {
            it(`\`action\` — ${operation} names the activation switch and no clone `
                + `(${environmentId ? 'environment' : 'host-config'} kernel)`, () => {
                const message = expectRegimeC(refusalOn(environmentId, 'action', 'pkg_action', operation), 'action', 'pkg_action', operation);
                expect(message).toContain(
                    'Switch it off (POST /api/v1/actions/_activation/:object/:action, body {enabled: false}, '
                    + `:object = global for an object-less action; ${OPERATOR_ONLY}).`,
                );
                // No clone is chartered for an action (ADR-0126 §8 item 2): none is advertised.
                expect(message.toLowerCase()).not.toContain('clone');
                expect(message).not.toContain('/automation/');
            });
        }

        it(`\`permission\` — save names its clone and no switch (${environmentId ? 'environment' : 'host-config'} kernel)`, () => {
            const message = expectRegimeC(refusalOn(environmentId, 'permission', 'pkg_perm', 'save'), 'permission', 'pkg_perm', 'save');
            // The clone route's spelling moved with C3 stage 8 (the retired
            // object's data route → the catalog's clone door); the sentence did not.
            expect(message).toContain('Clone it under a new name to customize it (the "Clone" action on the permission set, or POST /api/v1/');
            expect(message).toContain(' with a new name).');
            expect(message.toLowerCase()).not.toContain('switch it off');
            expect(message).not.toContain('_activation');
            expect(message).not.toContain('/automation/');
        });
    }

    it('`permission` removal stays the #6960 carve-out — the row adds no refusal where there was none', () => {
        // `permission` merges its overlay at read (`supportsOverlay: true`), so
        // removing its overlay row is repair, never refused on this ground.
        expect(refusal('permission', 'pkg_perm', 'delete')).toBeNull();
        expect(refusalOnHostConfig('permission', 'pkg_perm', 'delete')).toBeNull();
    });

    it('the /meta doors throw the row\'s sentence for an action, on save and on removal (one emitter)', async () => {
        const p = protocolOn('env_1');
        const thrownBy = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);
        const save: any = await thrownBy(p.saveMetaItem({ type: 'action', name: 'pkg_action', item: { name: 'pkg_action', label: 'x' } }));
        const del: any = await thrownBy(p.deleteMetaItem({ type: 'action', name: 'pkg_action' }));
        expect({ ...shape(save), message: save?.message }).toEqual({
            ...shape(refusal('action', 'pkg_action', 'save')), message: refusal('action', 'pkg_action', 'save').message,
        });
        expect({ ...shape(del), message: del?.message }).toEqual({
            ...shape(refusal('action', 'pkg_action', 'delete')), message: refusal('action', 'pkg_action', 'delete').message,
        });
    });

    it('a save NAMING the read-only base takes the named-base ITEM_LOCKED limb — same row, no hatch (both kernel shapes)', () => {
        // [#20910] The limb's emitter is `SysMetadataRepository.readOnlyBaseOverrideError`,
        // reached through the package door; with the hatch closed it speaks
        // for the row too. A booted code package is read-only (`manifests`).
        for (const environmentId of [undefined, 'env_1']) {
            const registry = { getArtifactItem: (type: string, name: string) => ARTIFACTS.get(type)?.get(name) };
            const p = new ObjectStackProtocolImplementation(
                { registry, manifests: new Map([[PACKAGE_ID, {}]]) } as never, () => new Map(), environmentId,
            );
            for (const [type, name, path] of [
                ['flow', 'pkg_flow', 'POST /api/v1/automation/:name/clone'],
                ['action', 'pkg_action', 'POST /api/v1/actions/_activation/:object/:action'],
                ['permission', 'pkg_perm', 'the "Clone" action on the permission set, or POST /api/v1/'],
            ] as const) {
                const r: any = p.packagedBaseRefusal({ type, name, operation: 'save', packageId: PACKAGE_ID });
                expect({ code: r?.code, status: r?.status, lockSource: r?.lockSource, packageId: r?.packageId }, type)
                    .toEqual({ code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: PACKAGE_ID });
                const message = String(r.message);
                expect(message.startsWith(
                    `Cannot overlay '${type}' in package '${PACKAGE_ID}': that package is read-only, and its packaged base `
                    + 'is locked against in-place edits. ',
                ), type).toBe(true);
                expect(message, type).toContain(path);
                expect(message, type).not.toContain('OS_METADATA_WRITABLE');
                expect(message.endsWith(`See ${ADR_0126}.`), type).toBe(true);
            }
        }
    });

    it('every row arrives whole through the REST door\'s 500-character bound for an 88-character name', () => {
        // `truncateClientMessage` (packages/rest/src/error-response.ts) keeps a
        // message only while it is SHORTER than 500 characters; past that the
        // tail — where the routes and the ADR citation sit — is cut.
        const longName = `pkg_${'x'.repeat(84)}`;
        expect(longName).toHaveLength(88);
        const registry = {
            getArtifactItem: (type: string, name: string) =>
                (['flow', 'action', 'permission'].includes(type) && name === longName ? shipped(name) : undefined),
        };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), 'env_1');
        for (const [type, operation] of [
            ['flow', 'save'], ['flow', 'delete'], ['action', 'save'], ['action', 'delete'], ['permission', 'save'],
        ] as const) {
            const message = String((p.packagedBaseRefusal({ type, name: longName, operation }) as any).message);
            expect(message.length, `${type} ${operation}`).toBeLessThan(500);
            expect(message.endsWith(`See ${ADR_0126}.`), `${type} ${operation}`).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// ADR-0146 D2 (ruling A on #28390) — the override write gate, at publish.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The override write gate: only the base's paired `<base>.custom` declares an
 * override. Inside a base's dependency closure, a dependent's item that bears
 * a base item's name is refused unless it is the pair's declared override; a
 * dependent that carries `overrides` is refused; a declaration naming a
 * package outside the closure, or a package that ships no such item, is
 * refused; and `overrides` on a type with no override channel is refused by
 * name. Each refusal is `403 NOT_OVERRIDABLE` (the code the sealed write
 * already answers) with its own sentence.
 *
 * Harness: the real save and promotion paths over a stub engine whose
 * registry ships the base's artifacts (`_packageId` stamped, as
 * `SchemaRegistry.getArtifactItem` stamps a code package's) and serves each
 * package's manifest for the closure walk.
 */
describe('the override write gate — only the base\'s paired .custom declares an override (ADR-0146 D2)', () => {
    const BASE = 'com.acme.crm';
    const PAIR = 'com.acme.crm.custom';
    const PARTNER = 'com.acme.partner';
    const OTHER_PAIR = 'com.zeta.custom';
    const UNRELATED = 'com.other';
    const MANIFESTS: Record<string, { dependencies: Record<string, string>; version: string }> = {
        [BASE]: { dependencies: {}, version: '3.2.0' },
        [PAIR]: { dependencies: { [BASE]: '^3' }, version: '0.1.0' },
        [PARTNER]: { dependencies: { [BASE]: '^3' }, version: '1.0.0' },
        // A pair of ANOTHER base that also depends on this one: the former
        // "second declarer" — not the base's pair, so it may not declare.
        [OTHER_PAIR]: { dependencies: { [BASE]: '^3', 'com.zeta': '^1' }, version: '0.1.0' },
        'com.zeta': { dependencies: {}, version: '1.0.0' },
        [UNRELATED]: { dependencies: {}, version: '1.0.0' },
        // The pair of the unrelated package, installed without declaring its base.
        [`${UNRELATED}.custom`]: { dependencies: {}, version: '0.1.0' },
    };
    /** What the base ships: an overlay type, a sealed type, a flow, an action, a permission set, an object. */
    const BASE_ITEMS: Array<{ type: string; name: string }> = [
        { type: 'view', name: 'task.crm_list' },
        { type: 'dashboard', name: 'crm_board' },
        { type: 'page', name: 'crm_home' },
        { type: 'flow', name: 'crm_flow' },
        { type: 'action', name: 'crm_action' },
        { type: 'permission', name: 'crm_perm' },
        { type: 'object', name: 'crm_account' },
    ];
    const artifact = (type: string, name: string) =>
        BASE_ITEMS.some((i) => i.type === type && i.name === name)
            ? { name, label: name, _packageId: BASE, _provenance: 'package' }
            : undefined;

    interface GateRow { type: string; name: string; package_id: string | null; state: string; metadata: string; id?: string }
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
    const matches = (r: GateRow, where: Record<string, unknown>): boolean => Object.entries(where).every(([k, v]) => {
        if (v === undefined) return true;
        if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => matches(r, c));
        if (v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            return (v as { $in: unknown[] }).$in.includes((r as unknown as Record<string, unknown>)[k]);
        }
        return (r as unknown as Record<string, unknown>)[k] === v;
    });

    function gateProtocol() {
        const rows = new Map<string, GateRow>();
        let nextId = 0;
        const findRow = (w: Record<string, unknown>) => {
            if (w.id !== undefined) {
                for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
                return null;
            }
            if (w.package_id !== undefined) {
                const r = rows.get(keyOf(w));
                if (r) return { key: keyOf(w), row: r };
            }
            for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
            return null;
        };
        const packageRecord = (id: string) =>
            (MANIFESTS[id] ? { manifest: { id, ...MANIFESTS[id] } } : undefined);
        const engine: any = {
            // A booted code package is read-only (`isWritablePackage` reads `manifests` first).
            manifests: new Map([[BASE, {}]]),
            async findOne(table: string, opts: { where: Record<string, unknown> }) {
                assertEngineFindOnePredicate(table, opts);
                if (table !== 'sys_metadata') return null;
                return findRow(opts.where)?.row ?? null;
            },
            async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
                if (table !== 'sys_metadata') return [];
                const hits = Array.from(rows.values()).filter((r) => matches(r, opts?.where ?? {}));
                return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
            },
            async insert(table: string, data: Record<string, unknown>) {
                if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
                nextId += 1;
                const row = { ...(data as unknown as GateRow), id: `r_${nextId}` };
                rows.set(keyOf(data), row);
                return { id: row.id };
            },
            async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
                assertEngineUpdateDispatch(data, opts);
                const found = findRow(opts.where);
                if (!found) return { id: null };
                const merged = { ...found.row, ...(data as unknown as GateRow) };
                rows.delete(found.key);
                rows.set(keyOf(merged), merged);
                return { id: found.row.id };
            },
            async delete(_t: string, opts: { where: Record<string, unknown> }) {
                assertEngineDeleteDispatch(opts);
                const found = findRow(opts.where);
                if (!found) return { deleted: 0 };
                rows.delete(found.key);
                return { deleted: 1 };
            },
            async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
                return cb(undefined, { owned: true });
            },
            async syncObjectSchema() { return true; },
            registry: {
                registerItem: () => {},
                registerObject: () => {},
                unregisterItem: () => {},
                listItems: (type: string) => (type === 'object'
                    ? [{ name: 'task', fields: { name: { type: 'text' }, title: { type: 'text' } } },
                        { ...artifact('object', 'crm_account'), fields: { name: { type: 'text' } } }]
                    : BASE_ITEMS.filter((i) => i.type === type).map((i) => artifact(i.type, i.name))),
                getItem: () => undefined,
                getObject: () => undefined,
                getPackage: packageRecord,
                getAllPackages: () => Object.keys(MANIFESTS).map(packageRecord),
                isPackageDisabled: () => false,
                getArtifactItem: (type: string, name: string) => artifact(type, name),
            },
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1') as any;
        /** Store a draft as one saved before this gate existed would sit. */
        const seedDraft = (type: string, name: string, packageId: string, body: Record<string, unknown>) => {
            nextId += 1;
            const row: GateRow = { type, name, package_id: packageId, state: 'draft', metadata: JSON.stringify(body), id: `r_${nextId}` };
            rows.set(keyOf(row as unknown as Record<string, unknown>), row);
        };
        const stored = () => Array.from(rows.values())
            .map((r) => ({ type: r.type, name: r.name, package_id: r.package_id, state: r.state }));
        return { protocol, rows, stored, seedDraft };
    }

    const DECLARATION = { package: BASE, basedOn: '3.2.0' };
    const BODIES: Record<string, (name: string) => Record<string, unknown>> = {
        view: (name) => ({ name, label: 'List', object: 'task', viewKind: 'list', columns: [{ field: 'title', label: 'Title' }] }),
        dashboard: (name) => ({ name, label: 'Board', widgets: [] }),
        page: (name) => ({ name, label: 'Home', object: 'task', type: 'list', kind: 'full', regions: [] }),
        flow: (name) => ({ name, label: 'Flow', type: 'autolaunched', nodes: [], edges: [] }),
        action: (name) => ({ name, label: 'Action', type: 'script', body: { language: 'js', source: 'return { success: true };' } }),
        permission: (name) => ({ name, label: 'Perm', objects: {} }),
        object: (name) => ({ name, label: 'Account', pluralLabel: 'Accounts', fields: {}, sharingModel: 'private' }),
    };
    const body = (type: string, name: string, declared = false, declaration: Record<string, unknown> = DECLARATION) =>
        ({ ...BODIES[type](name), ...(declared ? { overrides: { ...declaration } } : {}) });
    const thrown = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);
    const REFUSED = { code: 'NOT_OVERRIDABLE', status: 403 };

    // ── (a) an undeclared same name inside the closure ──────────────────────

    for (const [type, name] of [['view', 'task.crm_list'], ['dashboard', 'crm_board']] as const) {
        it(`a partner's undeclared same-named ${type} is refused — rename (the #28238 shape: today 200)`, async () => {
            const { protocol, stored } = gateProtocol();
            const e = await thrown(protocol.saveMetaItem({ type, name, packageId: PARTNER, item: body(type, name) }));
            expect(shape(e)).toEqual(REFUSED);
            expect(String(e.message)).toContain(`'${type}/${name}'`);
            expect(String(e.message)).toContain(BASE);
            expect(String(e.message)).toMatch(/Rename the item/);
            expect(String(e.message)).not.toMatch(/declare/i);
            expect(stored()).toEqual([]);
        });

        it(`the pair's undeclared same-named ${type} is refused — declare or rename`, async () => {
            const { protocol, stored } = gateProtocol();
            const e = await thrown(protocol.saveMetaItem({ type, name, packageId: PAIR, item: body(type, name) }));
            expect(shape(e)).toEqual(REFUSED);
            expect(String(e.message)).toContain(`overrides: { package: '${BASE}'`);
            expect(String(e.message)).toMatch(/or rename the item/);
            expect(stored()).toEqual([]);
        });
    }

    it('an undeclared same name is refused on a draft save too, and nothing is stored', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({
            type: 'view', name: 'task.crm_list', packageId: PARTNER, item: body('view', 'task.crm_list'), mode: 'draft',
        }));
        expect(shape(e)).toEqual(REFUSED);
        expect(stored()).toEqual([]);
    });

    it('control: outside the closure a same name coexists — an unrelated package keeps its own view', async () => {
        const { protocol, stored } = gateProtocol();
        await protocol.saveMetaItem({ type: 'view', name: 'task.crm_list', packageId: UNRELATED, item: body('view', 'task.crm_list') });
        expect(stored()).toEqual([{ type: 'view', name: 'task.crm_list', package_id: UNRELATED, state: 'active' }]);
    });

    it('control: a package-less overlay row is not this gate\'s question (the migration card closes it)', async () => {
        const { protocol, stored } = gateProtocol();
        await protocol.saveMetaItem({ type: 'view', name: 'task.crm_list', item: body('view', 'task.crm_list') });
        expect(stored()).toEqual([{ type: 'view', name: 'task.crm_list', package_id: null, state: 'active' }]);
    });

    // ── the admit ────────────────────────────────────────────────────────────

    for (const [type, name] of [['view', 'task.crm_list'], ['dashboard', 'crm_board'], ['page', 'crm_home']] as const) {
        it(`the pair's declared override of a ${type} is admitted and stored with its declaration`, async () => {
            const { protocol, rows, stored } = gateProtocol();
            await protocol.saveMetaItem({ type, name, packageId: PAIR, item: body(type, name, true) });
            expect(stored()).toEqual([{ type, name, package_id: PAIR, state: 'active' }]);
            const row = Array.from(rows.values())[0];
            expect(JSON.parse(row.metadata).overrides).toEqual(DECLARATION);
        });
    }

    // ── (b) `overrides` on a package that is not the base's pair ────────────

    for (const pkg of [PARTNER, OTHER_PAIR]) {
        it(`${pkg === PARTNER ? 'a partner' : 'another base\'s pair'} that carries \`overrides\` is refused — only the pair declares`, async () => {
            const { protocol, stored } = gateProtocol();
            const e = await thrown(protocol.saveMetaItem({
                type: 'view', name: 'task.crm_list', packageId: pkg, item: body('view', 'task.crm_list', true),
            }));
            expect(shape(e)).toEqual(REFUSED);
            expect(String(e.message)).toContain(`only '${PAIR}' may declare`);
            expect(stored()).toEqual([]);
        });
    }

    it('the second declarer: after the pair declared, a partner declaring the same item is refused', async () => {
        const { protocol, stored } = gateProtocol();
        await protocol.saveMetaItem({ type: 'view', name: 'task.crm_list', packageId: PAIR, item: body('view', 'task.crm_list', true) });
        const e = await thrown(protocol.saveMetaItem({
            type: 'view', name: 'task.crm_list', packageId: PARTNER, item: body('view', 'task.crm_list', true),
        }));
        expect(shape(e)).toEqual(REFUSED);
        expect(stored()).toEqual([{ type: 'view', name: 'task.crm_list', package_id: PAIR, state: 'active' }]);
    });

    // ── (c) a declaration naming the wrong package ──────────────────────────

    it('a declaration naming a package outside the closure is refused — declare a dependency', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({
            type: 'view', name: 'task.crm_list', packageId: `${UNRELATED}.custom`,
            item: body('view', 'task.crm_list', true, { package: UNRELATED, basedOn: '1.0.0' }),
        }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/Declare a dependency on/);
        expect(stored()).toEqual([]);
    });

    it('a declaration naming a base that ships no such item is refused', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({
            type: 'view', name: 'task.novel', packageId: PAIR, item: body('view', 'task.novel', true),
        }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toContain(`ships no view named 'task.novel'`);
        expect(stored()).toEqual([]);
    });

    // ── (d) an excluded type, (e) an object, flow and action ────────────────

    it('`overrides` on a permission set is refused — new similar (ADR-0146 D6)', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'permission', name: 'crm_perm', packageId: PAIR, item: body('permission', 'crm_perm', true) }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/takes no override/);
        expect(String(e.message)).toMatch(/new similar/);
        expect(stored()).toEqual([]);
    });

    it('`overrides` on an object is refused — extend it (ADR-0146 D10)', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'object', name: 'crm_account', packageId: PAIR, item: body('object', 'crm_account', true) }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/extended, never replaced/);
        expect(String(e.message)).toContain('objectExtensions');
        expect(stored()).toEqual([]);
    });

    // [#28412, ADR-0146 D9] `flow`'s D9 conditions are delivered (the flow
    // precedence arms the pair's declaration over the loader's body, version
    // pinning landed in #28405), so the same gate admits the pair's declared
    // flow override — refused until this card as "not yet available" — and
    // keeps every other refusal. `action` stays closed (the next case).
    it('the pair\'s declared flow override is admitted at the save door and stored with its declaration (#28412)', async () => {
        const { protocol, rows, stored } = gateProtocol();
        await protocol.saveMetaItem({ type: 'flow', name: 'crm_flow', packageId: PAIR, item: body('flow', 'crm_flow', true) });
        expect(stored()).toEqual([{ type: 'flow', name: 'crm_flow', package_id: PAIR, state: 'active' }]);
        expect(JSON.parse(Array.from(rows.values())[0].metadata).overrides).toEqual(DECLARATION);
    });

    it('publishMetaItem promotes the pair\'s declared flow override draft (#28412)', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('flow', 'crm_flow', PAIR, body('flow', 'crm_flow', true));
        await protocol.publishMetaItem({ type: 'flow', name: 'crm_flow', packageId: PAIR });
        expect(stored()).toEqual([{ type: 'flow', name: 'crm_flow', package_id: PAIR, state: 'active' }]);
    });

    it('publishPackageDrafts promotes the pair\'s declared flow override (#28412)', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('flow', 'crm_flow', PAIR, body('flow', 'crm_flow', true));
        const res = await protocol.publishPackageDrafts({ packageId: PAIR });
        expect(res.success).toBe(true);
        expect(stored()).toEqual([{ type: 'flow', name: 'crm_flow', package_id: PAIR, state: 'active' }]);
    });

    it('a partner\'s declared flow override is still refused — only the pair declares (#28412)', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'flow', name: 'crm_flow', packageId: PARTNER, item: body('flow', 'crm_flow', true) }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toContain(`only '${PAIR}' may declare`);
        expect(String(e.message)).not.toMatch(/not yet available/);
        expect(stored()).toEqual([]);
    });

    it('the pair\'s undeclared same-named flow is refused — declare or rename, never clone (#28412)', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'flow', name: 'crm_flow', packageId: PAIR, item: body('flow', 'crm_flow') }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/[Dd]eclare/);
        expect(String(e.message)).not.toMatch(/not yet available/);
        expect(String(e.message).toLowerCase()).not.toContain('clone');
        expect(stored()).toEqual([]);
    });

    it('a declared action override is refused — action customization is not yet available', async () => {
        const { protocol, stored } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'action', name: 'crm_action', packageId: PAIR, item: body('action', 'crm_action', true) }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/action customization is not yet available/);
        expect(stored()).toEqual([]);
    });

    // ── the sealed write's sentence ─────────────────────────────────────────

    it('the pair\'s sealed write of an overridable type says declare or rename, not clone; code and status stay', async () => {
        const { protocol } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'page', name: 'crm_home', packageId: PAIR, item: body('page', 'crm_home') }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toMatch(/ To change it, declare an override from '[^']+' \(overrides: \{ package: '[^']+', basedOn \}\), or rename the item\.$/);
        expect(String(e.message)).toContain(`declare an override from '${PAIR}' (overrides: { package: '${BASE}', basedOn })`);
        expect(String(e.message).toLowerCase()).not.toContain('clone');
        expect(String(e.message).length).toBeLessThan(500);
    });

    it('any other package\'s sealed write of an overridable type says rename only — only the pair declares (#28390 A)', async () => {
        // A non-pair package that declared would meet `declared_outside_pair`,
        // so the sealed sentence never advises it to declare.
        const { protocol } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'page', name: 'crm_home', packageId: UNRELATED, item: body('page', 'crm_home') }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message).endsWith(` To change it, rename the item: only '${PAIR}' may declare an override of '${BASE}'.`)).toBe(true);
        expect(String(e.message)).not.toContain('declare an override from');
        expect(String(e.message)).not.toMatch(/basedOn/);
        expect(String(e.message).toLowerCase()).not.toContain('clone');
    });

    it('a sealed write naming no package keeps the declare-or-rename advice (the administrator may move it to the pair)', async () => {
        const { protocol } = gateProtocol();
        const e = await thrown(protocol.saveMetaItem({ type: 'page', name: 'crm_home', item: body('page', 'crm_home') }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toContain(`declare an override from '${PAIR}' (overrides: { package: '${BASE}', basedOn }), or rename the item.`);
    });

    // ── a malformed `overrides` is the schema gate's, not this gate's ───────
    // (should-fix 3 of the contract review on #28554)

    for (const [label, overrides] of [
        ['null', null],
        ['a string', 'com.acme.crm'],
        ['no package', { basedOn: '1.0.0' }],
        ['an empty package', { package: '', basedOn: '1.0.0' }],
        ['no basedOn', { package: 'com.acme.crm' }],
    ] as const) {
        it(`a partner's view whose \`overrides\` is malformed (${label}) is not judged as a declaration: no declared_outside_pair`, async () => {
            const { protocol, stored } = gateProtocol();
            const e = await thrown(protocol.saveMetaItem({
                type: 'view', name: 'partner_own_list', packageId: PARTNER,
                item: { ...body('view', 'partner_own_list'), overrides },
            }));
            // The door's schema gate answers the malformed value (its
            // `INVALID_METADATA` / 422, naming the key); the override gate
            // never answers `403 NOT_OVERRIDABLE` for it.
            expect(shape(e)).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect(String(e.message)).toMatch(/overrides/);
            expect(String(e.message)).not.toMatch(/carries `overrides`/);
            expect(stored()).toEqual([]);
        });
    }

    // ── the promotion doors: a draft stored before the gate ─────────────────

    it('publishMetaItem refuses a partner\'s undeclared same-named draft, and promotes nothing', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('view', 'task.crm_list', PARTNER, body('view', 'task.crm_list'));
        const e = await thrown(protocol.publishMetaItem({ type: 'view', name: 'task.crm_list', packageId: PARTNER }));
        expect(shape(e)).toEqual(REFUSED);
        expect(stored()).toEqual([{ type: 'view', name: 'task.crm_list', package_id: PARTNER, state: 'draft' }]);
    });

    it('publishMetaItem refuses a partner\'s draft that carries `overrides`', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('view', 'task.crm_list', PARTNER, body('view', 'task.crm_list', true));
        const e = await thrown(protocol.publishMetaItem({ type: 'view', name: 'task.crm_list', packageId: PARTNER }));
        expect(shape(e)).toEqual(REFUSED);
        expect(String(e.message)).toContain(`only '${PAIR}' may declare`);
        expect(stored()).toEqual([{ type: 'view', name: 'task.crm_list', package_id: PARTNER, state: 'draft' }]);
    });

    it('publishMetaItem promotes the pair\'s declared override of a sealed type', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('page', 'crm_home', PAIR, body('page', 'crm_home', true));
        await protocol.publishMetaItem({ type: 'page', name: 'crm_home', packageId: PAIR });
        expect(stored()).toEqual([{ type: 'page', name: 'crm_home', package_id: PAIR, state: 'active' }]);
    });

    it('publishPackageDrafts refuses a partner\'s undeclared same-named draft, and promotes nothing', async () => {
        // The batch answers per item and rolls the whole batch back (ADR-0067
        // D2); this stub's transaction does not roll back, so what is pinned
        // is the refused item: never promoted, named with its code.
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('dashboard', 'partner_board', PARTNER, body('dashboard', 'partner_board'));
        seedDraft('dashboard', 'crm_board', PARTNER, body('dashboard', 'crm_board'));
        const res = await protocol.publishPackageDrafts({ packageId: PARTNER });
        expect(res.success).toBe(false);
        expect(res.failed).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'dashboard', name: 'crm_board', code: 'NOT_OVERRIDABLE' }),
        ]));
        expect(stored().filter((r) => r.name === 'crm_board')).toEqual([
            { type: 'dashboard', name: 'crm_board', package_id: PARTNER, state: 'draft' },
        ]);
    });

    it('publishPackageDrafts promotes the pair\'s declared override beside its own new item', async () => {
        const { protocol, stored, seedDraft } = gateProtocol();
        seedDraft('page', 'crm_home', PAIR, body('page', 'crm_home', true));
        seedDraft('dashboard', 'custom_board', PAIR, body('dashboard', 'custom_board'));
        const res = await protocol.publishPackageDrafts({ packageId: PAIR });
        expect(res.success).toBe(true);
        expect(stored().map((r) => `${r.type}/${r.name}:${r.state}`).sort())
            .toEqual(['dashboard/custom_board:active', 'page/crm_home:active']);
    });
});
