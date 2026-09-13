// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17501] `GET /meta/types` must not serve an empty JSON Schema for a type
 * that accepts 48 keys.
 *
 * ## What was wrong
 *
 * `ActionSchema` is `lazySchema(() => actionObject().refine(...))`, a `ZodPipe`,
 * and the OUTPUT derivation of a pipe carries no properties. The protocol
 * derived what it serves with `z.toJSONSchema(schema, { unrepresentable: 'any' })`
 * — zod's default `io: 'output'` — so `action` was advertised as the husk
 * `{"$schema": "https://json-schema.org/draft/2020-12/schema"}`. The
 * hand-crafted fallback declared for exactly this case never fired: conversion
 * did not throw, it SUCCEEDED, and a truthy husk short-circuits `??`.
 *
 * ## Why this suite pins a COUNT and not just `action`
 *
 * The obvious repair is to derive everything with `io: 'input'`. It was
 * measured across the whole served surface and refused: 24 of the 26 types
 * carrying a Zod schema answer differently under `input`, and the direction is
 * a WEAKENING of a published contract (`required` entries 1132 to 867,
 * `additionalProperties: false` 663 to 637). So the fix gates the authoring
 * derivation behind a degeneracy check, and the load-bearing assertion is the
 * BLAST RADIUS: exactly one served type may differ from the pre-fix
 * derivation. A suite that only pinned `action`'s 48 keys would stay green
 * through a later widening to `io: 'input'` for everything — which is the
 * change this card exists to refuse. This one goes red on it.
 *
 * ⚠️ The pre-fix baseline is recomputed here from the raw output derivation
 * rather than checked in, so the assertion keeps meaning as schemas evolve: it
 * always asks "how many types does the degeneracy retry move, TODAY".
 *
 * ## The positive control matters as much as the pin
 *
 * The card that filed this reported thirteen types as "identical under both io
 * settings". Those numbers are correct and reproduce exactly — they are
 * top-level PROPERTY COUNTS. What they cannot see is `required` and
 * `additionalProperties`, which is where the payload difference actually lives,
 * and reading payload identity out of them is what produced the wrong first
 * ruling. The counts are pinned below as a control proving this suite's
 * instrument agrees with the card wherever the card actually measured, and the
 * canonicalising comparison is what tells content apart from key ordering.
 *
 * Harness: the real `getMetaTypes()` on one protocol instance over a stub
 * engine, so the assertions are about what the endpoint SERVES. A pin taken on
 * a derivation chosen for convenience would not cover the served path at all —
 * that is precisely the gap #17500's `io: 'input'` pin deliberately left open.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The whole served surface: every declared metadata type plus every
 * form-bearing one. Passed through the stub registry so `getMetaTypes()` lists
 * them all — the blast-radius count is only meaningful over the full set.
 */
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

/** The served derivation as it behaved BEFORE the fix: zod's default `io: 'output'`. */
function preFixDerivation(type: string): Record<string, unknown> | undefined {
    const schema = getMetadataTypeSchema(type);
    if (!schema) return undefined;
    try {
        return z.toJSONSchema(schema as z.ZodTypeAny, { unrepresentable: 'any' }) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/**
 * Recursive key sort. Two documents that differ only in key ORDER canonicalise
 * to the same string; anything still different after this is real content.
 */
function canonicalise(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalise);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = canonicalise((value as Record<string, unknown>)[k]);
        }
        return out;
    }
    return value;
}
const canon = (v: unknown) => JSON.stringify(canonicalise(v));

async function servedSchemas(): Promise<Map<string, Record<string, unknown> | undefined>> {
    const listing = await makeProtocol().getMetaTypes();
    const map = new Map<string, Record<string, unknown> | undefined>();
    for (const entry of listing.entries as Array<{ type: string; schema?: Record<string, unknown> }>) {
        map.set(entry.type, entry.schema);
    }
    return map;
}

describe('#17501 — /meta/types serves a real schema for `action`, and moves nothing else', () => {
    it('serves `action` with a populated schema, not the empty husk', async () => {
        const served = (await servedSchemas()).get('action');

        expect(served, '`action` must be served with a schema').toBeDefined();
        // The exact document the endpoint used to serve, pinned as the thing
        // that must never come back.
        expect(canon(served)).not.toBe(canon({ $schema: 'https://json-schema.org/draft/2020-12/schema' }));
        expect(served!.type).toBe('object');

        const properties = served!.properties as Record<string, unknown>;
        expect(properties, '`action` must name its properties').toBeDefined();
        expect(Object.keys(properties).length).toBe(48);
        // A sample an author would actually address, and the one #17500's
        // repeater titles need a node to sit on.
        for (const key of ['name', 'label', 'objectName', 'type', 'params', 'locations']) {
            expect(Object.keys(properties)).toContain(key);
        }
    });

    it('moves the served payload of EXACTLY one type — the blast-radius pin', async () => {
        const served = await servedSchemas();

        const moved: string[] = [];
        for (const type of SERVED_TYPES) {
            if (!getMetadataTypeSchema(type)) continue; // absence is not degeneracy — see below
            const before = preFixDerivation(type);
            const after = served.get(type);
            if (canon(before) !== canon(after)) moved.push(type);
        }

        // ⛔ If this ever reads more than one, the degeneracy gate has been
        // widened into a blanket `io: 'input'` — which weakens the published
        // contract for every other type and is a `packages/spec` decision, not
        // a change this file may make.
        expect(moved).toEqual(['action']);
    });

    it('leaves every other type byte-identical, ordering excluded as a cause', async () => {
        const served = await servedSchemas();

        for (const type of SERVED_TYPES) {
            if (type === 'action' || !getMetadataTypeSchema(type)) continue;
            const before = preFixDerivation(type);
            const after = served.get(type);
            // Raw equality first: these must not move at all.
            expect(JSON.stringify(after), `${type} served payload moved`).toBe(JSON.stringify(before));
            // And canonicalised, so a future reordering cannot be mistaken for
            // a content change by the assertion above.
            expect(canon(after)).toBe(canon(before));
        }
    });

    it('absence is not degeneracy: a type with no zod schema still serves no schema', async () => {
        // `external_catalog` is declared in the registry but resolves no zod
        // schema. Advertising nothing is honest; advertising an empty object is
        // the lie this card closes. The retry must not invent a document here.
        expect(getMetadataTypeSchema('external_catalog')).toBeFalsy();
        expect((await servedSchemas()).get('external_catalog')).toBeUndefined();
    });

    /**
     * Positive control. These are the card's own thirteen counts, reproduced
     * against the SERVED document. They prove two things at once: this suite
     * measures the same thing the card measured, and none of the thirteen was
     * disturbed by the fix.
     */
    const CARD_PROPERTY_COUNTS: Record<string, number> = {
        agent: 26, app: 30, dashboard: 21, dataset: 16, field: 74, flow: 23,
        hook: 22, object: 43, page: 24, position: 12, report: 21, skill: 17, tool: 14,
    };

    it.each(Object.entries(CARD_PROPERTY_COUNTS))(
        'control: `%s` still serves %i top-level properties',
        async (type, count) => {
            const served = (await servedSchemas()).get(type as string);
            expect(served, `${type} must be served`).toBeDefined();
            expect(Object.keys(served!.properties as Record<string, unknown>).length).toBe(count);
        },
    );

    it('control: `view` still answers a four-arm union', async () => {
        const served = (await servedSchemas()).get('view');
        expect(Array.isArray(served!.anyOf)).toBe(true);
        expect((served!.anyOf as unknown[]).length).toBe(4);
    });
});
