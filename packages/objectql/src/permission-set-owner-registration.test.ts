// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0086 D3] The REGISTRATION door of the permission-set owner-binding
 * rule: `ObjectQL.registerApp` refuses a set whose body `packageId` disagrees
 * with the package it registers the set under, instead of filing it there in
 * silence.
 *
 * ## The defect, measured before the fix
 *
 * A manifest `com.probe.pkg` whose set declared `packageId: 'com.probe.other'`
 * registered the set as `{ _packageId: 'com.probe.pkg', packageId:
 * 'com.probe.other' }`, with no refusal and no warning line; the same through
 * a nested plugin. A manifest with no id registered it with no `_packageId`
 * at all, so the body's key was the only owner a fallback reader could find.
 *
 * The judge is the one every door of the rule calls
 * (`judgePermissionSetOwnerBinding`, `@objectstack/spec/security`). This file
 * pins the door: the envelope (`VALIDATION_ERROR` / 400, `issues[]` at
 * `packageId`, the divergent-container refusal's envelope at the same seam),
 * that nothing is filed, and the controls the door must keep accepting.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';

const PKG = 'com.probe.pkg';
const OTHER = 'com.probe.other';

const set = (packageId?: string) => ({
    name: 'probe_set',
    label: 'Probe',
    objects: {},
    ...(packageId === undefined ? {} : { packageId }),
});

/** Register once; hand back what was thrown (if anything) and what was filed. */
function register(manifest: Record<string, unknown>): { error: any; filed: any } {
    const engine = new ObjectQL();
    let error: any;
    try {
        engine.registerApp(manifest as any);
    } catch (e) {
        error = e;
    }
    const filed = engine.registry.listItems('permission').find((i: any) => i?.name === 'probe_set');
    return { error, filed };
}

describe('[ADR-0086 D3] registerApp refuses a permission set whose body `packageId` is not its package', () => {
    it('a manifest set naming another package: VALIDATION_ERROR / 400 at `packageId`, and nothing filed', () => {
        const { error, filed } = register({ id: PKG, name: 'probe', permissions: [set(OTHER)] });
        expect(error, 'the registration must be refused').toBeInstanceOf(Error);
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(error.issues).toEqual([expect.objectContaining({ path: 'packageId', code: 'custom' })]);
        expect(error.message.indexOf("Drop `packageId` from permission set 'probe_set'")).toBe(0);
        expect(error.message).toContain(`under package '${PKG}'`);
        expect(filed, 'refused before the set is filed').toBeUndefined();
    });

    it('a nested plugin\'s set is judged against the parent package it registers under', () => {
        const { error, filed } = register({ id: PKG, name: 'probe', plugins: [{ name: 'nested', permissions: [set(OTHER)] }] });
        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400 });
        expect(filed).toBeUndefined();
    });

    it('a manifest with no id registers its sets into no package: any key is refused, the empty string included', () => {
        for (const declared of [OTHER, '']) {
            const { error, filed } = register({ permissions: [set(declared)] });
            expect(error, `packageId '${declared}'`).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            expect(error.message).toContain('registered into no package');
            expect(filed).toBeUndefined();
        }
    });

    it('CONTROL: a key equal to the package, and an absent key, register under the package as before', () => {
        for (const declared of [PKG, undefined]) {
            const { error, filed } = register({ id: PKG, name: 'probe', permissions: [set(declared)] });
            expect(error, `packageId ${String(declared)}`).toBeUndefined();
            expect(filed).toMatchObject({ name: 'probe_set', _packageId: PKG });
        }
        // An unbound manifest's set with no key is an ordinary unowned set.
        const unbound = register({ permissions: [set()] });
        expect(unbound.error).toBeUndefined();
        expect(unbound.filed).toMatchObject({ name: 'probe_set' });
        expect(unbound.filed._packageId).toBeUndefined();
    });
});
