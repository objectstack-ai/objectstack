// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21412, #21470 — the divergent `name` refusal, as ONE judge with two
 * entries: the source registrars' (the key is DERIVED from a view container's
 * binding) and the runtime write doors' (the key is the name the row is
 * written under, for every type).
 *
 * The boot registrar's and `os validate`'s use of the derived entry stays
 * pinned where it always was (`packages/objectql`'s
 * `view-container-name-refusal.test.ts`, `packages/cli`'s
 * `validate-view-container-name.test.ts`), unedited: their words did not move.
 * The write doors' use is pinned at the doors, in `packages/metadata-protocol`'s
 * `view-container-runtime-expansion.test.ts` (view containers) and
 * `protocol.item-name-every-door.test.ts` (every type, every write door). This file pins the judge's two
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
import { savedItemNameRefusal, viewContainerNameRefusal } from './view-container-name.js';
import { MetadataPlugin } from './plugin.js';

const PKG = 'com.acme.crm';

const listArm = { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] };
/** Bound to crm_lead through its own `object`, with no `data` on any arm. */
const boundBody = (name?: string) => ({ ...(name === undefined ? {} : { name }), object: 'crm_lead', list: listArm });
/** No binding but its own `name`. */
const nameOnlyBody = (name: string) => ({ name, list: listArm });
/** The save door's entry on a `view` body — the call `saveMetaItem` makes for one. */
const savedContainer = (body: unknown, saveName: string) => savedItemNameRefusal('view', body, saveName, 'save');

/** The minimum a rejection pin asserts: the ADR-0112 envelope, not "it threw". */
function expectEnvelope(refusal: unknown): void {
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as any).code).toBe('VALIDATION_ERROR');
    expect((refusal as any).status).toBe(400);
    expect((refusal as any).httpStatus).toBe(400);
}

describe('#21412 — the save door\'s entry judges the name the row is saved under', () => {
    it('P1: a body `name` that is neither the row nor the binding is refused, naming both values', () => {
        const refusal = savedContainer(boundBody('lead_views'), 'crm_lead');
        expectEnvelope(refusal);
        expect(refusal!.message).toContain("'lead_views'");
        expect(refusal!.message).toContain("'crm_lead'");
    });

    it('P3: a body `name` equal to the binding but not to the row is refused', () => {
        expectEnvelope(savedContainer(boundBody('crm_lead'), 'lead_views'));
    });

    it('P4: a body `name` that is the only binding, but not the row, is refused', () => {
        expectEnvelope(savedContainer(nameOnlyBody('lead_views'), 'crm_lead'));
    });

    it('P2: a body `name` equal to the row passes, though the container binds elsewhere', () => {
        expect(savedContainer(boundBody('lead_views'), 'lead_views')).toBeUndefined();
    });

    it('an absent, empty or non-string `name` refuses nothing — the door stamps or the schema judges it', () => {
        expect(savedContainer(boundBody(), 'lead_views')).toBeUndefined();
        expect(savedContainer(boundBody(''), 'lead_views')).toBeUndefined();
        expect(savedContainer({ ...boundBody(), name: 7 }, 'lead_views')).toBeUndefined();
    });

    it('SCOPE (flipped by #21470): a standalone ViewItem and any other view body are judged too', () => {
        const record = { name: 'crm_lead.other', object: 'crm_lead', viewKind: 'list', list: listArm };
        expectEnvelope(savedContainer(record, 'crm_lead.mine'));
        expectEnvelope(savedContainer({ name: 'b', label: 'not a container' }, 'a'));
        // …and the agreeing ones still pass.
        expect(savedContainer({ ...record, name: 'crm_lead.mine' }, 'crm_lead.mine')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// #21470 — the write-door entry judges EVERY type, at every write door.
// ---------------------------------------------------------------------------

describe('#21470 — the write-door entry judges every type', () => {
    const dash = (name?: unknown) => ({ ...(name === undefined ? {} : { name }), label: 'D', widgets: [] });

    it('P7: a dashboard whose `name` is not its row is refused, naming both values and the type', () => {
        const refusal = savedItemNameRefusal('dashboard', dash('dash_b'), 'dash_a', 'save');
        expectEnvelope(refusal);
        expect(refusal!.message).toContain("'dash_b'");
        expect(refusal!.message).toContain("'dash_a'");
        expect(refusal!.message.startsWith('Invalid dashboard: ')).toBe(true);
    });

    it('an equal or absent `name` passes at every door', () => {
        for (const door of ['save', 'restore', 'publish'] as const) {
            expect(savedItemNameRefusal('dashboard', dash('dash_a'), 'dash_a', door)).toBeUndefined();
            expect(savedItemNameRefusal('dashboard', dash(), 'dash_a', door)).toBeUndefined();
            expect(savedItemNameRefusal('view', boundBody(), 'crm_lead', door)).toBeUndefined();
        }
    });

    it('a body that is not a document is not this judge\'s (the door\'s own guards and the schema answer it)', () => {
        for (const body of [null, undefined, 'dash_b', ['dash_b'], 7]) {
            expect(savedItemNameRefusal('dashboard', body, 'dash_a', 'save')).toBeUndefined();
        }
    });

    it('row 1\'s predicate off the view stamp: an empty, null or non-string `name` is SET and refused', () => {
        // The registry keys a body by `String(name)` whatever it is, and a
        // `translation` schema accepts `name: ''` (measured), so none of these
        // may reach persistence under a row named otherwise.
        for (const name of ['', null, 7, false]) {
            expectEnvelope(savedItemNameRefusal('translation', { name, locale: 'zh-CN' }, 'crm_zh', 'save'));
            expectEnvelope(savedItemNameRefusal('dashboard', dash(name), 'dash_a', 'save'));
        }
    });

    it('the view stamp is the SAVE door\'s: a falsy view `name` passes there and is refused at restore and publish', () => {
        // `normalizeViewMetadata` stamps a falsy view `name` after the save
        // door's judge; the restore and publish doors stamp nothing.
        expect(savedItemNameRefusal('view', boundBody(''), 'crm_lead', 'save')).toBeUndefined();
        expectEnvelope(savedItemNameRefusal('view', boundBody(''), 'crm_lead', 'restore'));
        expectEnvelope(savedItemNameRefusal('view', boundBody(''), 'crm_lead', 'publish'));
    });

    it('the remedy is true per type: "drop `name`" only where the door stamps a missing one', () => {
        const view = savedItemNameRefusal('view', boundBody('lead_views'), 'crm_lead', 'save')!;
        expect(view.message.endsWith("Register under one name: drop `name`, or set it to 'crm_lead'.")).toBe(true);
        const other = savedItemNameRefusal('dashboard', dash('dash_b'), 'dash_a', 'save')!;
        expect(other.message.endsWith("Register under one name: set `name` to 'dash_a', or save the item under 'dash_b'.")).toBe(true);
        expect(other.message).not.toContain('drop `name`');
        // A `name` that is not a name offers only the direction that exists.
        const empty = savedItemNameRefusal('translation', { name: '', locale: 'zh-CN' }, 'crm_zh', 'save')!;
        expect(empty.message.endsWith("Register under one name: set `name` to 'crm_zh'.")).toBe(true);
    });

    it('a `field` is told to drop `name`: its row is named object.field, which a dot-free column `name` cannot spell', () => {
        // The field's canonical body carries its column name under a dotted row;
        // registered, the row would answer under the column name alone.
        const field = savedItemNameRefusal('field', { name: 'zz_probe', type: 'text' }, 'crm_task.zz_probe', 'save')!;
        expectEnvelope(field);
        expect(field.message).toContain('Register under one name: drop `name`');
        expect(field.message).not.toContain("set `name` to 'crm_task.zz_probe'");
        expect(savedItemNameRefusal('field', { type: 'text' }, 'crm_task.zz_probe', 'save')).toBeUndefined();
    });

    it('the restore and publish doors prescribe the save that fixes a body their caller cannot edit', () => {
        const restored = savedItemNameRefusal('dashboard', dash('dash_b'), 'dash_a', 'restore')!;
        expectEnvelope(restored);
        expect(restored.message).toContain('the name it is restored under');
        expect(restored.message).toContain("save the item with `name` set to 'dash_a', or under 'dash_b', instead of restoring this version");
        const published = savedItemNameRefusal('dashboard', dash('dash_b'), 'dash_a', 'publish')!;
        expectEnvelope(published);
        expect(published.message).toContain('the name it is published under');
        expect(published.message).toContain("save the draft again with `name` set to 'dash_a', or under 'dash_b', then publish it");
    });
});

describe('#21412 — the two entries are one judgement keyed differently, not two rules', () => {
    it('on P1 both entries refuse, in one envelope', () => {
        const derived = viewContainerNameRefusal(boundBody('lead_views'), 'manifest', PKG);
        const saved = savedContainer(boundBody('lead_views'), 'crm_lead');
        expectEnvelope(derived);
        expectEnvelope(saved);
    });

    it('they part exactly where the derived key and the save name part (P2, P3, P4)', () => {
        // P2: derived refuses (the name is not the binding); saved passes.
        expectEnvelope(viewContainerNameRefusal(boundBody('lead_views'), 'manifest', PKG));
        expect(savedContainer(boundBody('lead_views'), 'lead_views')).toBeUndefined();
        // P3: derived passes (the name IS the binding); saved refuses.
        expect(viewContainerNameRefusal(boundBody('crm_lead'), 'manifest', PKG)).toBeUndefined();
        expectEnvelope(savedContainer(boundBody('crm_lead'), 'lead_views'));
        // P4: derived passes (the binding falls back to the name); saved refuses.
        expect(viewContainerNameRefusal(nameOnlyBody('lead_views'), 'manifest', PKG)).toBeUndefined();
        expectEnvelope(savedContainer(nameOnlyBody('lead_views'), 'crm_lead'));
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
