// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14599 — the metadata artifact door attributed EVERY item of a multi-package
 * artifact to the artifact's own `manifest.id`.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `_parseAndRegisterArtifact` iterated the FLATTENED top level and stamped each
 * item with `metadata.manifest.id`. For an artifact composed with
 * `composeStacks(…, { manifest: 'preserve' })` that id is one arbitrary
 * member's — `selectManifest`'s `'last'` pick — so a two-package artifact
 * registered the module's object under the APP package's identity, while the
 * ObjectQL load path, reading the same artifact's `packages[]`, owned it under
 * the module's. The platform then held two answers to "who owns `crm_order`":
 * `GET /api/v1/meta/object` served the row TWICE (the list merge keys slots by
 * `${packageId}${name}`), `?package=<the app>` returned the module's object,
 * and the layers door and the item door named different owners.
 *
 * ---------------------------------------------------------------------------
 * What is driven, and why the fixture is composed rather than written out
 * ---------------------------------------------------------------------------
 * Every case goes through `_parseAndRegisterArtifact` — the real door, shared
 * by the boot load and the HMR reload — and the two-package fixture is built by
 * calling the real producer, `composeStacks(…, { manifest: 'preserve' })`, on
 * two ordinary `defineStack`-shaped inputs. A hand-written `packages[]` would
 * pin this door against a shape nothing emits; composing means the fixture
 * tracks the producer, so the day the producer half of #14512 lands (it stops
 * emitting the flattened top level for multi-package artifacts) these cases
 * keep asserting the same thing about the same bytes.
 *
 * The inputs mirror `examples/app-multi-package`, INCLUDING its two deliberate
 * properties: the module is listed FIRST (so array order is not what decides
 * registration order) and it declares `dependencies` on the app package (so
 * `resolveArtifactPackageOrder`'s topological sort is what does).
 *
 * ---------------------------------------------------------------------------
 * The D7 control
 * ---------------------------------------------------------------------------
 * `singlePackageRegisterSequence` is the whole of the single-`manifest`
 * branch's behaviour as a literal: every `manager.register` call, in order,
 * with the id and version each item was stamped with. ADR-0130 D7 is that this
 * branch did not move, and this literal is what would go red if it ever did.
 * It was recorded on both legs of the ablation in the PR body, from the same
 * fixture, and compared byte for byte.
 *
 * ---------------------------------------------------------------------------
 * The second describe block (#19246) — the same door, a different reading
 * ---------------------------------------------------------------------------
 * #19246 was filed on a STATIC reading, twice and independently: that a
 * multi-package artifact's top-level-only `docs` register nowhere at boot.
 * Both readings were correct about the two places they looked —
 * `resolveArtifactPackageOrder` does walk package bodies only, and
 * `AppPlugin` does not register `collections.docs` — and both concluded
 * "nowhere" without reaching this door, which is the registrar. Booting the
 * #18431 e2e fixture and asking `GET /api/v1/meta/doc` (the live surface)
 * showed the doc PRESENT, beside a per-package doc as the lit control. The
 * block at the foot of this file is that measurement made permanent, so the
 * next reader of those two files finds a pin instead of a third reading.
 */

import { describe, it, expect, vi } from 'vitest';
import { composeStacks } from '@objectstack/spec';
import { MetadataPlugin } from './plugin.js';

const CORE_ID = 'com.example.multi.core';
const ORDERS_ID = 'com.example.multi.orders';

const coreStack = {
    manifest: {
        id: CORE_ID,
        name: 'Multi-Package Core',
        namespace: 'crm',
        version: '1.0.0',
        type: 'app',
        engines: { protocol: '^17' },
    },
    objects: [
        {
            name: 'crm_account',
            label: 'Account',
            sharingModel: 'private',
            fields: { name: { name: 'name', type: 'text', label: 'Account Name', required: true } },
        },
    ],
    apps: [
        {
            name: 'multi_crm',
            label: 'Multi-Package CRM',
            navigation: [
                { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
            ],
        },
    ],
};

const ordersStack = {
    manifest: {
        id: ORDERS_ID,
        name: 'Multi-Package Orders',
        namespace: 'crm',
        // A DIFFERENT version from the app package on purpose: `_packageVersion`
        // is stamped from the same body as `_packageId`, so a shared version
        // would let a wrong-body stamp pass unnoticed.
        version: '2.4.0',
        type: 'module',
        engines: { protocol: '^17' },
        dependencies: { [CORE_ID]: '^1.0.0' },
    },
    objects: [
        {
            name: 'crm_order',
            label: 'Order',
            sharingModel: 'private',
            fields: {
                name: { name: 'name', type: 'text', label: 'Order Number', required: true },
                account: { name: 'account', type: 'lookup', label: 'Account', reference: 'crm_account' },
            },
        },
    ],
    views: [
        {
            object: 'crm_order',
            list: { label: 'All Orders', type: 'grid', columns: [{ field: 'name' }] },
        },
    ],
};

/** The module is listed FIRST — array order must not be what orders the load. */
const twoPackageArtifact = () =>
    JSON.parse(JSON.stringify(composeStacks(
        [ordersStack, coreStack] as never,
        { manifest: 'preserve' },
    )));

/** A single-`manifest` artifact — the D7 branch, no `packages` key anywhere. */
const singlePackageArtifact = () => JSON.parse(JSON.stringify({
    manifest: coreStack.manifest,
    objects: coreStack.objects,
    apps: coreStack.apps,
    views: ordersStack.views,
}));

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

interface RegisterCall { type: string; name: string; packageId?: string; packageVersion?: string }

/**
 * Drive the real door and record every `manager.register` call in order, with
 * the provenance the item carried at the moment it was registered.
 */
async function load(artifact: unknown): Promise<{
    plugin: any;
    ctx: any;
    total: number;
    calls: RegisterCall[];
}> {
    const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } }) as any;
    const ctx = fakeCtx();
    const calls: RegisterCall[] = [];
    const realRegister = plugin.manager.register.bind(plugin.manager);
    plugin.manager.register = async (type: string, name: string, item: any, opts: any) => {
        calls.push({
            type,
            name,
            packageId: item?._packageId,
            packageVersion: item?._packageVersion ?? undefined,
        });
        return realRegister(type, name, item, opts);
    };
    const total = await plugin._parseAndRegisterArtifact(ctx, artifact, 'fixture-14599');
    return { plugin, ctx, total, calls };
}

const stampOf = async (plugin: any, type: string, name: string) => {
    const item = (await plugin.manager.get(type, name)) as any;
    return item === undefined
        ? undefined
        : { packageId: item._packageId, packageVersion: item._packageVersion ?? undefined };
};

describe('#14599 artifact door — a `packages[]` artifact is registered per package', () => {
    it('the fixture carries the card shape (premise guard)', () => {
        const artifact = twoPackageArtifact();

        // Two package bodies…
        expect(artifact.packages).toHaveLength(2);
        expect(artifact.packages.map((e: any) => e.manifest.id).sort())
            .toEqual([CORE_ID, ORDERS_ID]);

        // …AND the flattened top level carrying the same definitions, which is
        // what `preserve` being ADDITIVE means. If the producer half of #14512
        // ever lands, THIS is the assertion that will report it — and the cases
        // below keep passing, because they read the bodies.
        expect(artifact.objects.map((o: any) => o.name).sort())
            .toEqual(['crm_account', 'crm_order']);

        // The divergence itself: the artifact's own identity is the App
        // package, so the pre-fix door stamped the MODULE's object with it.
        expect(artifact.manifest.id).toBe(CORE_ID);
    });

    it('stamps every item with the package that owns it, not the artifact manifest', async () => {
        const { plugin } = await load(twoPackageArtifact());

        // The card's headline: pre-fix this was `com.example.multi.core`.
        expect(await stampOf(plugin, 'object', 'crm_order'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });

        expect(await stampOf(plugin, 'object', 'crm_account'))
            .toEqual({ packageId: CORE_ID, packageVersion: '1.0.0' });
        expect(await stampOf(plugin, 'app', 'multi_crm'))
            .toEqual({ packageId: CORE_ID, packageVersion: '1.0.0' });

        // View containers take the same route through the door's other
        // registration site, container and expansions alike.
        expect(await stampOf(plugin, 'view', 'crm_order'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });
        expect(await stampOf(plugin, 'view', 'crm_order.default'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });
    });

    it('does not register the flattened top-level copy a second time', async () => {
        const { total, calls } = await load(twoPackageArtifact());

        // One register call per definition. Pre-fix the door made exactly these
        // calls too — but ALL of them from the flattened top level, all stamped
        // with the artifact manifest; the SECOND copy the list door served came
        // from the registry's own per-package registration, which the top-level
        // copy then collided with under a different `${packageId}${name}` slot.
        // What this pins is that the door does not itself contribute a second,
        // differently-attributed copy of any definition.
        const slots = calls.map((c) => `${c.type}:${c.name}`);
        expect(slots).toEqual([...new Set(slots)]);
        expect(total).toBe(calls.length);

        // No item is stamped with an id that owns no such definition.
        const byPackage = new Map<string, string[]>();
        for (const c of calls) {
            const list = byPackage.get(c.packageId!) ?? [];
            list.push(`${c.type}:${c.name}`);
            byPackage.set(c.packageId!, list);
        }
        expect([...byPackage.keys()].sort()).toEqual([CORE_ID, ORDERS_ID]);
        expect(byPackage.get(CORE_ID)!.sort()).toEqual(['app:multi_crm', 'object:crm_account']);
        expect(byPackage.get(ORDERS_ID)!.sort())
            .toEqual(['object:crm_order', 'view:crm_order', 'view:crm_order.default']);
    });

    it('registers the packages in topological order, not array order', async () => {
        // The fixture lists `orders` first and `orders` depends on `core`.
        // Registration order comes from `resolveArtifactPackageOrder`, the same
        // call the ObjectQL load path makes (ADR-0130 D5) — reused, so the two
        // readers of one `packages[]` cannot disagree.
        const { calls } = await load(twoPackageArtifact());

        const firstCore = calls.findIndex((c) => c.packageId === CORE_ID);
        const firstOrders = calls.findIndex((c) => c.packageId === ORDERS_ID);
        expect(firstCore).toBeGreaterThanOrEqual(0);
        expect(firstOrders).toBeGreaterThanOrEqual(0);
        expect(firstCore).toBeLessThan(firstOrders);

        // Each package's items are contiguous — one pass per body, not one
        // interleaved pass over a merged list.
        const ids = calls.map((c) => c.packageId);
        expect(ids).toEqual([...ids].sort((a, b) => (a === b ? 0 : a === CORE_ID ? -1 : 1)));
    });

    it('logs nothing about unowned items when every top-level item has an owner', async () => {
        // The residual sweep exists for artifacts whose top level carries
        // collections no package body repeats (`packages` is a `concat` key).
        // For a normally composed artifact it must register NOTHING and warn
        // about nothing — a warning here would mean the sweep is double-reading.
        const { ctx } = await load(twoPackageArtifact());

        const warnings = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warnings.filter((w: string) => w.includes('top-level metadata item'))).toEqual([]);
    });

    it('keeps a top-level item that NO package body declares, attributed to the artifact', async () => {
        // `packages` composes by `concat`, so an artifact built from one stack
        // that already carried `packages` and one that did not has top-level
        // collections outside every body. Dropping those would take metadata a
        // booted instance can see today off every door.
        const artifact = twoPackageArtifact();
        artifact.objects.push({
            name: 'crm_orphan',
            label: 'Orphan',
            sharingModel: 'private',
            fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
        });

        const { plugin, ctx } = await load(artifact);

        expect(await stampOf(plugin, 'object', 'crm_orphan'))
            .toEqual({ packageId: CORE_ID, packageVersion: '1.0.0' });
        // …and it is said out loud, because it means the artifact's two halves
        // disagree about what it ships.
        const warnings = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warnings.some((w: string) => w.includes('top-level metadata item'))).toBe(true);

        // The owned definitions keep their own packages — the sweep never
        // overwrites a body's copy with the flattened one.
        expect(await stampOf(plugin, 'object', 'crm_order'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });
    });

    it('D7: the single-`manifest` branch registers exactly what it always did', async () => {
        const { total, calls, ctx } = await load(singlePackageArtifact());

        // The literal — see the file header. Every call, in order, with its
        // stamp. Recorded identically on both legs of the ablation.
        const singlePackageRegisterSequence: RegisterCall[] = [
            { type: 'object', name: 'crm_account', packageId: CORE_ID, packageVersion: '1.0.0' },
            { type: 'app', name: 'multi_crm', packageId: CORE_ID, packageVersion: '1.0.0' },
            { type: 'view', name: 'crm_order', packageId: CORE_ID, packageVersion: '1.0.0' },
            { type: 'view', name: 'crm_order.default', packageId: CORE_ID, packageVersion: '1.0.0' },
        ];
        expect(calls).toEqual(singlePackageRegisterSequence);
        expect(total).toBe(singlePackageRegisterSequence.length);

        // No `packages` key ⇒ no residual sweep ⇒ nothing to warn about.
        const warnings = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warnings.filter((w: string) => w.includes('top-level metadata item'))).toEqual([]);
    });
});

/**
 * The doc `os build` writes out of a flat `src/docs/` — judged by
 * `stack.manifest.namespace` and placed at the artifact TOP LEVEL, on no
 * package body at all (#18431 ruling, clause 1).
 *
 * The `content` carries a marker for the same reason the e2e fixture does: a
 * count is satisfiable by an echo of the other doc, and pedigree is not.
 */
const FLAT_DOC = { name: 'pkgdocs_index', label: 'Index', content: '# Index\n\nMARKER-flat-doc\n' };

/** The doc `os build` writes out of `src/orders/docs/` — the OWNING body only. */
const PACKAGE_DOC = {
    name: 'ord_playbook',
    label: 'Orders Playbook',
    content: '# Orders Playbook\n\nMARKER-package-doc\n',
};

/**
 * The #18431 docs placement, laid over the real composed artifact.
 *
 * ⚠️ The docs half is positioned by hand, and that is deliberate — it is the
 * ONE key on which `composeStacks(…, { manifest: 'preserve' })` is not the
 * producer. `os build`'s docs collector places docs AFTER composition: a
 * package-directory doc goes on its owning body and ⛔ never to the top level,
 * while the stack's own flat `src/docs/` keeps the top level. So composing a
 * `docs`-carrying stack would produce the additive both-places shape, which is
 * precisely NOT the shape under test. The placement below was read off a real
 * `os build` of the #18431 e2e fixture (two packages, `src/docs/` +
 * `src/orders/docs/`): top level `['pkgdocs_index']`, orders body
 * `['ord_playbook']`, core body none.
 */
const docsArtifact = () => {
    const artifact = twoPackageArtifact();
    artifact.docs = [{ ...FLAT_DOC }];
    const orders = artifact.packages.find((e: any) => e.manifest.id === ORDERS_ID);
    orders.manifest.docs = [{ ...PACKAGE_DOC }];
    return artifact;
};

describe('#19246 artifact door — a `packages[]` artifact\'s TOP-LEVEL-only docs register', () => {
    it('the fixture carries the card shape (premise guard)', () => {
        const artifact = docsArtifact();

        // The subject: a top-level doc that NO package body declares. This is
        // the emitter's intended output for a multi-package project with a flat
        // `src/docs/`, not an accident of `packages` being a `concat` key — so
        // unlike the orphan `object` case above, this shape is on every such
        // artifact the compiler produces.
        expect(artifact.docs.map((d: any) => d.name)).toEqual(['pkgdocs_index']);
        const onBodies = artifact.packages.flatMap((e: any) => (e.manifest.docs ?? []).map((d: any) => d.name));
        expect(onBodies).not.toContain('pkgdocs_index');

        // The control: a doc that reaches the registry through the package
        // walk, and is NOT at the top level.
        expect(onBodies).toEqual(['ord_playbook']);
        expect(JSON.stringify(artifact.docs)).not.toContain('MARKER-package-doc');
    });

    it('registers BOTH — the body doc via the package walk, the top-level-only doc via the residual sweep', async () => {
        const { plugin } = await load(docsArtifact());

        // ⭐ The lit control, asserted FIRST and in the same load: a `doc` that
        // does register. Without it an absent subject below would be equally
        // consistent with a door that registers no `doc` at all, a fixture that
        // never parsed, or a harness that recorded nothing.
        expect(await stampOf(plugin, 'doc', 'ord_playbook'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });

        // The subject. The static reading this pin exists to contradict was
        // that `resolveArtifactPackageOrder` walks bodies only (true) and that
        // `AppPlugin` registers no `collections.docs` (also true) — and
        // concluded "nowhere", having never reached THIS door's residual sweep,
        // which is the registrar.
        expect(await stampOf(plugin, 'doc', 'pkgdocs_index'))
            .toEqual({ packageId: CORE_ID, packageVersion: '1.0.0' });

        // Pedigree, not counts: each registered doc carries the bytes of the
        // file it came from, so neither assertion above can be satisfied by an
        // echo of the other.
        expect(((await plugin.manager.get('doc', 'pkgdocs_index')) as any).content)
            .toContain('MARKER-flat-doc');
        expect(((await plugin.manager.get('doc', 'ord_playbook')) as any).content)
            .toContain('MARKER-package-doc');
    });

    it('the absence arm: with the top-level doc gone the control still registers', async () => {
        // The negative leg of the same instrument. A pin that asserts presence
        // is worth only as much as its ability to report absence, and these two
        // cases differ by exactly the top-level `docs` array.
        const artifact = docsArtifact();
        delete artifact.docs;

        const { plugin, ctx } = await load(artifact);

        expect(await stampOf(plugin, 'doc', 'pkgdocs_index')).toBeUndefined();
        expect(await stampOf(plugin, 'doc', 'ord_playbook'))
            .toEqual({ packageId: ORDERS_ID, packageVersion: '2.4.0' });

        // …and with nothing unowned at the top level, the sweep says nothing.
        const warnings = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warnings.filter((w: string) => w.includes('top-level metadata item'))).toEqual([]);
    });

    it('says out loud that the artifact\'s two halves disagree', async () => {
        const { ctx } = await load(docsArtifact());

        // The registration is silent-by-default's opposite: the door warns, and
        // the remedy it names is one an author can actually perform — measured
        // on the same fixture, moving `src/docs/pkgdocs_index.md` to
        // `src/core/docs/` puts the doc on the core body and the top-level
        // `docs` key disappears from the artifact.
        const warnings = ctx.logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(warnings.some((w: string) => w.includes('top-level metadata item'))).toBe(true);
    });
});
