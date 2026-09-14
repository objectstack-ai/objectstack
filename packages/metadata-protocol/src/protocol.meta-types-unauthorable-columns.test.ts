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
 * Measured on `origin/main` at 1bdbf82cb5 over the whole served registry:
 * **77 tombstone nodes across 14 types**, of which exactly **5** are reachable
 * as repeater columns — `dashboard.widgets[]`'s `actionUrl`, `actionType`,
 * `actionIcon`, `responsive`, `aria`. Every other tombstone sits where the
 * consumer does not derive its key list from the schema (a top-level property,
 * whose column set `*.form.ts` enumerates by hand — the #5280 fix).
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
function preStripDerivation(type: string): Record<string, unknown> | undefined {
    const schema = getMetadataTypeSchema(type);
    if (!schema) return undefined;
    try {
        return z.toJSONSchema(schema as z.ZodTypeAny, { unrepresentable: 'any' }) as Record<string, unknown>;
    } catch {
        return undefined;
    }
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

    it('control: the class really is non-empty before the strip — 77 nodes across 14 types', () => {
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
