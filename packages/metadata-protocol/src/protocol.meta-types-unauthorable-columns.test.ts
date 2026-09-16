// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17502] `GET /meta/types` must not offer a column the publish door refuses.
 *
 * ## The defect, measured on the SERVED payload
 *
 * `retiredKey()` keeps a removed authorable key declared so the retirement is
 * audible, and `z.toJSONSchema` renders that tombstone as a property node:
 *
 *     { "description": "[REMOVED] <prescription>", "not": {} }
 *
 * `not: {}` says "no instance validates", so a consumer reading the SUBSCHEMA
 * is told the truth. Studio's repeater table does not read the subschema — it
 * builds its column headers from `items.properties[k].title ?? k` — so every
 * tombstone in a row shape became a column an author is invited to fill and
 * `saveMetaItem` then refuses.
 *
 * Measured on `origin/main` at 74eaab8614 over the whole served registry:
 * **80 tombstone nodes across 16 types**. Five of them are `dashboard.widgets[]`'s
 * `actionUrl`, `actionType`, `actionIcon`, `responsive` and `aria` — the row
 * this file pins, and the carrier the card was filed on. ⚠️ They are not the
 * whole reachable set: a repeater row in another type reaches an author the
 * same way, as does the flat schema-driven fallback for a layout-less type and
 * an inspector that grafts server-only properties into a "More fields" section.
 * How many sites there are at any moment is a function of the renderer and of
 * the pinned Console build, so no count of them is pinned here — the class
 * guard below is over the whole registry instead.
 *
 * ⚠️ The card's headline carrier, `flow.nodes[].outputSchema`, is NOT on the
 * served path: `flow` takes the output derivation, where `nodes.items` carries
 * no properties at all. It is visible only in the `io: 'input'` derivation that
 * `packages/spec`'s `repeater-item-titles.test.ts` takes deliberately. The
 * empty served `flow.nodes` row is a separate defect and is not this pin's.
 *
 * ## What this pin asserts, and why each half is here
 *
 * The verdict is structural, never the `[REMOVED] ` description prefix: a
 * prefix match would be a second hand-written spelling of "this is a
 * tombstone" living in a consumer, which is the shape this card removes.
 *
 * Both controls matter. The DARK half (the five columns are gone) passes
 * vacuously if the harness never reached the row, so the LIT half pins the
 * seventeen live columns that must survive beside them, and a third control
 * re-derives the pre-strip payload in-process and requires the nodes to be
 * there — which is what makes this file fail on `origin/main` today rather
 * than describe a payload nobody produced.
 *
 * Harness: the real `getMetaTypes()` on one protocol instance over a stub
 * engine — the same shape `protocol.meta-types-degenerate-derivation.test.ts`
 * uses, so the assertions are about what the endpoint SERVES and not about a
 * derivation picked for convenience.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { acceptsNothing } from './unauthorable-nodes.js';

const SERVED_TYPES = Array.from(new Set([
    ...DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type),
    ...Object.keys(METADATA_FORM_REGISTRY),
])).sort();

function makeProtocol() {
    const engine: any = {
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query); return null;
        },
        async find() { return []; },
        async insert() { return { id: 'unused' }; },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            getRegisteredTypes: () => [...SERVED_TYPES],
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
}

async function servedSchemas(): Promise<Map<string, Record<string, unknown> | undefined>> {
    const listing = await makeProtocol().getMetaTypes();
    const map = new Map<string, Record<string, unknown> | undefined>();
    for (const entry of listing.entries as Array<{ type: string; schema?: Record<string, unknown> }>) {
        map.set(entry.type, entry.schema);
    }
    return map;
}

/** The derivation the endpoint ran BEFORE this card's strip stage. */
function preStripDerivation(type: string, io: 'output' | 'input' = 'output'): Record<string, unknown> | undefined {
    const schema = getMetadataTypeSchema(type);
    if (!schema) return undefined;
    try {
        return z.toJSONSchema(schema as z.ZodTypeAny, { unrepresentable: 'any', io }) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/**
 * What the strip DID to one document, read off the two documents by a parallel
 * walk rather than by re-running the strip: `removed` is every key the
 * derivation has and the served payload does not, with the node that was
 * dropped; `other` is everything else that moved — an addition, a changed
 * value, a changed array length.
 *
 * ⚠️ Deliberately NOT a second implementation of the strip. It asks only
 * "what moved"; the assertion supplies the verdict, so a defect in the strip
 * cannot appear on both sides of the comparison and cancel itself out.
 */
function strippedDiff(
    before: unknown,
    after: unknown,
): { removed: Array<{ path: string; node: unknown }>; other: string[] } {
    const removed: Array<{ path: string; node: unknown }> = [];
    const other: string[] = [];
    const visit = (b: unknown, a: unknown, p: string): void => {
        if (Array.isArray(b) || Array.isArray(a)) {
            if (!Array.isArray(b) || !Array.isArray(a) || b.length !== a.length) { other.push(p); return; }
            b.forEach((entry, i) => visit(entry, a[i], `${p}[${i}]`));
            return;
        }
        if (b && typeof b === 'object') {
            if (!a || typeof a !== 'object') { other.push(p); return; }
            const bo = b as Record<string, unknown>;
            const ao = a as Record<string, unknown>;
            for (const [key, value] of Object.entries(bo)) {
                if (!(key in ao)) { removed.push({ path: `${p}.${key}`, node: value }); continue; }
                visit(value, ao[key], `${p}.${key}`);
            }
            for (const key of Object.keys(ao)) if (!(key in bo)) other.push(`${p}.${key}`);
            return;
        }
        if (b !== a) other.push(p);
    };
    visit(before, after, '$');
    return { removed, other };
}

/**
 * Every `<path>` in a JSON Schema document whose subschema admits no instance.
 * Walks the document generically so a tombstone that moves house — into a
 * `$defs` entry, a union arm, a deeper row — is still found.
 */
function unsatisfiablePaths(node: unknown, path = '$'): string[] {
    if (Array.isArray(node)) return node.flatMap((n, i) => unsatisfiablePaths(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return [];
    const out: string[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'default' || key === 'const' || key === 'enum' || key === 'examples') continue;
        if (key === 'properties' && value && typeof value === 'object') {
            for (const [prop, sub] of Object.entries(value as Record<string, unknown>)) {
                if (acceptsNothing(sub)) out.push(`${path}.properties.${prop}`);
            }
        }
        out.push(...unsatisfiablePaths(value, `${path}.${key}`));
    }
    return out;
}

/** `dashboard.widgets[]`'s row shape, off the served document. */
function widgetRow(served: Record<string, unknown> | undefined): Record<string, unknown> {
    const widgets = (served?.properties as any)?.widgets;
    const items = widgets?.items;
    const resolved = typeof items?.$ref === 'string'
        ? (served as any).$defs?.[String(items.$ref).replace('#/$defs/', '')]
        : items;
    return (resolved?.properties ?? {}) as Record<string, unknown>;
}

/** The five columns the parse door refuses (`ui/dashboard.zod.ts` tombstones). */
const RETIRED_WIDGET_COLUMNS = ['actionUrl', 'actionType', 'actionIcon', 'responsive', 'aria'] as const;

/** The live columns that must survive beside them — the lit control. */
const LIVE_WIDGET_COLUMNS = [
    'chartConfig', 'colorVariant', 'compareTo', 'dataset', 'description', 'dimensions',
    'filter', 'filterBindings', 'id', 'layout', 'options', 'requiresObject',
    'requiresService', 'suppressWarnings', 'title', 'type', 'values',
] as const;

describe('#17502 — the served repeater row offers no column the parse door refuses', () => {
    it('control: the pre-strip derivation really did carry the five tombstone columns', () => {
        // Without this, both halves below could pass over a payload that never
        // had the nodes — and the pin would be green on `origin/main` too.
        const row = widgetRow(preStripDerivation('dashboard'));
        for (const key of RETIRED_WIDGET_COLUMNS) {
            expect(Object.keys(row), `pre-strip dashboard.widgets row declares ${key}`).toContain(key);
            expect(acceptsNothing((row as any)[key]), `${key} is a node that admits nothing`).toBe(true);
            expect(String((row as any)[key].description)).toMatch(/^\[REMOVED\] /);
        }
        expect(Object.keys(row).length).toBe(22);
    });

    it('lit: the served `dashboard.widgets` row still carries every live column', async () => {
        const row = widgetRow((await servedSchemas()).get('dashboard'));
        expect(Object.keys(row).sort()).toEqual([...LIVE_WIDGET_COLUMNS].sort());
    });

    it('dark: the five retired columns are gone from the served row', async () => {
        const row = widgetRow((await servedSchemas()).get('dashboard'));
        for (const key of RETIRED_WIDGET_COLUMNS) {
            expect(Object.keys(row), `dashboard.widgets must not offer ${key}`).not.toContain(key);
        }
    });

    it('class guard: no served type publishes a property that admits no instance', async () => {
        const served = await servedSchemas();
        const offenders: string[] = [];
        for (const type of SERVED_TYPES) {
            const schema = served.get(type);
            if (!schema) continue;
            offenders.push(...unsatisfiablePaths(schema, type));
        }
        // ⛔ An entry here is a key the endpoint advertises and the publish door
        // refuses — file it, never add it to a list.
        expect(offenders).toEqual([]);
    });

    it('over-drop guard: the served payload is its derivation MINUS unsatisfiable nodes, nothing else', async () => {
        // ⚠️ This is the direction the blast-radius pin in
        // `protocol.meta-types-degenerate-derivation.test.ts` CANNOT see. Since
        // #17502 its baseline is `stripUnauthorableProperties(preFixDerivation(type))`,
        // so a strip that drops too much drops it on BOTH sides of that
        // comparison and stays invisible — only `dashboard.widgets`'s lit
        // columns and the CARD types' TOP-level counts guard over-dropping
        // there. This pin reads the removals themselves, at every depth, for
        // every served type. The one question this pin asks: did that node
        // admit any instance?
        const served = await servedSchemas();
        const unexplained: string[] = [];
        const overDropped: string[] = [];
        const removedByType = new Map<string, string[]>();

        for (const type of SERVED_TYPES) {
            const after = served.get(type);
            if (!after) continue;
            // The endpoint derives on zod's default arm and retries `io: 'input'`
            // only when the default one is degenerate (#17501). Take whichever
            // arm the served document is a pure DELETION of, so this pin never
            // re-spells `isDegenerateDerivation`, whose only copy belongs in
            // the emitter.
            const diff = (['output', 'input'] as const)
                .map((io) => preStripDerivation(type, io))
                .filter((d): d is Record<string, unknown> => Boolean(d))
                .map((before) => strippedDiff(before, after))
                .find((d) => d.other.length === 0);
            if (!diff) { unexplained.push(type); continue; }
            removedByType.set(type, diff.removed.map((r) => `${type}${r.path.slice(1)}`));
            for (const r of diff.removed) {
                if (!acceptsNothing(r.node)) overDropped.push(`${type}${r.path.slice(1)}`);
            }
        }

        // ⛔ The strip only ever takes keys AWAY. An entry here means the served
        // payload is no longer either derivation minus something.
        expect(unexplained).toEqual([]);
        // ⛔ An entry here is a LIVE node the endpoint stopped serving — the
        // over-drop defect. File it, never add it to a list.
        expect(overDropped).toEqual([]);

        // Non-vacuity: without this the two assertions above pass over a ledger
        // that read nothing at all. `dashboard` is the type that exercises both
        // depths — the five repeater-row columns pinned above, and three
        // top-level tombstones — so the ledger is proven to reach a row shape
        // and not only the surface. Sorted, so key ORDER is not what is pinned.
        expect([...(removedByType.get('dashboard') ?? [])].sort()).toEqual([
            ...RETIRED_WIDGET_COLUMNS.map((k) => `dashboard.properties.widgets.items.properties.${k}`),
            'dashboard.properties.refreshInterval',
            'dashboard.properties.aria',
            'dashboard.properties.performance',
            // [#17751, arrived with main] `ChartConfigSchema.aria` retired one
            // level deeper than the widget row, inside `chartConfig`.
            'dashboard.properties.widgets.items.properties.chartConfig.properties.aria',
        ].sort());
    });

    // ⚠️ This control derives with zod's DEFAULT (output) arm only, which is
    // 77 nodes across 15 types. The served payload carries 80 across 16: for
    // `action` alone `toJsonSchemaSafe` falls through to the `io: 'input'`
    // retry (#17501), and that arm adds `execute` / `shortcut` / `bulkEnabled`.
    // The class guard above runs over the SERVED document and covers all 80;
    // this control deliberately does not re-spell `isDegenerateDerivation`,
    // whose only copy belongs in the emitter.
    it('control: the class really is non-empty before the strip — 77 nodes across 15 types on the output arm', () => {
        const byType = new Map<string, number>();
        for (const type of SERVED_TYPES) {
            const before = preStripDerivation(type);
            if (!before) continue;
            const n = unsatisfiablePaths(before, type).length;
            if (n > 0) byType.set(type, n);
        }
        const total = [...byType.values()].reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(0);
        expect(byType.has('dashboard')).toBe(true);
    });
});

describe('#17502 — the removal is payload-only: every prescription channel survives', () => {
    it('the parse still refuses the key with the tombstone prescription, byte for byte', async () => {
        const dashboard = getMetadataTypeSchema('dashboard') as z.ZodTypeAny;
        const result = dashboard.safeParse({
            name: 'ops', label: 'Ops',
            widgets: [{ id: 'w1', type: 'metric', actionUrl: '/x' }],
        } as never);
        expect(result.success, 'a retired widget column is still refused at publish').toBe(false);
        const issue = result.error!.issues.find((i) => i.path[i.path.length - 1] === 'actionUrl');
        expect(issue, 'the refusal names the retired key').toBeDefined();
        expect((issue as { expected?: string }).expected).toBe('never');
        // The prescription — the FROM -> TO mapping this retirement exists to
        // deliver — is carried by the refusal, which the strip never touches.
        expect(issue!.message).toContain('was removed in @objectstack/spec 17.0.0');
        expect(issue!.message).toContain('header: { actions:');
        expect(issue!.message).toContain('os migrate meta --from 16');
    });

    it('the Zod shape still declares the tombstone — nothing is un-retired upstream', () => {
        // `packages/spec`'s `authorable-surface/` ratchet and the generated
        // reference pages read this shape, not the served payload, so both keep
        // publishing the retirement. The strip is a property of ONE emitter.
        const row = widgetRow(preStripDerivation('dashboard'));
        for (const key of RETIRED_WIDGET_COLUMNS) {
            expect(Object.keys(row)).toContain(key);
        }
    });
});
