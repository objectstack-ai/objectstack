// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14399] Where the row's own `name` sits in the view-container
 * object-derivation chain — pinned at BOTH SOURCE registrars.
 *
 * ---------------------------------------------------------------------------
 * The divergence
 * ---------------------------------------------------------------------------
 * Three sites derive "which object does an aggregated `defineView` container
 * bind to", and after #13407 / #13913 / #13912 all three read the container's
 * own top-level `object` before the `list.data.object` chain. They still
 * disagreed about the row's own `name`:
 *
 *   - `engine.ts` `resolveMetadataItemName('views', item)` — the ObjectQL boot
 *     loop, a SOURCE registrar: `name` → `id` → `object` → `list.data.object`
 *     → `form.data.object`. **`name` FIRST.**
 *   - `deriveViewContainerObject` (`@objectstack/metadata`) — used by the
 *     artifact/HMR SOURCE registrar and by `getViewsByObject()`: `object` →
 *     `list.data.object` → `form.data.object` → `name`. **`name` LAST.**
 *   - `expandRuntimeViewContainer` (`@objectstack/metadata-protocol`) — the
 *     runtime door: same order as the second.
 *
 * For the ordinary container the two values agree and nothing differs. They
 * differ for `{ name: 'lead_views', object: 'crm_lead', list: {…} }`, and the
 * 2026-08-07 meta-rule settles which order survives rather than taste: one
 * operation with two inconsistent implementations, the side bound by a
 * DECLARATION wins. `ViewSchema.object`'s own `.describe()` names its readers
 * ("read by `getViewsByObject()` / `GET /meta/view?object=`"); the boot loop's
 * order argued from item identity, which declares nothing about the binding. So
 * the boot loop adopted `deriveViewContainerObject` — by import. The two sites
 * that already held the winning order were not touched.
 *
 * ---------------------------------------------------------------------------
 * ⭐ MEASURED CORRECTION to the card's reachable-divergence walk-through
 * ---------------------------------------------------------------------------
 * The card predicted that the artifact/HMR registrar "derives `crm_lead` and
 * mints `crm_lead.default`, registering the container under `crm_lead`", i.e.
 * two SILENT keys for one document. Measured on `origin/main` `937ec142d`, the
 * second half of that is false and the divergence is sharper than reported:
 *
 *   - the boot loop registered it under `lead_views`, silently;
 *   - the artifact door derives `crm_lead` correctly and then **refuses the
 *     whole artifact load, loudly** — `assertMetadataRegisterContract` (#7378
 *     row 1) rejects `register('view', 'crm_lead')` because the document's own
 *     `data.name` is still `'lead_views'`. `VALIDATION_ERROR` / 400.
 *
 * The boot loop reconciles that field (`toRegister = { …item, name: itemName }`)
 * and the artifact door does not, so the same document is silently mis-keyed by
 * one registrar and a hard boot failure through the other. That residual
 * asymmetry is a SEPARATE defect at a separate site and is filed as its own
 * card; what belongs here is the derivation, and both sites are pinned on it
 * below — the artifact door's refusal message names the key it derived, which
 * is direct evidence of its answer.
 *
 * ---------------------------------------------------------------------------
 * Why this file drives BOTH registrars rather than pinning one
 * ---------------------------------------------------------------------------
 * The card's sharpest observation is that NO fixture anywhere in the repo sets
 * a container `name` that differs from its bound object, so the divergence was
 * un-rehearsed in BOTH directions: each registrar was individually green on
 * every shape it had ever been shown, and the correction above is what a
 * one-sided pin would still have missed. `@objectstack/objectql` already
 * declares `@objectstack/metadata` as a dependency (and the reverse edge does
 * not exist), which is what lets one file hold both.
 *
 * Refs: #14399, #13912 (`plugin-artifact-view-container-object.test.ts` — the
 * artifact door's own-`object` pin this extends), #13913, #13407, #7378, #7163.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine';
import { isAggregatedViewContainer } from '@objectstack/spec';
import { MetadataPlugin, deriveViewContainerObject } from '@objectstack/metadata';

const PKG = 'com.acme.crm';
const MANIFEST = { id: PKG, name: 'CRM', version: '1.0.0', type: 'app' };

/**
 * The card's shape: the row's own `name` is NOT the object it binds to.
 *
 * No view arm carries `data` at all — the same arrangement
 * `plugin-artifact-view-container-object.test.ts` measured as the only one the
 * artifact door's strict parse admits with no `data.object` anywhere, so this
 * one fixture passes BOTH doors and the two registrars are answering about
 * literally the same document.
 */
const divergentContainer = {
    name: 'lead_views',
    object: 'crm_lead',
    list: { label: 'All Leads', type: 'grid', columns: [{ field: 'name' }] },
    listViews: { hot: { label: 'Hot Leads', type: 'grid', columns: [{ field: 'name' }] } },
};

/** The same container with its identity field omitted — the shape that has a
 *  `name`/`object` disagreement to make, and does not make one. */
const anonymousContainer = (() => {
    const { name: _drop, ...rest } = divergentContainer;
    return rest;
})();

/** Every key either registrar could plausibly mint for these containers. */
const CANDIDATE_KEYS = [
    'crm_lead',
    'crm_lead.default',
    'crm_lead.hot',
    'lead_views',
    'lead_views.default',
    'lead_views.hot',
];

/** The one answer: keyed by the DECLARED binding, expansion included. */
const AGREED_KEYS = ['crm_lead', 'crm_lead.default', 'crm_lead.hot'];

// ---------------------------------------------------------------------------
// Registrar A — the ObjectQL boot loop (`registerMetadataCollections`).
// ---------------------------------------------------------------------------

function bootRegistrarKeys(container: unknown): string[] {
    const engine = new ObjectQL();
    engine.registerApp({ id: PKG, name: 'crm', views: [container] } as any);
    return CANDIDATE_KEYS.filter((k) => engine.registry.getItem('view', k) !== undefined);
}

// ---------------------------------------------------------------------------
// Registrar B — the metadata artifact/HMR door (`_parseAndRegisterArtifact`),
// driven exactly as its own #13912 pin drives it.
// ---------------------------------------------------------------------------

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

async function loadThroughArtifactDoor(container: unknown): Promise<any> {
    const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } }) as any;
    // Fresh deep copy — the door mutates items in place (`applyProtection`).
    const definition = JSON.parse(JSON.stringify({ manifest: MANIFEST, views: [container] }));
    await plugin._parseAndRegisterArtifact(fakeCtx(), definition, 'fixture-14399');
    return plugin;
}

async function artifactRegistrarKeys(container: unknown): Promise<string[]> {
    const plugin = await loadThroughArtifactDoor(container);
    const found: string[] = [];
    for (const k of CANDIDATE_KEYS) {
        if (await plugin.manager.get('view', k)) found.push(k);
    }
    return found;
}

describe('#14399 — the row\'s own `name` is the LAST term of the container derivation, at every SOURCE registrar', () => {
    it('the fixture is the divergent shape (premise guard)', () => {
        // If a later edit makes `name` equal `object`, or drops one of them, the
        // cases below stop testing this defect and start passing trivially: the
        // two orders only differ when both fields exist and disagree.
        expect(divergentContainer.name).not.toBe(divergentContainer.object);
        expect(isAggregatedViewContainer(divergentContainer)).toBe(true);
        expect(JSON.stringify(divergentContainer)).not.toContain('"data"');
        // ...and the shared derivation really does prefer the declared binding.
        expect(deriveViewContainerObject(divergentContainer)).toBe('crm_lead');
    });

    it('THE PIN: the boot loop keys the container by its declared `object`, not by its own `name`', () => {
        // Pre-fix this was exactly ['lead_views', 'lead_views.default',
        // 'lead_views.hot'] — the container and its whole expansion filed under
        // the row identity, so `getViewsByObject('crm_lead')` and
        // `GET /meta/view?object=crm_lead` had nothing for this document.
        expect(bootRegistrarKeys(divergentContainer)).toEqual(AGREED_KEYS);
    });

    it('and the artifact/HMR registrar derives the SAME binding for the same document', async () => {
        // The second SOURCE registrar's answer, read from the one place it is
        // observable on this shape: its refusal names the key it derived.
        // `toEqual(AGREED_KEYS)` above would also be satisfied by both sides
        // moving to `lead_views`, so the agreed VALUE is pinned at both.
        const err = await loadThroughArtifactDoor(divergentContainer).catch((e) => e as any);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("register('view', 'crm_lead')");
        expect(err.message).toContain("data.name is 'lead_views'");
    });

    it('MEASURED CORRECTION: the artifact door does not silently mis-key it — it refuses, enveloped (#7378 row 1)', async () => {
        // The card predicted a second SILENT key here. Measured: the door
        // derives `crm_lead`, then `assertMetadataRegisterContract` refuses the
        // whole artifact load because the document's own `data.name` still says
        // `lead_views`. Asserting the ADR-0112 envelope, not merely "it threw":
        // a bare `toThrow()` would stay green on any unrelated failure.
        const err = await loadThroughArtifactDoor(divergentContainer).catch((e) => e as any);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        // The residual asymmetry, stated as an assertion so it cannot drift
        // unnoticed: the boot loop reconciles `data.name` to the derived key and
        // this door does not. Filed separately; #14399 owns the derivation only.
        const engine = new ObjectQL();
        engine.registerApp({ id: PKG, name: 'crm', views: [divergentContainer] } as any);
        expect((engine.registry.getItem('view', 'crm_lead') as any).name).toBe('crm_lead');
    });

    it('so the boot loop\'s expanded items are addressable under the object', () => {
        const engine = new ObjectQL();
        engine.registerApp({ id: PKG, name: 'crm', views: [divergentContainer] } as any);
        const bound = (engine.registry.listItems<any>('view') ?? [])
            .filter((v: any) => v?.viewKind)
            .map((v: any) => v.object);
        expect(bound.length).toBeGreaterThan(0);
        // The card's symptom: these used to bind to `lead_views`.
        expect([...new Set(bound)]).toEqual(['crm_lead']);
    });

    // ------------------------------------------------------------------
    // Controls — green in BOTH directions. The repair moves the CONTAINER
    // branch only; anything that keys by its own identity must not move.
    // ------------------------------------------------------------------

    it('CONTROL: with no `name` to disagree, both registrars mint exactly the same keys', async () => {
        // The cross-registrar agreement the card asked for, on the shape that
        // can actually reach both stores. Green before and after — the point is
        // that the repair does not move it.
        expect(bootRegistrarKeys(anonymousContainer)).toEqual(AGREED_KEYS);
        expect(await artifactRegistrarKeys(anonymousContainer)).toEqual(AGREED_KEYS);
    });

    it('CONTROL: a container whose `name` already equals its `object` is unchanged', async () => {
        const agreeing = { ...divergentContainer, name: 'crm_lead' };
        expect(bootRegistrarKeys(agreeing)).toEqual(AGREED_KEYS);
        expect(await artifactRegistrarKeys(agreeing)).toEqual(AGREED_KEYS);
    });

    it('CONTROL: a container with no `object` anywhere still keys by its own `name`', () => {
        // `name` did not stop being consulted — it moved to LAST. A container
        // that declares no binding anywhere else is still registered, under the
        // only identity it has.
        const nameOnly = {
            name: 'lead_views',
            list: { label: 'All', type: 'grid', columns: [{ field: 'name' }] },
        };
        expect(bootRegistrarKeys(nameOnly)).toEqual(['lead_views', 'lead_views.default']);
    });

    it('CONTROL: a standalone ViewItem still keys by its own `name`, not its `object`', () => {
        // The `viewItems:` channel carries NON-container artifacts (every member
        // of `AssembledViewArtifactSchema` requires `viewKind`, so
        // `isAggregatedViewContainer` is false for all of them). Their `name` is
        // their identity, not a binding, and it must still be read FIRST — this
        // is the regression the change would cause if the container branch were
        // not gated on `isAggregatedViewContainer`.
        const engine = new ObjectQL();
        engine.registerApp({
            id: PKG,
            name: 'crm',
            viewItems: [{
                name: 'crm_lead.hot',
                object: 'crm_lead',
                viewKind: 'list',
                config: { type: 'grid', columns: [{ field: 'name' }] },
            }],
        } as any);
        expect(engine.registry.getItem('view', 'crm_lead.hot')).toBeDefined();
        expect(engine.registry.getItem('view', 'crm_lead')).toBeUndefined();
    });
});
