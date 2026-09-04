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
 * and the artifact door does not, so the same document was silently mis-keyed
 * by one registrar and a hard boot failure through the other.
 *
 * ---------------------------------------------------------------------------
 * ⭐ [#14666] That residual asymmetry is CLOSED, and this file inverted with it
 * ---------------------------------------------------------------------------
 * The asymmetry above was filed as its own card and ruled on 2026-09-03
 * (direction 2, maintainer, via the director seat): the boot loop's SOURCE
 * registrar REFUSES a container whose `name` is set and differs from the key
 * derived from `object` (or `type`) — the same refusal the artifact/HMR door
 * already raised, naming both values — and stops rewriting `name` silently.
 * Directions 1 (make the artifact door rewrite too, reversing #7378 row 1) and
 * 3 (forbid `ViewSchema.name` on object-scoped containers in spec) were
 * refused.
 *
 * ⚠️ So the pins below changed MEANING, not just expectations, and a reader
 * arriving from #14399 should know which is which. What this file pinned
 * before was *what each door did*; nothing in it asserted which was right, and
 * the card warned that "an implementer who reads a green suite as agreement
 * will be misled". Two boot-loop assertions inverted — they are marked ⭐ in
 * place, each carrying what it used to read. The artifact door's pins did NOT
 * move; the ruling says they stay, and they are now also the reference the
 * boot loop's refusal envelope is asserted EQUAL to.
 *
 * The derivation #14399 owns is not lost by that inversion: at both SOURCE
 * registrars it is now read the same way — the refusal names the key it
 * derived, which is direct evidence of its answer.
 *
 * Scope was the ruling's named main risk ("keeping that scope tight is the
 * implementation's main risk"), so the CONTROLS carry the weight here: a
 * container with no `name`, one whose `name` already agrees, one that declares
 * no binding at all, a standalone ViewItem, a non-`views` metadata kind, and
 * the assembled `viewItems:` channel must all be untouched, and each has a
 * case below.
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
import { isAggregatedViewContainer, AssembledViewArtifactSchema } from '@objectstack/spec';
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

/**
 * Drive the boot loop once and report BOTH outcomes — the keys it minted and
 * the refusal it raised, if any.
 *
 * [#14666] Split out of `bootRegistrarKeys` because the divergent container is
 * now REFUSED here, and "what did it register before it threw?" became a
 * question worth asking: a refusal that has already filed half the document is
 * not a refusal. Every caller that expects registration keeps using
 * `bootRegistrarKeys`, which re-throws — so a control that starts refusing
 * fails loudly, carrying the refusal's own message, instead of silently
 * reading an empty registry.
 */
function bootRegistrar(container: unknown): { keys: string[]; error: any } {
    const engine = new ObjectQL();
    let error: any = null;
    try {
        engine.registerApp({ id: PKG, name: 'crm', views: [container] } as any);
    } catch (e) {
        error = e;
    }
    return {
        keys: CANDIDATE_KEYS.filter((k) => engine.registry.getItem('view', k) !== undefined),
        error,
    };
}

function bootRegistrarKeys(container: unknown): string[] {
    const { keys, error } = bootRegistrar(container);
    if (error) throw error;
    return keys;
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

    it('THE PIN (#14666): the boot loop REFUSES the divergent container, and its refusal names the key it derived', () => {
        // ⭐ THIS ASSERTION IS THE INVERSION. Its two earlier lives, in order:
        //   * before #14399 the boot loop minted ['lead_views',
        //     'lead_views.default', 'lead_views.hot'] — the container and its
        //     whole expansion filed under the row identity, so
        //     `getViewsByObject('crm_lead')` had nothing for this document;
        //   * #14399 moved `name` to LAST in the derivation, so it minted
        //     AGREED_KEYS instead — the right key, but with the author's
        //     `name` silently overwritten on the way past.
        // The #14666 ruling (direction 2, 2026-09-03) ends the second: a
        // container whose `name` disagrees with its derived binding is
        // REFUSED, exactly as the artifact/HMR door has always refused it.
        //
        // #14399's derivation answer is NOT lost by inverting this — it moves
        // to where the artifact door's answer was already read in this file:
        // the refusal names the key it derived. Both SOURCE registrars are now
        // read the same way, which is the convergence the card asked for.
        const { keys, error } = bootRegistrar(divergentContainer);
        expect(error).toBeInstanceOf(Error);
        // Both values named — the ruling's requirement, and what makes the
        // diagnostic locate the mismatch instead of merely reporting one.
        expect(error.message).toContain("`name` is 'lead_views'");
        expect(error.message).toContain("'crm_lead'");
        // The derivation itself, still pinned: `crm_lead` is what it derived,
        // NOT the row's own `lead_views`. A refusal naming `lead_views` as the
        // derived key would mean #14399 had regressed.
        expect(error.message).toContain("binds to, 'crm_lead'");
        // Nothing filed: a refusal that has already registered half the
        // document would leave the registry in the state the card calls the
        // real defect.
        expect(keys).toEqual([]);
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
        // ⭐ [#14666] THE SECOND INVERSION, and the card's actual subject. This
        // used to read
        //
        //     expect((engine.registry.getItem('view', 'crm_lead') as any).name)
        //         .toBe('crm_lead');
        //
        // i.e. it pinned the boot loop SILENTLY rewriting the author's
        // `lead_views` to the derived key while this door hard-failed — one
        // document, two SOURCE registrars, opposite outcomes. Ruled
        // (2026-09-03, direction 2): the boot loop converges onto the refusal.
        // So the assertion is now CONVERGENCE, envelope included — if either
        // door ever moves again, this fails.
        const boot = bootRegistrar(divergentContainer);
        expect(boot.error).toBeInstanceOf(Error);
        expect(boot.error.code).toBe(err.code);
        expect(boot.error.status).toBe(err.status);
        expect(boot.error.code).toBe('VALIDATION_ERROR');
        expect(boot.error.status).toBe(400);
    });

    it('so the boot loop\'s expanded items are addressable under the object', () => {
        // [#14666] Driven on the ANONYMOUS container now. The expansion
        // property this pins — expanded items bind to the derived object, not
        // to the container's row identity — is unchanged, but the divergent
        // shape no longer reaches expansion at all: it is refused before
        // anything registers, which is what the two tests above assert. The
        // shape that still travels this path is the one carrying no `name`,
        // and it is the shape the ruling explicitly leaves unaffected.
        const engine = new ObjectQL();
        engine.registerApp({ id: PKG, name: 'crm', views: [anonymousContainer] } as any);
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

    // ------------------------------------------------------------------
    // [#14666] Scope controls. The ruling names keeping the refusal's scope
    // tight as the implementation's MAIN RISK, and `registerMetadataCollections`
    // is the GENERIC loop every metadata kind runs — so the three narrowings in
    // the gate get a control each, plus the measurement that decided which of
    // the method's two `toRegister` ternaries had to move.
    // ------------------------------------------------------------------

    it('SCOPE: a NON-`views` metadata kind is untouched, even carrying a container-shaped body', () => {
        // Guards the gate's `key === 'views'` term. This loop serves objects,
        // apps, roles, agents, … — a refusal leaking out of the `views` branch
        // would turn a divergent `name` into a boot failure for every one of
        // them, which is exactly what the ruling forbids.
        const engine = new ObjectQL();
        engine.registerApp({
            id: PKG,
            name: 'crm',
            objects: [{ name: 'crm_lead', object: 'something_else', label: 'Lead' }],
        } as any);
        expect(engine.registry.getItem('object', 'crm_lead')).toBeDefined();
    });

    it('SCOPE: a non-container `views:` entry keyed by its own `name` is untouched, `object` notwithstanding', () => {
        // Guards the gate's `isAggregatedViewContainer(item)` term. This entry
        // carries BOTH a `name` and an `object` that disagree textually, and it
        // must still register under its own `name`: it is not a container, so
        // its `name` is its identity and `resolveMetadataItemName` reads it
        // FIRST — there is no binding for it to disagree with.
        const engine = new ObjectQL();
        engine.registerApp({
            id: PKG,
            name: 'crm',
            views: [{ name: 'solo', object: 'crm_lead' }],
        } as any);
        expect(engine.registry.getItem('view', 'solo')).toBeDefined();
        expect(engine.registry.getItem('view', 'crm_lead')).toBeUndefined();
    });

    it('SCOPE: the assembled `viewItems:` channel cannot carry a container, so its own `toRegister` was left alone', () => {
        // ⭐ The measurement that scoped this change to ONE of the two
        // identical-looking `toRegister` ternaries in
        // `registerMetadataCollections`. The second one (the `viewItems:`
        // channel) rewrites `body.name` the same way and was NOT touched,
        // because a view CONTAINER cannot reach it: `AssembledViewArtifactSchema`
        // is the view vocabulary MINUS the container branch, and every body it
        // admits carries a `viewKind`, which makes `isAggregatedViewContainer`
        // false by definition. Its ternary can therefore only MINT a name onto
        // an overlay that has none — never discard an authored one, which is
        // the thing #7378 row 1 refuses.
        //
        // Pinned here so that a later hand cannot make either mistake the
        // ruling's scope constraint warns about: copying the refusal onto a
        // site that has nothing to refuse, or widening this channel to accept
        // containers and quietly restoring the silent rewrite.
        expect(AssembledViewArtifactSchema.safeParse(divergentContainer).success).toBe(false);
        expect(isAggregatedViewContainer(divergentContainer)).toBe(true);
        const overlay = {
            name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list',
            type: 'grid', columns: [{ field: 'name' }],
        };
        const parsed = AssembledViewArtifactSchema.safeParse(overlay);
        expect(parsed.success).toBe(true);
        expect(isAggregatedViewContainer(parsed.success ? parsed.data : undefined)).toBe(false);
    });
});
