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
 * package's administrator cannot make. [#20910] So do `action` and
 * `permission`, from their own rows: an action names its activation switch and
 * no clone (the action-clone half is not chartered), a permission set names its
 * clone and no switch. Every type with no regime keeps its sentence byte for
 * byte (the control: `page`).
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

    it('a regime-less type\'s removal sentence is unchanged too (`object`, no overlay merge at read)', () => {
        // `page` merges its overlay at read, so its removal is the #6960
        // carve-out and never refused; `object` is refused, and keeps its line.
        const registry = { getArtifactItem: (type: string, name: string) => (type === 'object' ? shipped(name) : undefined) };
        const p = new ObjectStackProtocolImplementation({ registry } as never, () => new Map(), 'env_1');
        const del: any = p.packagedBaseRefusal({ type: 'object', name: 'pkg_object', operation: 'delete' });
        expect(shape(del)).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(del.message).toBe(LEGACY_DELETE('object', 'pkg_object'));
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

    /** The opening sentence every Regime C refusal shares — the regime's shape, not the type's. */
    const LOCKED = (type: string, name: string, operation: 'save' | 'delete') =>
        `Metadata item '${type}/${name}' is provided by a code package, and its packaged base is locked `
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

    it('`flow` — the sentence is byte-identical to the one the row table replaced, on save and on removal', () => {
        // Spelled out literally, NOT through the builder: this is the pin that
        // the table refactor moved no byte of the flow sentence.
        expect(refusal('flow', 'pkg_flow', 'save').message).toBe(
            "Metadata item 'flow/pkg_flow' is provided by a code package, and its packaged base is locked "
            + 'against in-place edits. Clone it under a new name to customize it (POST /api/v1/automation/:name/clone, '
            + 'body {name, label}), or switch it off (POST /api/v1/automation/:name/toggle, body {enabled: false}; '
            + 'operator-only where one install serves several organizations). '
            + 'See docs/adr/0126-packaged-metadata-customization-model.md.',
        );
        expect(refusal('flow', 'pkg_flow', 'delete').message).toBe(
            "Metadata item 'flow/pkg_flow' is provided by a code package, and its packaged base is locked "
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
            expect(message).toContain(
                'Clone it under a new name to customize it (the "Clone" action on the permission set, '
                + 'or POST /api/v1/data/sys_permission_set with a new name).',
            );
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
                ['permission', 'pkg_perm', 'POST /api/v1/data/sys_permission_set'],
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
