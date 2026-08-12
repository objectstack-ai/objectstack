// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6602 — an org-scoped overlay row must NEVER reach the process-wide
 * SchemaRegistry on an unscoped (control-plane) kernel.
 *
 * The invariant is not new; the repo already stated it in two places and
 * enforced it in only one:
 *
 *  • `loadMetaFromDb` queries `organization_id: null` and says why in a
 *    comment — "Per-org overlays are loaded on demand by getMetaItem to
 *    avoid cross-org leakage into the process-wide SchemaRegistry."
 *  • `applyRegistryWriteThrough`'s own TSDoc said "a project-scoped row must
 *    not be registered into a registry that unscoped (control-plane) callers
 *    share. The write must not be more permissive about that than the read
 *    is." — and then gated on `environmentId` alone, which says nothing
 *    about `organization_id`.
 *
 * So BOTH runtime seams were org-blind:
 *
 *   PROBE P3 (issue body) rows = [{type view, name org_grid, org org_a}]
 *                → registry write-through = [{type view, name org_grid}]
 *
 * and the read side did the same thing one listing call later: `getMetaItems`
 * merges `orgRecords` into `overlays` and hydrates the whole merged set under
 * `if (this.environmentId === undefined)`. Fixing only the write would have
 * been undone by the next org-scoped listing, which is why both are pinned
 * here in one file.
 *
 * The disclosure is observable, not theoretical: once org A's body sits under
 * the PLAIN key, org B's listing starts from org A's body — and where the
 * names do not collide, org A's item is simply IN org B's list. Per #5086 a
 * host config boots `new ObjectQLPlugin()` with NO environmentId, so the
 * flagship showcase runs on exactly this kernel shape.
 *
 * ── The fix, and where it lives ─────────────────────────────────────────
 *
 * `hydrateOverlayIntoRegistry` is the ONE shared choke point all three
 * hydration callers already route through (#4521 made it so: boot, the
 * read-side hydration and the write-through). The row-scope verdict now
 * lives there and its `organizationId` argument is REQUIRED, so a fourth
 * caller cannot forget it — declared = enforced. The kernel-scope verdict
 * (`environmentId === undefined`) stays with the callers, because that is a
 * fact about the kernel, not about the row.
 *
 * ── Reverse verification, direction predicted BEFORE running ────────────
 *
 * Ordinary red on the two leak seams, with deliberately green controls.
 * Restoring either org-blind seam (deleting the `organizationId` refusal in
 * `hydrateOverlayIntoRegistry`) must turn the leak cases red and leave the
 * env-wide cases green — the env-wide rows are the #4521 read-your-writes
 * behaviour this fix must NOT regress, and they never carry an org to
 * refuse. Measured direction is recorded in the PR body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { SchemaRegistry } from './registry.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';

const ORG_A = 'org_a';
const ORG_B = 'org_b';

/**
 * A `sys_metadata`-shaped fake engine over one row array, so the repository
 * write path (insert/update) and every read see one store. Both destructive
 * verbs are pinned to the producer's OWN dispatch predicates (#4550 delete /
 * #5480 update) rather than a hand-mirrored approximation — a double looser
 * than `ObjectQL.<verb>` converts a green suite into no suite at all.
 */
function makeEngine(registry: SchemaRegistry) {
    let rows: any[] = [];
    let nextId = 1;
    const matches = (r: any, w: Record<string, unknown>): boolean =>
        Object.entries(w).every(([k, v]) => {
            if (v === undefined) return true;
            if (v !== null && typeof v === 'object') return true; // operator clause — not exercised here
            return r[k] === v;
        });
    const engine: any = {
        registry,
        find: vi.fn(async (_table: string, opts: any) => rows.filter((r) => matches(r, opts?.where ?? {}))),
        findOne: vi.fn(async (table: string, opts: any) => (await engine.find(table, opts))[0] ?? null),
        insert: vi.fn(async (_table: string, data: any) => {
            const row = { id: data.id ?? `row_${nextId++}`, ...data };
            rows.push(row);
            return row;
        }),
        update: vi.fn(async (_table: string, data: any, opts: any) => {
            assertEngineUpdateDispatch(data, opts);
            const target = rows.find((r) => matches(r, opts?.where ?? {}));
            if (target) Object.assign(target, data);
            return target ?? null;
        }),
        delete: vi.fn(async (_table: string, opts: any) => {
            assertEngineDeleteDispatch(opts);
            const before = rows.length;
            rows = rows.filter((r) => !matches(r, opts?.where ?? {}));
            return { deleted: before - rows.length };
        }),
        count: vi.fn(async (_table: string, opts: any) => rows.filter((r) => matches(r, opts?.where ?? {})).length),
        aggregate: vi.fn(async () => []),
        execute: vi.fn(async () => undefined),
        /** Plant a row without going through the write path (read-seam cases). */
        plant: (row: any) => { rows.push({ id: `row_${nextId++}`, ...row }); },
        getRows: () => rows,
    };
    return engine;
}

const viewBody = (name: string, label: string) => ({
    name,
    label,
    object: 'showcase_task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
});

const flowBody = (name: string, label: string) => ({
    name,
    label,
    type: 'record_change',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'showcase_task', triggerType: 'record-after-update' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

const metaRow = (type: string, body: Record<string, unknown>, organizationId: string | null) => ({
    type,
    name: body.name,
    organization_id: organizationId,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
});

/** Names in a bare item array — what `SchemaRegistry.listItems` hands back. */
const namesIn = (items: unknown[]): string[] =>
    items.map((i) => (i as { name?: string })?.name).filter((n): n is string => typeof n === 'string');

/** Names visible in a `getMetaItems` result, which answers an `{ items }` envelope. */
const namesOf = (listed: { items?: unknown[] }): string[] => namesIn(listed?.items ?? []);

/** One item out of a `getMetaItems` result, by name. */
const itemNamed = (listed: { items?: unknown[] }, name: string): any =>
    (listed?.items ?? []).find((i) => (i as { name?: string })?.name === name);

describe('#6602 — the premise, read from the registry rather than restated', () => {
    it('view is the specimen: a legitimately per-org-overridable type', () => {
        // If a later ruling closes this flag, the leak this file pins stops
        // being reachable through the overlay tier and the whole file should
        // be re-read, not repaired.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'view')).toMatchObject({
            allowOrgOverride: true,
        });
        // `flow` reaches the same seam through the OTHER write tier: not
        // per-org overridable (#6283 / PR #6478) but still runtime-creatable,
        // which is the tier a Studio-authored flow uses.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'flow')).toMatchObject({
            allowOrgOverride: false,
            allowRuntimeCreate: true,
        });
    });
});

describe('#6602 — WRITE seam: applyRegistryWriteThrough refuses org-scoped rows', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        // No environmentId — the unscoped control-plane kernel #5086 measured
        // the flagship showcase booting with.
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('an ORG-scoped view write does not reach the process-wide registry (PROBE P3)', async () => {
        const saved = await protocol.saveMetaItem({
            type: 'view',
            name: 'org_grid',
            item: viewBody('org_grid', 'Org A grid'),
            organizationId: ORG_A,
        });
        expect(saved.success).toBe(true);
        // The row IS persisted — this fix closes a registry leak, never a write.
        expect(engine.getRows().some((r: any) => r.name === 'org_grid' && r.organization_id === ORG_A)).toBe(true);

        // Pre-fix: the body sits here under the PLAIN key, visible to every
        // registry-direct reader in the process.
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
        expect(namesIn(registry.listItems('view'))).not.toContain('org_grid');
    });

    it('[#6190] an ORG-scoped flow write is now refused outright — it never reaches this seam', async () => {
        // Replaced wholesale rather than re-spelled. This case used to assert
        // `saved.success === true` and then that the row stayed out of the
        // shared registry: the runtime-create tier could mint an org-scoped
        // `flow`, and #6602's job was to stop that row LEAKING into the
        // process-wide registry. Since the 2026-08-08 ruling on #6190 the write
        // itself is refused, one layer earlier, so the leak is closed by
        // construction and the old assertion could only ever pass for an empty
        // reason.
        //
        // The write-through gate keeps its own coverage: the `view` cases above
        // exercise it with a type that CAN legitimately carry an org-scoped row,
        // which is the only way to reach this seam with an org row at all.
        await expect(
            protocol.saveMetaItem({
                type: 'flow',
                name: 'org_sweep',
                item: flowBody('org_sweep', 'Org A sweep'),
                organizationId: ORG_A,
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        expect(registry.getItem('flow', 'org_sweep')).toBeUndefined();
        expect(namesIn(registry.listItems('flow'))).not.toContain('org_sweep');
    });

    it('an ENV-WIDE write still writes through — #4521 read-your-writes is untouched', async () => {
        const saved = await protocol.saveMetaItem({
            type: 'view',
            name: 'env_grid',
            item: viewBody('env_grid', 'Env grid'),
        });
        expect(saved.success).toBe(true);
        // The control that makes the two cases above evidence rather than a
        // write-through that simply stopped working.
        const hydrated: any = registry.getItem('view', 'env_grid');
        expect(hydrated).toBeDefined();
        expect(hydrated.label).toBe('Env grid');
    });

    it('an env-wide entry survives a LATER org write of the same name', async () => {
        await protocol.saveMetaItem({
            type: 'view',
            name: 'shared_grid',
            item: viewBody('shared_grid', 'Env grid'),
        });
        await protocol.saveMetaItem({
            type: 'view',
            name: 'shared_grid',
            item: viewBody('shared_grid', 'Org A grid'),
            organizationId: ORG_A,
        });
        // Pre-fix the org body OVERWROTE the env-wide plain-key entry, so
        // every org (and the control plane) started reading org A's body.
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');
    });
});

describe('#6602 — READ seam: getMetaItems hydration refuses org-scoped rows', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('an org-scoped listing SERVES the org row but does not graft it', async () => {
        engine.plant(metaRow('view', viewBody('org_grid', 'Org A grid'), ORG_A));

        const listed = await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });

        // Org readers keep their overlay — closing the leak must not close
        // the feature.
        expect(namesOf(listed as any)).toContain('org_grid');
        // …and the process-wide registry stays clean.
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
    });

    it('an ENV-WIDE listing still hydrates — the read side is not narrowed', async () => {
        engine.plant(metaRow('view', viewBody('env_grid', 'Env grid'), null));

        const listed = await protocol.getMetaItems({ type: 'view' });

        expect(namesOf(listed as any)).toContain('env_grid');
        expect((registry.getItem('view', 'env_grid') as any)?.label).toBe('Env grid');
    });

    it('a MIXED listing hydrates the env-wide row and only that one', async () => {
        engine.plant(metaRow('view', viewBody('env_grid', 'Env grid'), null));
        engine.plant(metaRow('view', viewBody('org_grid', 'Org A grid'), ORG_A));

        const listed = await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });

        expect(namesOf(listed as any).sort()).toEqual(['env_grid', 'org_grid']);
        expect(registry.getItem('view', 'env_grid')).toBeDefined();
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
    });

    it('an org overlay of an env-wide name does not OVERWRITE the hydrated env-wide entry', async () => {
        engine.plant(metaRow('view', viewBody('shared_grid', 'Env grid'), null));
        engine.plant(metaRow('view', viewBody('shared_grid', 'Org A grid'), ORG_A));

        // The env-wide body reaches the registry the way it legitimately does
        // — an unscoped read (boot's `loadMetaFromDb` is the other one).
        await protocol.getMetaItems({ type: 'view' });
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');

        // Org A's own listing still shows org A's body (org-over-env merge)…
        const listedA = await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });
        expect(itemNamed(listedA as any, 'shared_grid')?.label).toBe('Org A grid');

        // …and the shared registry still holds the ENV-WIDE one. This is the
        // collision direction of the leak: pre-fix the org body overwrote the
        // plain key here, so every reader in the process — the control plane
        // and org B alike — started serving org A's customization.
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');
    });

    it('an org-scoped listing hydrates NOTHING for a name its org overlays', async () => {
        // Measured, and stated rather than presumed: `getMetaItems` merges the
        // two record sets by (package, name) with the ORG row winning, so the
        // env-wide row it shadows is not in the set this loop walks at all.
        // The subtraction is the leak only — pre-fix this listing hydrated org
        // A's body under the plain key, never the env-wide one, so nothing
        // legitimate is lost. The env-wide entry arrives from boot / the
        // unscoped read, as the case above shows.
        engine.plant(metaRow('view', viewBody('shared_grid', 'Env grid'), null));
        engine.plant(metaRow('view', viewBody('shared_grid', 'Org A grid'), ORG_A));

        await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });

        expect(registry.getItem('view', 'shared_grid')).toBeUndefined();
    });
});

describe('#6602 — the disclosure shape, end to end', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it("org B's listing never contains org A's item — write then list", async () => {
        await protocol.saveMetaItem({
            type: 'view',
            name: 'org_a_only',
            item: viewBody('org_a_only', 'Org A only'),
            organizationId: ORG_A,
        });

        const listedB = await protocol.getMetaItems({ type: 'view', organizationId: ORG_B });
        expect(namesOf(listedB as any)).not.toContain('org_a_only');
    });

    it("org B's listing never contains org A's item — org A LISTS first", async () => {
        // The seam the write-side fix alone would not have closed: one
        // org-scoped listing call used to graft org A's body, and every
        // later reader started from it.
        engine.plant(metaRow('view', viewBody('org_a_only', 'Org A only'), ORG_A));

        await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });
        const listedB = await protocol.getMetaItems({ type: 'view', organizationId: ORG_B });

        expect(namesOf(listedB as any)).not.toContain('org_a_only');
        // The unscoped control-plane listing is a third reader of the same
        // shared registry, and it must not see org A's item either.
        const listedControlPlane = await protocol.getMetaItems({ type: 'view' });
        expect(namesOf(listedControlPlane as any)).not.toContain('org_a_only');
    });

    it("org B reads the ENV-WIDE body, not org A's, for a colliding name", async () => {
        engine.plant(metaRow('view', viewBody('shared_grid', 'Env grid'), null));
        engine.plant(metaRow('view', viewBody('shared_grid', 'Org A grid'), ORG_A));

        await protocol.getMetaItems({ type: 'view', organizationId: ORG_A });
        const listedB = await protocol.getMetaItems({ type: 'view', organizationId: ORG_B });

        expect(itemNamed(listedB as any, 'shared_grid')?.label).toBe('Env grid');
    });
});

describe('#6602 — the on-demand per-org read still serves org readers', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('getMetaItem serves the org body to its own org and never hydrates it', async () => {
        engine.plant(metaRow('view', viewBody('org_grid', 'Org A grid'), ORG_A));

        const got: any = await protocol.getMetaItem({ type: 'view', name: 'org_grid', organizationId: ORG_A });
        expect(got.item.label).toBe('Org A grid');

        // ADR-0005's "loaded on demand … to avoid cross-org leakage": serving
        // it must not be the thing that grafts it.
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
    });

    it('getMetaItem prefers the ORG body over the env-wide one for its own org', async () => {
        engine.plant(metaRow('view', viewBody('shared_grid', 'Env grid'), null));
        engine.plant(metaRow('view', viewBody('shared_grid', 'Org A grid'), ORG_A));

        const forOrgA: any = await protocol.getMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });
        expect(forOrgA.item.label).toBe('Org A grid');

        const forOrgB: any = await protocol.getMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_B });
        expect(forOrgB.item.label).toBe('Env grid');
    });

    it('a write-then-read round trip works for an org author (write seam, read seam)', async () => {
        await protocol.saveMetaItem({
            type: 'view',
            name: 'org_grid',
            item: viewBody('org_grid', 'Org A grid'),
            organizationId: ORG_A,
        });

        const got: any = await protocol.getMetaItem({ type: 'view', name: 'org_grid', organizationId: ORG_A });
        expect(got.item.label).toBe('Org A grid');
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
    });
});

describe('#6602 — the delete chain needs no re-keying under this fix', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('an env-wide delete still retires its plain-key entry (#5079 / #6687 intact)', async () => {
        await protocol.saveMetaItem({
            type: 'view',
            name: 'env_grid',
            item: viewBody('env_grid', 'Env grid'),
        });
        expect(registry.getItem('view', 'env_grid')).toBeDefined();

        await protocol.deleteMetaItem({ type: 'view', name: 'env_grid' });
        expect(registry.getItem('view', 'env_grid')).toBeUndefined();
    });

    it('an org-scoped delete has no plain-key entry of its own to retire', async () => {
        // The argument for leaving `restoreArtifactRegistryView` alone: the
        // delete chain is `(type, name)`-addressed and org-blind, but with both
        // entry seams refusing org rows there is nothing org-scoped in the
        // registry for it to mis-address.
        //
        // [#6780] TRUE OF THIS CASE, AND ONLY THIS CASE — measured later, and
        // the correction is the next describe block. The name here is org A's
        // alone, so the plain key really is empty and the org-blind heal has
        // nothing to hit. Give the name an ENV-WIDE row as well and the same
        // heal addresses that row's entry instead: `(type, name)` cannot tell
        // the two apart, so "no entry of its own" was never "no entry". The
        // fix keeps this file's conclusion (no org-scoped registry keys) and
        // adds the missing half (an org-scoped delete may not heal at all).
        await protocol.saveMetaItem({
            type: 'view',
            name: 'org_grid',
            item: viewBody('org_grid', 'Org A grid'),
            organizationId: ORG_A,
        });
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();

        const deleted = await protocol.deleteMetaItem({ type: 'view', name: 'org_grid', organizationId: ORG_A });
        expect(deleted.success).toBe(true);
        expect(registry.getItem('view', 'org_grid')).toBeUndefined();
    });
});

/**
 * #6780 — an ORG-scoped metadata DELETE must not evict the ENV-WIDE registry
 * entry that every org and the control plane read.
 *
 * The block above closed the two ENTRY seams (write-through + read-side
 * hydration) and concluded the delete chain needed no re-keying. That
 * conclusion holds for a name only one org has touched — and fails for the
 * name that matters, because `restoreArtifactRegistryView` is
 * `(type, name)`-addressed and its every tier writes the PLAIN key:
 * `removeRuntimeShadow` drops it, the layer-2 re-register rewrites it,
 * `removeOverlayEntry` retires it. Per ADR-0005 that one plain key belongs to
 * the ENV-WIDE row. So org A's delete could only ever hit somebody else's
 * entry.
 *
 * Measured on `origin/main` (5e247fd6b) BEFORE the fix, the card's sequence:
 *
 *   after env save   : "Env grid"
 *   after org save   : "Env grid"        ← #6602 holding
 *   delete receipt   : {"success":true,"reset":true,…}
 *   after org DELETE : undefined         ← the eviction
 *   rows left        : [{"n":"shared_grid","org":null,"state":"active"}, …]
 *
 * — the env-wide ROW still in `sys_metadata`, its registry entry gone. While
 * it is gone, direct registry readers answer as if the item does not exist
 * (ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`,
 * fail-closed `assertObjectRegistered` → 404), so one tenant's "reset my
 * customization" degrades every other tenant's runtime. Pre-existing; #6602
 * neither introduced nor covered it.
 *
 * ── The shape, and why (b) rather than (a) ─────────────────────────────
 *
 * The verdict lives INSIDE the helper as a REQUIRED `organizationId`
 * parameter — the {@link hydrateOverlayIntoRegistry} shape #6602/PR #6779
 * used on the register side — rather than as a gate repeated at each call
 * site. Measured reason: there are FOUR call sites, not the two the card
 * names — `deleteMetaItem` has three (self-heal, post-`repo.delete`, legacy
 * raw-engine path) and `revertCommit` one. PR #6807 had already gated the
 * revert one; a call-site fix would have had to find the other three, and
 * the legacy raw-engine path is exactly the kind a sweep misses. A required
 * parameter makes a fifth caller answer at compile time. #6807's call-site
 * `if (orgId === null)` is now redundant-not-contradictory and was folded
 * into the argument it passes; its pin ("an ORG-scoped soft-remove leaves the
 * env-wide registry entry alone", protocol-commit-history.test.ts) is
 * untouched and still covers the batch path.
 *
 * REGISTER WIDE, RETIRE NARROW: the write-through's `object` carve-out is
 * deliberately NOT org-gated, and that does not transfer here — it rests on
 * `assertObjectRegistered` failing CLOSED, so a surplus entry degrades to
 * "listable but rowless" and the next reload heals it, while a wrongly
 * retired entry 404s data CRUD for every tenant.
 *
 * ── Reverse verification, direction predicted BEFORE running ───────────
 *
 * Ordinary red, with deliberately green controls. Deleting the
 * `organizationId` refusal from `restoreArtifactRegistryView` must turn the
 * three org-scoped REGISTRY cases red — reproducing the card's `undefined`
 * and, for the artifact case, the un-shadowing that precedes it — while the
 * three env-wide cases stay green (an env-wide delete is exactly what the
 * heal is FOR: #6687's three-tier walk must not regress) and so does the
 * org-scoped ROW control, which asserts the delete itself and never reads the
 * registry. Predicted 3 red / 4 green in this block; measured 3 red / 4 green:
 *
 *   × …the card's sequence            → expected undefined to be defined
 *   × …the SELF-HEAL branch           → expected undefined to be 'Env grid'
 *   × …the runtime-SHADOW tier        → expected 'Artifact grid' to be 'Env grid'
 *   ✓ the ORG ROW is still removed · ✓ tier 1 · ✓ tier 3 · ✓ env-wide + org overlay
 *
 * A FOURTH red lands in a file this change did not edit, and it is the point
 * of shape (b) rather than a surprise: PR #6807's own pin
 * (`protocol-commit-history.test.ts` → "an ORG-scoped soft-remove leaves the
 * env-wide registry entry alone") goes red too — `expected null to be
 * 'EnvWide'` — because its call-site `if (orgId === null)` was folded into
 * the argument it now passes. The gate moved; the coverage did not.
 */
describe('#6780 — the registry heal is org-gated: an org DELETE never evicts the env-wide entry', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;

    /** A code-shipped `view` under a composite key — the tier-1 layer. */
    const PKG = 'com.objectstack.test-pkg';
    const artifactView = () => ({
        ...viewBody('shared_grid', 'Artifact grid'),
        _packageId: PKG,
        _packageVersion: '1.0.0',
        _provenance: 'package',
    });

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        engine = makeEngine(registry);
        // No environmentId — the unscoped control-plane kernel #5086 measured
        // the flagship showcase booting with, and the one whose registry every
        // org in the process shares.
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it("org A deleting its OWN overlay leaves the env-wide entry standing (the card's sequence)", async () => {
        await protocol.saveMetaItem({ type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Env grid') });
        await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Org A grid'), organizationId: ORG_A,
        });
        // #6602 holding: the org write never reached the shared registry.
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');

        await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });

        // Pre-fix this read was `undefined` — the whole defect, in one line.
        expect(registry.getItem('view', 'shared_grid')).toBeDefined();
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');
    });

    it('the same delete still removes the ORG ROW — row-level behaviour is untouched', async () => {
        // The control that keeps the case above from passing for the wrong
        // reason: a "fix" that skipped the delete entirely would also leave the
        // env-wide entry standing. The reset must still reset.
        await protocol.saveMetaItem({ type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Env grid') });
        await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Org A grid'), organizationId: ORG_A,
        });
        const beforeDelete: any = await protocol.getMetaItem({
            type: 'view', name: 'shared_grid', organizationId: ORG_A,
        });
        expect(beforeDelete.item.label).toBe('Org A grid');

        const deleted = await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });

        expect(deleted.success).toBe(true);
        expect(deleted.reset).toBe(true);
        // Org A now falls through to the env-wide body — ADR-0005's "reset to
        // default", which is what the org author actually asked for.
        const afterDelete: any = await protocol.getMetaItem({
            type: 'view', name: 'shared_grid', organizationId: ORG_A,
        });
        expect(afterDelete.item.label).toBe('Env grid');
    });

    it('the SELF-HEAL branch respects the same scope — a no-op org DELETE is inert', async () => {
        // The cheapest eviction door of the three, and the one a gate on the
        // delete-ful branch alone would have left open: org A has no overlay
        // row at all, so the delete answers `reset: false` … and pre-fix still
        // ran the heal. Measured on `origin/main`:
        //   delete receipt   : {"success":true,"reset":false,"…nothing to delete."}
        //   after org DELETE : undefined
        await protocol.saveMetaItem({ type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Env grid') });
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');

        const deleted = await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });

        expect(deleted.reset).toBe(false);
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');
    });

    it('the runtime-SHADOW tier is org-gated too: the env-wide overlay keeps shadowing its artifact', async () => {
        // Tier 1 of the walk, which retires nothing and is still wrong for an
        // org-scoped delete: un-shadowing hands every reader the PACKAGED body
        // while the env-wide overlay row is still in force.
        registry.registerItem('view', artifactView(), 'name', PKG);
        await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', packageId: PKG, item: viewBody('shared_grid', 'Env grid'),
        });
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');

        await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });

        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');
        // The artifact is still there under its composite key, unharmed.
        expect((registry.getArtifactItem('view', 'shared_grid') as any)?.label).toBe('Artifact grid');
    });

    it('an ENV-WIDE delete still un-shadows the artifact — #6687 tier 1 not regressed', async () => {
        // The green half. This is what the heal is FOR: the env-wide overlay
        // goes away and the packaged default becomes visible again.
        registry.registerItem('view', artifactView(), 'name', PKG);
        await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', packageId: PKG, item: viewBody('shared_grid', 'Env grid'),
        });
        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Env grid');

        await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid' });

        expect((registry.getItem('view', 'shared_grid') as any)?.label).toBe('Artifact grid');
    });

    it('an ENV-WIDE delete of a runtime-only item still RETIRES the entry — #5079 tier 3 not regressed', async () => {
        await protocol.saveMetaItem({ type: 'view', name: 'env_grid', item: viewBody('env_grid', 'Env grid') });
        expect(registry.getItem('view', 'env_grid')).toBeDefined();

        await protocol.deleteMetaItem({ type: 'view', name: 'env_grid' });

        expect(registry.getItem('view', 'env_grid')).toBeUndefined();
    });

    it('an env-wide delete heals even while an org overlay of the same name exists', async () => {
        // The direction the gate must NOT over-reach in: the org row is not a
        // reason to leave the env-wide entry stale. Scope is read from the
        // DELETE, never from what else happens to be stored.
        await protocol.saveMetaItem({ type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Env grid') });
        await protocol.saveMetaItem({
            type: 'view', name: 'shared_grid', item: viewBody('shared_grid', 'Org A grid'), organizationId: ORG_A,
        });

        await protocol.deleteMetaItem({ type: 'view', name: 'shared_grid' });

        expect(registry.getItem('view', 'shared_grid')).toBeUndefined();
        // Org A's own overlay row is untouched by an env-wide delete.
        const forOrgA: any = await protocol.getMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A });
        expect(forOrgA.item.label).toBe('Org A grid');
    });
});
