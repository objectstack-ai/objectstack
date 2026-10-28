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
 * [ADR-0131 D6, C7] Since the per-organization overlay axis retired, no list
 * read merges a legacy organization's rows: the last one, the anonymous form
 * doors' `view` read (`legacyFormOrganizationId`), was deleted when the v18
 * ceremony began carrying those rows' withdrawals onto the environment. The
 * listing cases below still pass that key, and pin that it reads the
 * environment and hydrates nothing of the organization's.
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
 *
 * [ADR-0131 D6/D7] The family declares no organization column now, so the
 * read-side legs that planted a legacy organization row are retired with it:
 * no stored row carries an organization, and the runtime refuses to boot on a
 * database still holding one. The write-side legs and the delete-chain legs,
 * which drive organization-scoped REQUESTS, stay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { SchemaRegistry } from './registry.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

const ORG_A = 'org_a';

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
        findOne: vi.fn(async (table: string, opts: any) => {
            // [#11957] Pinned to ObjectQL.findOne's OWN #4419 predicate: `findOne`
            // applies limit: 1, so a query naming no record returns an ARBITRARY row
            // and the engine REFUSES it. A double that answers it anyway is how
            // #11767 shipped a bootstrap bypass that was inert on every real
            // deployment while a 641-line unit matrix stayed green.
            assertEngineFindOnePredicate(table, opts);
            return (await engine.find(table, opts))[0] ?? null;
        }),
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

const metaRow = (type: string, body: Record<string, unknown>) => ({
    type,
    name: body.name,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
});

/** Names in a bare item array — what `SchemaRegistry.listItems` hands back. */
const namesIn = (items: unknown[]): string[] =>
    items.map((i) => (i as { name?: string })?.name).filter((n): n is string => typeof n === 'string');

/** Names visible in a `getMetaItems` result, which answers an `{ items }` envelope. */
const namesOf = (listed: { items?: unknown[] }): string[] => namesIn(listed?.items ?? []);

describe('#6602 — the premise, read from the registry rather than restated', () => {
    it('view is the specimen: an overlay-enabled type, the tier the per-org leak rode before ADR-0131 D6', () => {
        // If a later ruling closes this flag, the overlay tier this file drives
        // is no longer reachable for `view` and the whole file should be
        // re-read, not repaired. The flag decides no organization since
        // ADR-0131 D6 (it was spelled `allowOrgOverride` while it did); the
        // seam below still refuses an org-scoped row whoever produces one.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'view')).toMatchObject({
            allowEnvironmentOverlay: true,
        });
        // `flow` reaches the same seam through the OTHER write tier: not
        // overlay-enabled (#6283 / commit 474f131cf) but still runtime-creatable,
        // which is the tier a Studio-authored flow uses.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'flow')).toMatchObject({
            allowEnvironmentOverlay: false,
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
        // [ADR-0131 D6] The org-scoped write is now refused outright, for every
        // type, so the leak is closed one layer earlier and no row is persisted.
        await expect(
            protocol.saveMetaItem({
                type: 'view',
                name: 'org_grid',
                item: viewBody('org_grid', 'Org A grid'),
                organizationId: ORG_A,
            } as any),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(engine.getRows().some((r: any) => r.name === 'org_grid')).toBe(false);

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
            } as any),
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
        await expect(
            protocol.saveMetaItem({
                type: 'view',
                name: 'shared_grid',
                item: viewBody('shared_grid', 'Org A grid'),
                organizationId: ORG_A,
            } as any),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
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

    it('an ENV-WIDE listing still hydrates — the read side is not narrowed', async () => {
        engine.plant(metaRow('view', viewBody('env_grid', 'Env grid')));

        const listed = await protocol.getMetaItems({ type: 'view' });

        expect(namesOf(listed as any)).toContain('env_grid');
        expect((registry.getItem('view', 'env_grid') as any)?.label).toBe('Env grid');
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
        // [#26708] The package that ships the artifact is installed, as its
        // boot installs it: a save naming a package no installed package has
        // is refused before it is written.
        registry.installPackage({ id: PKG, name: PKG, version: '1.0.0' } as any, 'code');
        // …with the object its grid binds: an installed package's write is
        // judged against its closure.
        registry.registerObject({ name: 'showcase_task', label: 'Task', fields: { name: { type: 'text', label: 'Name' } } } as never, PKG);
        // No environmentId — the unscoped control-plane kernel #5086 measured
        // the flagship showcase booting with, and the one whose registry every
        // org in the process shares.
        protocol = new ObjectStackProtocolImplementation(engine);
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

        await expect(
            protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A } as any),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
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

        await expect(
            protocol.deleteMetaItem({ type: 'view', name: 'shared_grid', organizationId: ORG_A } as any),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

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

});
