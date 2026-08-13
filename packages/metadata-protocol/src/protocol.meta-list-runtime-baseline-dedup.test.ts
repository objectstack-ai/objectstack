// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7654] `GET /api/v1/meta/<type>` serves ONE row per name after a runtime PUT.
 *
 * ---------------------------------------------------------------------------
 * The gap this file pins
 * ---------------------------------------------------------------------------
 * `getMetaItems` merges three layers, and until this card two of them answered
 * the identity question differently:
 *
 *   • `mergePackageAwareOverlay` (the `sys_metadata` overlay merge) resolves per
 *     `(slot, package)` and treats a package-LESS row as STANDING IN for each
 *     package's row of that name — the same resolution
 *     `getMetaItem(name, packageId=P)` performs.
 *   • the MetadataService merge one layer below keyed a hand-rolled `Map` on
 *     `(package, name)` with STRICT equality, so a package-less row occupied a
 *     slot of its OWN rather than standing in for anything.
 *
 * A runtime `PUT /api/v1/meta/<type>/<name>` sends no `?package=`, so the row it
 * writes is `package_id IS NULL`. For a type whose baseline lives in the
 * MetadataService rather than the SchemaRegistry — `skill`, `agent`, `tool`
 * reach it through its own loaders — the registry listing is empty, so the
 * overlay merge has no base row to take provenance from and the override body
 * leaves it with NO `_packageId`. Its key then missed the package-bearing
 * baseline row in the MetadataService merge, the "already present" guard never
 * fired, and the list served the override row AND the package row: the card's
 * `GET /api/v1/meta/skill` double listing, after a 200 PUT.
 *
 * ---------------------------------------------------------------------------
 * Why this is NOT skill-specific — and why the fix is not a skill special case
 * ---------------------------------------------------------------------------
 * The card located the defect on `skill`, and the measurement that opened this
 * work found `agent`, `tool` and `page` duplicate identically under the same
 * shape: the mechanism is the merge's attribution rule, not the type. `skill`
 * is simply a type whose rows arrive through the MetadataService, which is the
 * precondition — hence the `agent` case below, which fails on `origin/main` for
 * exactly the same reason and would keep failing under any fix that special-
 * cased `skill`, or that "registered `skill` like every other type".
 *
 * ---------------------------------------------------------------------------
 * Why there was no coverage before
 * ---------------------------------------------------------------------------
 * The MetadataService merge runs ONLY when a `metadata` service is installed
 * AND answers non-empty for the type; the overlay merge runs only when
 * `sys_metadata` yields an active row. A harness that omits either passes
 * against the bug — the same blind spot #7774 recorded one merge over — so the
 * first case below asserts the precondition itself.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Restoring the hand-rolled `itemMap` body of the MetadataService merge must
 * turn the duplication cases RED naming two rows where one is expected, and
 * must leave `protocol.i18n-bundle-list-merge.test.ts` GREEN — that suite pins
 * the merge's bundle behaviour, which this change does not touch (the slot, and
 * therefore the discriminator, is computed by the same
 * `mergePackageAwareOverlay` either way). A red there would mean this change
 * altered an identity it promised not to. Measured in the PR body.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG = 'com.acme.showcase';
const OTHER_PKG = 'com.acme.partner';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

/** A `sys_metadata` row; `package_id` defaults to NULL — what a runtime PUT writes. */
function row(
    partial: Omit<Partial<Row>, 'metadata'> & { name: string; type: string; metadata: unknown },
): Row {
    return {
        id: `row_${partial.type}_${partial.name}_${partial.package_id ?? 'global'}`,
        organization_id: null,
        package_id: null,
        state: 'active',
        ...partial,
        metadata: JSON.stringify(partial.metadata),
    };
}

/**
 * The registry stub answers `listItems` from `opts.items`, tagged `__type` for
 * the harness and `_packageId` the way the real `SchemaRegistry` tags them. The
 * card's shape leaves it EMPTY: a skill's baseline arrives through the
 * MetadataService.
 */
function makeEngine(opts: { items?: any[]; rows?: Row[] } = {}) {
    return {
        registry: {
            listItems: (type: string, packageId?: string) => {
                const all = (opts.items ?? []) as any[];
                const forType = all.filter((i) => i.__type === type);
                return (packageId ? forType.filter((i) => i._packageId === packageId) : forType)
                    .map(({ __type, ...rest }) => rest);
            },
            isPackageDisabled: () => false,
            registerItem: () => {},
            getItem: () => undefined,
            applyNavContributions: (app: unknown) => app,
        },
        async find(table: string, q: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            return (opts.rows ?? []).filter((r) => {
                for (const [k, v] of Object.entries(q.where)) {
                    if (v === undefined) continue;
                    if ((r as any)[k] !== v) return false;
                }
                return true;
            });
        },
        async findOne() { return null; },
    } as any;
}

/** A `metadata` service that answers `list(type)` from a fixed table. */
function servicesWithMetadata(byType: Record<string, unknown[]>) {
    return () => new Map<string, any>([
        ['metadata', { list: async (type: string) => byType[type] ?? [] }],
    ]);
}

function protocolWith(
    engine: any,
    services?: Record<string, unknown[]>,
): ObjectStackProtocolImplementation {
    const p = new ObjectStackProtocolImplementation(engine);
    if (services) (p as any).getServicesRegistry = servicesWithMetadata(services);
    return p;
}

function skill(name: string, extra: Record<string, unknown> = {}) {
    return { name, label: `Skill ${name}`, ...extra };
}

/** `name|package|active` per served row, sorted — the three facts the card is about. */
function served(items: any[]): string[] {
    return items
        .map((i) => `${i.name}|${i._packageId ?? '(none)'}|${String(i.active)}`)
        .sort();
}

describe('[#7654] the /meta list serves one row per name after a runtime PUT', () => {
    describe('the precondition this defect hides behind', () => {
        it('no `metadata` service installed: the merge never runs and the override is already single', async () => {
            // This case passes on `origin/main` too, and that is the point — it
            // is the shape of harness that made the defect invisible.
            const engine = makeEngine({
                rows: [row({ type: 'skill', name: 'formula-helper', metadata: skill('formula-helper', { active: true }) })],
            });
            const res: any = await protocolWith(engine).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual(['formula-helper|(none)|true']);
        });

        it('a `metadata` service answering non-empty is what arms the merge', async () => {
            // No override row: the baseline passes through untouched, one row.
            const engine = makeEngine();
            const res: any = await protocolWith(engine, {
                skill: [{ ...skill('formula-helper', { active: false }), _packageId: PKG }],
            }).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual(['formula-helper|com.acme.showcase|false']);
        });
    });

    describe("the card's shape: a package-less override over a MetadataService baseline", () => {
        it('serves ONE skill row, the override body, carrying the package it overrides', async () => {
            const engine = makeEngine({
                rows: [row({ type: 'skill', name: 'formula-helper', metadata: skill('formula-helper', { active: true }) })],
            });
            const res: any = await protocolWith(engine, {
                skill: [{ ...skill('formula-helper', { active: false }), _packageId: PKG }],
            }).getMetaItems({ type: 'skill' });

            // On `origin/main` this served TWO rows:
            //   formula-helper|(none)|true          ← the override
            //   formula-helper|com.acme.showcase|false  ← the package row
            expect(res.items).toHaveLength(1);
            expect(served(res.items)).toEqual(['formula-helper|com.acme.showcase|true']);
        });

        it('is not skill-specific: `agent` duplicates and is fixed by the same resolution', async () => {
            const engine = makeEngine({
                rows: [row({ type: 'agent', name: 'triage', metadata: { name: 'triage', active: true } })],
            });
            const res: any = await protocolWith(engine, {
                agent: [{ name: 'triage', active: false, _packageId: PKG }],
            }).getMetaItems({ type: 'agent' });
            expect(served(res.items)).toEqual(['triage|com.acme.showcase|true']);
        });

        it('also collapses the MIRRORED attribution — a package-less baseline under a package-bearing row', async () => {
            // The same disagreement seen from the other side: the higher layer
            // names a package, the MetadataService baseline does not.
            const engine = makeEngine({
                items: [{ __type: 'skill', ...skill('formula-helper', { active: false }), _packageId: PKG }],
                rows: [row({
                    type: 'skill',
                    name: 'formula-helper',
                    package_id: PKG,
                    metadata: skill('formula-helper', { active: true }),
                })],
            });
            const res: any = await protocolWith(engine, {
                skill: [skill('formula-helper', { active: false })],
            }).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual(['formula-helper|com.acme.showcase|true']);
        });
    });

    describe('what the merge must keep doing', () => {
        it('the overlay still WINS over the MetadataService baseline', async () => {
            // The guard the hand-rolled loop existed for: saved per-org
            // dashboard / view overlays disappeared from list endpoints on
            // refresh when the baseline was allowed to win.
            const engine = makeEngine({
                rows: [row({
                    type: 'dashboard',
                    name: 'sales',
                    package_id: PKG,
                    metadata: { name: 'sales', label: 'Customized' },
                })],
            });
            const res: any = await protocolWith(engine, {
                dashboard: [{ name: 'sales', label: 'Shipped', _packageId: PKG }],
            }).getMetaItems({ type: 'dashboard' });
            expect(res.items).toHaveLength(1);
            expect((res.items as any[])[0].label).toBe('Customized');
        });

        it('ADR-0048: two packages shipping the same name stay TWO rows', async () => {
            const engine = makeEngine();
            const res: any = await protocolWith(engine, {
                skill: [
                    { ...skill('summarize', { active: true }), _packageId: PKG },
                    { ...skill('summarize', { active: false }), _packageId: OTHER_PKG },
                ],
            }).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual([
                'summarize|com.acme.partner|false',
                'summarize|com.acme.showcase|true',
            ]);
        });

        it('a package-less override reaches BOTH packages that ship the name', async () => {
            // The resolution this change adopts, stated as behaviour: a
            // package-less row stands in for each package's slot — exactly what
            // `getMetaItem(name, packageId=P)` answers for either P.
            const engine = makeEngine({
                rows: [row({ type: 'skill', name: 'summarize', metadata: skill('summarize', { active: true }) })],
            });
            const res: any = await protocolWith(engine, {
                skill: [
                    { ...skill('summarize', { active: false }), _packageId: PKG },
                    { ...skill('summarize', { active: false }), _packageId: OTHER_PKG },
                ],
            }).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual([
                'summarize|com.acme.partner|true',
                'summarize|com.acme.showcase|true',
            ]);
        });

        it('a runtime item with NO override is served unchanged alongside an overridden sibling', async () => {
            const engine = makeEngine({
                rows: [row({ type: 'skill', name: 'formula-helper', metadata: skill('formula-helper', { active: true }) })],
            });
            const res: any = await protocolWith(engine, {
                skill: [
                    { ...skill('formula-helper', { active: false }), _packageId: PKG },
                    { ...skill('untouched', { active: false }), _packageId: PKG },
                ],
            }).getMetaItems({ type: 'skill' });
            expect(served(res.items)).toEqual([
                'formula-helper|com.acme.showcase|true',
                'untouched|com.acme.showcase|false',
            ]);
        });
    });
});
