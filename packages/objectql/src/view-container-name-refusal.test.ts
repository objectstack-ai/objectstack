// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20331] `viewContainerNameRefusal` — the ONE judge of a divergent
 * view-container `name`, and proof that the boot registrar throws exactly what
 * it returns.
 *
 * The refusal used to be written inline in `registerMetadataCollections`, so
 * `os validate` had nothing to call and passed (exit 0) a document `os serve`
 * refused at boot. The judgment moved to its own module unchanged; the boot
 * loop throws what it returns, and the CLI reports it
 * (`packages/cli/test/validate-view-container-name.test.ts`).
 *
 * What the boot loop itself does with this document — refuse, register
 * nothing, envelope equal to the artifact/HMR door's — stays pinned where it
 * always was, in `view-container-divergent-name-registrars.test.ts`. This file
 * pins the other half: that the shared function IS the boot loop's answer, at
 * both of its seams, so a second door calling it gets the same words.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';
import { viewContainerNameRefusal } from './view-container-name-refusal';

const PKG = 'com.acme.crm';

/** The row's own `name` is NOT the object it binds to. */
const divergent = {
    name: 'lead_views',
    object: 'crm_lead',
    list: { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] },
};

/** Drive the boot registrar once and hand back what it threw, if anything. */
function bootRefusal(manifest: Record<string, unknown>): any {
    try {
        new ObjectQL().registerApp({ id: PKG, name: 'crm', ...manifest } as any);
    } catch (e) {
        return e;
    }
    return undefined;
}

describe('#20331 — viewContainerNameRefusal is the boot registrar\'s judgment', () => {
    it('refuses a container whose own `name` disagrees with its derived key, in the ADR-0112 envelope', () => {
        const refusal = viewContainerNameRefusal(divergent, 'manifest', PKG);
        expect(refusal).toBeInstanceOf(Error);
        expect(refusal?.code).toBe('VALIDATION_ERROR');
        expect(refusal?.status).toBe(400);
        expect(refusal?.httpStatus).toBe(400);
        // Both values named, and the source it came from — what makes the
        // diagnostic locate the mismatch rather than merely report one.
        expect(refusal?.message).toContain("`name` is 'lead_views'");
        expect(refusal?.message).toContain("binds to, 'crm_lead'");
        expect(refusal?.message).toContain(`from manifest '${PKG}'`);
    });

    it('the manifest seam throws exactly what the function returns for the same document', () => {
        const thrown = bootRefusal({ views: [divergent] });
        const returned = viewContainerNameRefusal(divergent, 'manifest', PKG);
        expect(thrown).toBeInstanceOf(Error);
        expect(returned).toBeDefined();
        expect(thrown.message).toBe(returned!.message);
        expect(thrown.code).toBe(returned!.code);
        expect(thrown.status).toBe(returned!.status);
        expect(thrown.httpStatus).toBe(returned!.httpStatus);
    });

    it('…and so does the nested-plugin seam, under its own source label and the parent\'s id', () => {
        // `registerPlugin` runs the SAME `registerMetadataCollections` body with
        // the label `nested plugin` and the parent package as owner, so the one
        // judge answers for both seams.
        const thrown = bootRefusal({ plugins: [{ name: 'crm-extras', views: [divergent] }] });
        const returned = viewContainerNameRefusal(divergent, 'nested plugin', PKG);
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toBe(returned!.message);
        expect(thrown.message).toContain(`from nested plugin '${PKG}'`);
        expect(thrown.code).toBe('VALIDATION_ERROR');
    });

    // ------------------------------------------------------------------
    // Controls — each is a document the boot loop registers, so the judge
    // must answer "nothing" for it. A judge that refused them would turn a
    // valid stack into a boot failure at both doors at once.
    // ------------------------------------------------------------------

    it('CONTROL: a container with no `name` is not refused, and boot registers it', () => {
        const { name: _drop, ...anonymous } = divergent;
        expect(viewContainerNameRefusal(anonymous, 'manifest', PKG)).toBeUndefined();
        expect(bootRefusal({ views: [anonymous] })).toBeUndefined();
    });

    it('CONTROL: a container whose `name` equals its bound object is not refused', () => {
        const agreeing = { ...divergent, name: 'crm_lead' };
        expect(viewContainerNameRefusal(agreeing, 'manifest', PKG)).toBeUndefined();
        expect(bootRefusal({ views: [agreeing] })).toBeUndefined();
    });

    it('CONTROL: a container declaring no binding but its `name` cannot disagree with itself', () => {
        const nameOnly = { name: 'lead_views', list: { type: 'grid', columns: [{ field: 'name' }] } };
        expect(viewContainerNameRefusal(nameOnly, 'manifest', PKG)).toBeUndefined();
        expect(bootRefusal({ views: [nameOnly] })).toBeUndefined();
    });

    it('CONTROL: a non-container entry keyed by its own `name` is not judged', () => {
        // Not an aggregated container (`viewKind` set), so its `name` is its
        // identity and there is no binding for it to disagree with.
        const item = { name: 'crm_lead.hot', object: 'crm_lead', viewKind: 'list', config: { type: 'grid' } };
        expect(viewContainerNameRefusal(item, 'manifest', PKG)).toBeUndefined();
        // Nor is anything that is not an object at all.
        expect(viewContainerNameRefusal(undefined, 'manifest', PKG)).toBeUndefined();
        expect(viewContainerNameRefusal('crm_lead', 'manifest', PKG)).toBeUndefined();
    });

    it('CONTROL: an empty-string `name` is treated as absent, as boot treats it', () => {
        const blank = { ...divergent, name: '' };
        expect(viewContainerNameRefusal(blank, 'manifest', PKG)).toBeUndefined();
        expect(bootRefusal({ views: [blank] })).toBeUndefined();
    });
});
