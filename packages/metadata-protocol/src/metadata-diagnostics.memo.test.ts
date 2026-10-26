// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25783 — the diagnostics verdict memo answers what a fresh parse answers,
 * and parses a document once per schema however many reads serve it.
 *
 * Every served metadata read stamps `_diagnostics` on every item, and that
 * stamp was a full `safeParse` per item per read: 60 ms of an 86 ms
 * `GET /meta/object` over 108 unchanged objects. `computeMetadataDiagnostics`
 * now remembers a verdict by the schema object and the document's content
 * ("The verdict memo" in `metadata-diagnostics.ts`). These rows pin the two
 * halves of that promise:
 *
 *  - **The served bytes do not move.** A memo hit serves, byte for byte, what
 *    a fresh parse of the same document under a schema with no memo serves —
 *    a valid document and an invalid one, on the real `object` schema.
 *  - **Nothing the parse can tell apart shares a key.** A changed document, a
 *    replaced schema, `undefined` against a missing key, an array hole against
 *    `null`, `NaN` against `null` — each is parsed again and gets its own
 *    verdict. A document with no faithful key (a function, `-0`, a nesting past
 *    the keyable depth) is parsed every time, as before the memo.
 *
 * The instrument: a schema behind a proxy that counts its `safeParse` calls,
 * registered for a probe type through `registerMetadataTypeSchema`. A fresh
 * proxy per test is a fresh memo, because the memo is held per schema object.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getMetadataTypeSchema, registerMetadataTypeSchema } from '@objectstack/spec/kernel';
import { computeMetadataDiagnostics, decorateMetadataItem } from './metadata-diagnostics.js';

/** A type no build registers, so binding it touches no real type's schema. */
const PROBE = 'memo_probe_25783';

const PROBE_SCHEMA = z.object({
    name: z.string(),
    tags: z.array(z.string().nullable()).optional(),
    weight: z.number().nullable().optional(),
    nested: z.unknown().optional(),
    handler: z.unknown().optional(),
}).strict();

let parses = 0;

/** Bind `schema` to `type` behind a proxy that counts parses; returns the proxy. */
function bindCounting(type: string, schema: z.ZodType): z.ZodType {
    const counting = new Proxy(schema, {
        get(target, prop, receiver) {
            if (prop === 'safeParse') {
                return (...args: unknown[]) => {
                    parses += 1;
                    return (target.safeParse as (...a: unknown[]) => unknown).apply(target, args);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    registerMetadataTypeSchema(type, counting);
    return counting;
}

beforeEach(() => {
    parses = 0;
    bindCounting(PROBE, PROBE_SCHEMA);
});

describe('#25783 the verdict memo — one parse per document per schema', () => {
    it('answers a repeated document from the memo, a structurally equal copy included', () => {
        const doc = { name: 'a', tags: ['x'] };
        expect(computeMetadataDiagnostics(PROBE, doc)).toEqual({ valid: true });
        expect(computeMetadataDiagnostics(PROBE, doc)).toEqual({ valid: true });
        // A row read again from the store is a new object with the same content.
        expect(computeMetadataDiagnostics(PROBE, JSON.parse(JSON.stringify(doc)))).toEqual({ valid: true });
        expect(parses).toBe(1);
    });

    it('keys the document without its read decorations, as the parse sees it', () => {
        const doc = { name: 'a' };
        computeMetadataDiagnostics(PROBE, doc);
        // The served body of the same document, decorations and all.
        computeMetadataDiagnostics(PROBE, { ...doc, _diagnostics: { valid: true } });
        expect(parses).toBe(1);
    });

    it('parses a changed document again', () => {
        expect(computeMetadataDiagnostics(PROBE, { name: 'a' })?.valid).toBe(true);
        expect(computeMetadataDiagnostics(PROBE, { name: 'a', bogus: 1 })?.valid).toBe(false);
        expect(computeMetadataDiagnostics(PROBE, { name: 'b' })?.valid).toBe(true);
        expect(parses).toBe(3);
    });

    it('starts from nothing when the type schema is replaced', () => {
        const doc = { name: 'a', extra: 1 };
        expect(computeMetadataDiagnostics(PROBE, doc)?.valid).toBe(false);
        bindCounting(PROBE, PROBE_SCHEMA.passthrough());
        expect(computeMetadataDiagnostics(PROBE, doc)?.valid).toBe(true);
        expect(parses).toBe(2);
    });

    it('hands each caller its own copy of a verdict', () => {
        const doc = { name: 'a', bogus: 1 };
        const first = computeMetadataDiagnostics(PROBE, doc)!;
        const pristine = JSON.stringify(first);
        first.valid = true;
        first.errors![0]!.message = 'edited by a caller';
        first.errors!.push({ path: 'x', message: 'pushed by a caller', code: 'custom' } as never);
        expect(JSON.stringify(computeMetadataDiagnostics(PROBE, doc))).toBe(pristine);
        expect(parses).toBe(1);
    });

    it('keeps at most 4096 verdicts per schema, the least recently used out first', () => {
        computeMetadataDiagnostics(PROBE, { name: 'kept' });
        computeMetadataDiagnostics(PROBE, { name: 'evicted' });
        for (let i = 0; i < 4094; i++) computeMetadataDiagnostics(PROBE, { name: `n${i}` });
        // 4096 held. Touch `kept`, so `evicted` is now the least recently used.
        computeMetadataDiagnostics(PROBE, { name: 'kept' });
        computeMetadataDiagnostics(PROBE, { name: 'one more' });
        const before = parses;
        computeMetadataDiagnostics(PROBE, { name: 'kept' });
        expect(parses - before).toBe(0);
        computeMetadataDiagnostics(PROBE, { name: 'evicted' });
        expect(parses - before).toBe(1);
    });
});

describe('#25783 the verdict memo — no two documents the parse tells apart share a verdict', () => {
    // Each pair is run in both orders: whichever is diagnosed first, the
    // second must get its own parse and its own verdict.
    const pairs: Array<[label: string, accepted: () => unknown, refused: () => unknown]> = [
        ['a missing key against the same key holding `undefined` (strict schema)',
            () => ({ name: 'a' }),
            () => ({ name: 'a', undeclared: undefined })],
        ['`null` against an array hole',
            () => ({ name: 'a', tags: [null, 'x'] }),
            () => {
                const tags: unknown[] = [];
                tags[1] = 'x'; // index 0 is a hole: JSON.stringify spells it `null`
                return { name: 'a', tags };
            }],
        ['`null` against `NaN`',
            () => ({ name: 'a', weight: null }),
            () => ({ name: 'a', weight: Number.NaN })],
    ];

    for (const [label, accepted, refused] of pairs) {
        for (const order of ['accepted first', 'refused first'] as const) {
            it(`${label} — ${order}`, () => {
                if (order === 'accepted first') {
                    expect(computeMetadataDiagnostics(PROBE, accepted())?.valid).toBe(true);
                    expect(computeMetadataDiagnostics(PROBE, refused())?.valid).toBe(false);
                } else {
                    expect(computeMetadataDiagnostics(PROBE, refused())?.valid).toBe(false);
                    expect(computeMetadataDiagnostics(PROBE, accepted())?.valid).toBe(true);
                }
                expect(parses).toBe(2);
            });
        }
    }

    it('parses a document with no faithful key every time: a function, `-0`, a nesting past the keyable depth', () => {
        let deep: Record<string, unknown> = {};
        const root = deep;
        for (let i = 0; i < 300; i++) deep = (deep.next = {}) as Record<string, unknown>;
        const unkeyable = [
            { name: 'a', handler: () => 1 },
            { name: 'a', weight: -0 },
            { name: 'a', nested: root },
            { name: 'a', nested: new Date(0) },
        ];
        for (const doc of unkeyable) {
            const before = parses;
            const first = computeMetadataDiagnostics(PROBE, doc);
            const second = computeMetadataDiagnostics(PROBE, doc);
            expect(second).toEqual(first);
            expect(parses - before).toBe(2);
        }
    });
});

describe('#25783 the verdict memo — a hit serves the bytes a fresh parse serves (real `object` schema)', () => {
    const OBJECT_SCHEMA = getMetadataTypeSchema('object')!;
    const documents: Array<[label: string, valid: boolean, doc: Record<string, unknown>]> = [
        ['a valid object', true, {
            name: 'memo_widget', label: 'Memo Widget',
            fields: { title: { name: 'title', type: 'text' } },
            enable: { apiMethods: ['get', 'list'] },
        }],
        ['an invalid object', false, {
            name: 'memo_widget', label: 'Memo Widget',
            fields: { title: { name: 'title', type: 'no_such_field_type' } },
            bogusTopLevelKey: true,
        }],
    ];

    for (const [label, valid, doc] of documents) {
        it(label, () => {
            try {
                // A schema with no memo: the reference answer.
                bindCounting('object', OBJECT_SCHEMA);
                parses = 0;
                const fresh = JSON.stringify(decorateMetadataItem('object', structuredClone(doc)));
                // The same schema object again: the second read is a memo hit.
                const hit = JSON.stringify(decorateMetadataItem('object', structuredClone(doc)));
                expect(JSON.parse(fresh)._diagnostics.valid).toBe(valid);
                expect(parses).toBe(1);
                expect(hit).toBe(fresh);
                // And a further fresh schema answers it the same way.
                bindCounting('object', OBJECT_SCHEMA);
                expect(JSON.stringify(decorateMetadataItem('object', structuredClone(doc)))).toBe(fresh);
                expect(parses).toBe(2);
            } finally {
                registerMetadataTypeSchema('object', OBJECT_SCHEMA);
            }
        });
    }
});
