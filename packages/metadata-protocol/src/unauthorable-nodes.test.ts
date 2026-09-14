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

    it('never rewrites DATA-valued keywords that merely look like a schema', () => {
        // `default` carries an author's value, not a subschema. A walk that
        // treats it as one silently edits served defaults.
        const input = { type: 'object', default: { properties: { dead: { not: {} } } }, properties: { live: { type: 'string' } } };
        const out: any = stripUnauthorableProperties(input);
        expect(out.default).toEqual({ properties: { dead: { not: {} } } });
    });
});
