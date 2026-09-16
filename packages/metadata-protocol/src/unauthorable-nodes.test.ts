// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17502] Unit pins for the strip stage itself. The served-payload assertions
 * live in `protocol.meta-types-unauthorable-columns.test.ts`; this file covers
 * the two behaviours that have no live carrier today and would therefore never
 * be exercised by the registry sweep — the `required` guard and copy-on-write.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { acceptsNothing, stripUnauthorableProperties } from './unauthorable-nodes.js';

const NEVER = { description: '[REMOVED] `x` was removed. Delete the key.', not: {} };

describe('acceptsNothing', () => {
    it('recognises the `{ not: {} }` node zod emits for `z.never()`, in both derivations', () => {
        const shape = z.object({ live: z.string(), dead: z.never().optional().describe('[REMOVED] gone') });
        for (const io of ['output', 'input'] as const) {
            const json = z.toJSONSchema(shape, { unrepresentable: 'any', io }) as any;
            expect(acceptsNothing(json.properties.dead), `io=${io}`).toBe(true);
            expect(acceptsNothing(json.properties.live), `io=${io}`).toBe(false);
        }
    });

    it('is not fooled by a NON-empty `not`, which still admits instances', () => {
        expect(acceptsNothing({ not: { type: 'string' } })).toBe(false);
        expect(acceptsNothing({ not: [] })).toBe(false);
        expect(acceptsNothing({ not: null })).toBe(false);
        expect(acceptsNothing(undefined)).toBe(false);
    });
});

describe('stripUnauthorableProperties', () => {
    it('drops an optional unsatisfiable property at every depth, rows and $defs included', () => {
        const out: any = stripUnauthorableProperties({
            type: 'object',
            properties: {
                top: NEVER,
                live: { type: 'string' },
                rows: { type: 'array', items: { type: 'object', properties: { col: NEVER, keep: { type: 'number' } } } },
                map: { type: 'object', additionalProperties: { type: 'object', properties: { inner: NEVER } } },
            },
            $defs: { Shared: { type: 'object', properties: { held: NEVER, kept: { type: 'boolean' } } } },
        });
        expect(Object.keys(out.properties)).toEqual(['live', 'rows', 'map']);
        expect(Object.keys(out.properties.rows.items.properties)).toEqual(['keep']);
        expect(Object.keys(out.properties.map.additionalProperties.properties)).toEqual([]);
        expect(Object.keys(out.$defs.Shared.properties)).toEqual(['kept']);
    });

    it('KEEPS an unsatisfiable property that is `required` — dropping it would widen the shape', () => {
        // `{ not: {} }` + required === the object admits nothing. Removing the
        // key would turn that into "admits anything", a real widening. No
        // `retiredKey()` is ever required (it is `.optional()`), so this guard
        // exists for whatever else may derive to the same node.
        const input = { type: 'object', required: ['dead'], properties: { dead: NEVER, live: { type: 'string' } } };
        const out: any = stripUnauthorableProperties(input);
        expect(Object.keys(out.properties)).toEqual(['dead', 'live']);
        expect(out).toBe(input); // nothing to drop ⇒ returned by reference
    });

    it('is copy-on-write: a document with nothing to drop comes back by reference', () => {
        const input = { type: 'object', properties: { a: { type: 'string' } }, $defs: { B: { type: 'number' } } };
        expect(stripUnauthorableProperties(input)).toBe(input);
    });

    it('is POSITION-aware: a property literally NAMED `properties` is not a properties map', () => {
        // A `properties` / `$defs` value is a map of author-chosen NAMES, not a
        // schema node. A walk that reads the map as a node reads the keywords of
        // the property named `properties` as property subschemas — and deletes
        // any one valued `{ not: {} }`. Both inputs below are pure zod.
        const record: any = z.toJSONSchema(z.object({ properties: z.record(z.string(), z.never()) }), { unrepresentable: 'any' });
        expect(record.properties.properties.additionalProperties, 'precondition').toEqual({ not: {} });
        const strippedRecord: any = stripUnauthorableProperties(record);
        // `additionalProperties: { not: {} }` is what makes this node admit ONLY
        // `{}`. Dropping it lets any object through — a widening of a live node.
        expect(strippedRecord.properties.properties.additionalProperties).toEqual({ not: {} });
        expect(strippedRecord).toBe(record); // nothing to drop ⇒ by reference

        const list: any = z.toJSONSchema(z.object({ properties: z.array(z.never()) }), { unrepresentable: 'any' });
        expect(list.properties.properties.items, 'precondition').toEqual({ not: {} });
        const strippedList: any = stripUnauthorableProperties(list);
        // `items: { not: {} }` is what makes this node admit ONLY `[]`.
        expect(strippedList.properties.properties.items).toEqual({ not: {} });
        expect(strippedList).toBe(list);
    });

    it('is POSITION-aware in `$defs` too, where the entry names are just as free', () => {
        const input = { $defs: { properties: { type: 'object', additionalProperties: { not: {} } } } };
        const out: any = stripUnauthorableProperties(input);
        expect(out.$defs.properties.additionalProperties).toEqual({ not: {} });
        expect(out).toBe(input);
    });

    it('still strips inside a property whose NAME collides with a data-valued keyword', () => {
        // The mirror of the two above: the map's VALUES are schema nodes
        // whatever they are called, so `required` and `default` as property
        // NAMES must not buy their subtrees an exemption from the walk.
        const input = {
            type: 'object',
            properties: {
                required: { type: 'object', properties: { dead: NEVER, live: { type: 'string' } } },
                default: { type: 'object', properties: { dead: NEVER } },
            },
        };
        const out: any = stripUnauthorableProperties(input);
        expect(Object.keys(out.properties.required.properties)).toEqual(['live']);
        expect(Object.keys(out.properties.default.properties)).toEqual([]);
    });

    it('never rewrites DATA-valued keywords that merely look like a schema', () => {
        // `default` carries an author's value, not a subschema. A walk that
        // treats it as one silently edits served defaults.
        const input = { type: 'object', default: { properties: { dead: { not: {} } } }, properties: { live: { type: 'string' } } };
        const out: any = stripUnauthorableProperties(input);
        expect(out.default).toEqual({ properties: { dead: { not: {} } } });
    });
});
