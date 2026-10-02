// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21412 — the divergent view-container `name` refusal, as ONE judge with two
 * entries: the source registrars' (the key is DERIVED from the binding) and
 * the runtime save door's (the key is the name the row is SAVED under).
 *
 * The boot registrar's and `os validate`'s use of the derived entry stays
 * pinned where it always was (`packages/objectql`'s
 * `view-container-name-refusal.test.ts`, `packages/cli`'s
 * `validate-view-container-name.test.ts`), unedited: their words did not move.
 * The save door's use is pinned at the door, in `packages/metadata-protocol`'s
 * `view-container-runtime-expansion.test.ts`. This file pins the judge's two
 * predicates against each other on the shapes that tell them apart, and the
 * artifact/HMR door's container branch, which lives in this package.
 *
 * Shapes, named as the card's measurement named them (row = the save name):
 *   P1 row crm_lead, body `name` lead_views, bound to crm_lead — both refuse;
 *   P2 row lead_views, body `name` lead_views, bound to crm_lead — the derived
 *      entry refuses, the save door must NOT (#13407 keeps such a container,
 *      #21334 expands one under its own name);
 *   P3 row lead_views, body `name` crm_lead, bound to crm_lead — the derived
 *      entry passes, the save door must refuse;
 *   P4 row crm_lead, body `name` lead_views, no other binding — the derived
 *      entry passes (the binding falls back to `name`), the save door must
 *      refuse.
 */

import { describe, it, expect, vi } from 'vitest';
import { savedViewContainerNameRefusal, viewContainerNameRefusal } from './view-container-name.js';
import { MetadataPlugin } from './plugin.js';

const PKG = 'com.acme.crm';

const listArm = { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] };
/** Bound to crm_lead through its own `object`, with no `data` on any arm. */
const boundBody = (name?: string) => ({ ...(name === undefined ? {} : { name }), object: 'crm_lead', list: listArm });
/** No binding but its own `name`. */
const nameOnlyBody = (name: string) => ({ name, list: listArm });

/** The minimum a rejection pin asserts: the ADR-0112 envelope, not "it threw". */
function expectEnvelope(refusal: unknown): void {
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as any).code).toBe('VALIDATION_ERROR');
    expect((refusal as any).status).toBe(400);
    expect((refusal as any).httpStatus).toBe(400);
}

describe('#21412 — the save door\'s entry judges the name the row is saved under', () => {
    it('P1: a body `name` that is neither the row nor the binding is refused, naming both values', () => {
        const refusal = savedViewContainerNameRefusal(boundBody('lead_views'), 'crm_lead');
        expectEnvelope(refusal);
        expect(refusal!.message).toContain("'lead_views'");
        expect(refusal!.message).toContain("'crm_lead'");
    });

    it('P3: a body `name` equal to the binding but not to the row is refused', () => {
        expectEnvelope(savedViewContainerNameRefusal(boundBody('crm_lead'), 'lead_views'));
    });

    it('P4: a body `name` that is the only binding, but not the row, is refused', () => {
        expectEnvelope(savedViewContainerNameRefusal(nameOnlyBody('lead_views'), 'crm_lead'));
    });

    it('P2: a body `name` equal to the row passes, though the container binds elsewhere', () => {
        expect(savedViewContainerNameRefusal(boundBody('lead_views'), 'lead_views')).toBeUndefined();
    });

    it('an absent, empty or non-string `name` refuses nothing — the door stamps or the schema judges it', () => {
        expect(savedViewContainerNameRefusal(boundBody(), 'lead_views')).toBeUndefined();
        expect(savedViewContainerNameRefusal(boundBody(''), 'lead_views')).toBeUndefined();
        expect(savedViewContainerNameRefusal({ ...boundBody(), name: 7 }, 'lead_views')).toBeUndefined();
    });

    it('SCOPE: a standalone ViewItem is not judged here — the every-type half is #21470', () => {
        const record = { name: 'crm_lead.other', object: 'crm_lead', viewKind: 'list', list: listArm };
        expect(savedViewContainerNameRefusal(record, 'crm_lead.mine')).toBeUndefined();
        expect(savedViewContainerNameRefusal({ name: 'b', label: 'not a container' }, 'a')).toBeUndefined();
    });
});

describe('#21412 — the two entries are one judgement keyed differently, not two rules', () => {
    it('on P1 both entries refuse, in one envelope', () => {
        const derived = viewContainerNameRefusal(boundBody('lead_views'), 'manifest', PKG);
        const saved = savedViewContainerNameRefusal(boundBody('lead_views'), 'crm_lead');
        expectEnvelope(derived);
        expectEnvelope(saved);
    });

    it('they part exactly where the derived key and the save name part (P2, P3, P4)', () => {
        // P2: derived refuses (the name is not the binding); saved passes.
        expectEnvelope(viewContainerNameRefusal(boundBody('lead_views'), 'manifest', PKG));
        expect(savedViewContainerNameRefusal(boundBody('lead_views'), 'lead_views')).toBeUndefined();
        // P3: derived passes (the name IS the binding); saved refuses.
        expect(viewContainerNameRefusal(boundBody('crm_lead'), 'manifest', PKG)).toBeUndefined();
        expectEnvelope(savedViewContainerNameRefusal(boundBody('crm_lead'), 'lead_views'));
        // P4: derived passes (the binding falls back to the name); saved refuses.
        expect(viewContainerNameRefusal(nameOnlyBody('lead_views'), 'manifest', PKG)).toBeUndefined();
        expectEnvelope(savedViewContainerNameRefusal(nameOnlyBody('lead_views'), 'crm_lead'));
    });

    it('the derived entry keeps boot\'s precondition: a falsy derived key refuses nothing', () => {
        // `deriveViewContainerObject`'s `??` chain keeps an empty string, and
        // boot warns and skips such an entry instead of refusing it.
        const emptyBinding = { name: 'x', list: { ...listArm, data: { provider: 'object', object: '' } } };
        expect(viewContainerNameRefusal(emptyBinding, 'manifest', PKG)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// The artifact/HMR door's container branch, driven as its own #13912 pin
// drives it (`plugin-artifact-view-container-object.test.ts`).
// ---------------------------------------------------------------------------

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

async function loadThroughArtifactDoor(container: unknown): Promise<{ plugin: any; error: any }> {
    const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } }) as any;
    const definition = JSON.parse(JSON.stringify({
        manifest: { id: PKG, name: 'CRM', version: '1.0.0', type: 'app' },
        views: [container],
    }));
    let error: any = null;
    try {
        await plugin._parseAndRegisterArtifact(fakeCtx(), definition, 'fixture-21412');
    } catch (e) {
        error = e;
    }
    return { plugin, error };
}

describe('#21412 — the artifact/HMR door\'s container branch refuses through the judge', () => {
    it('refuses the probe document with the judge\'s refusal, and files nothing', async () => {
        const { plugin, error } = await loadThroughArtifactDoor(boundBody('lead_views'));
        expectEnvelope(error);
        // THROUGH the judge: the door throws what the derived entry returns
        // for the same document, word for word — not the generic register
        // contract's refusal (#7378 row 1), which this branch no longer reaches.
        expect(error.message).toBe(viewContainerNameRefusal(boundBody('lead_views'), 'artifact', PKG)!.message);
        expect(await plugin.manager.get('view', 'crm_lead')).toBeFalsy();
        expect(await plugin.manager.get('view', 'lead_views')).toBeFalsy();
        expect(await plugin.manager.get('view', 'crm_lead.default')).toBeFalsy();
    });

    it('CONTROL: an agreeing or absent `name` still registers under the derived key', async () => {
        for (const body of [boundBody('crm_lead'), boundBody()]) {
            const { plugin, error } = await loadThroughArtifactDoor(body);
            expect(error).toBeNull();
            expect(await plugin.manager.get('view', 'crm_lead')).toBeTruthy();
            expect(await plugin.manager.get('view', 'crm_lead.default')).toBeTruthy();
        }
    });
});
