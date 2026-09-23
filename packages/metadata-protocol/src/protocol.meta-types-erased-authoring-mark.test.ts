// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19295] `/meta/types` must let a consumer tell an ERASED authoring arm from
 * one that admits anything.
 *
 * ## What was wrong
 *
 * Every predicate slot the platform serves composes the expression-input
 * family, a two-arm union whose string arm is a `ZodPipe`. The served OUTPUT
 * derivation describes what comes out of the transform, so the arm's own input
 * type is erased and the member reads
 *
 *     "condition": { "anyOf": [ {}, { …ADR-0089 envelope } ] }
 *
 * `{}` is the wire spelling of "admits everything", so a metadata designer
 * cannot tell this husk from a member that genuinely accepts any instance and
 * has to veto a condition builder for both.
 *
 * ## The half that makes the mark mean anything
 *
 * A mark that appeared on every `{}` would be exactly as uninformative as the
 * husk it replaces. So this suite pins BOTH directions, and the negative half
 * is the load-bearing one:
 *
 *  - every husk arm of an expression-input union carries the mark
 *    (`marks every erased authoring arm …`), found by a STRUCTURAL search for
 *    the ADR-0089 envelope rather than by a list of key names, so a predicate
 *    slot added later is covered without editing this file;
 *  - the served surface still carries many unmarked `{}` nodes, and the named
 *    ones are pinned: the envelope's own `ast` (a `z.unknown()` sitting one
 *    level BELOW a marked arm), `field.defaultValue`, and the open record
 *    values on `tool.parameters`;
 *  - `action` — the one type #17501 serves from the authoring retry — carries
 *    a real string arm and NO mark at all, because on that derivation nothing
 *    was erased. Absence there is the honest answer, not a gap.
 *
 * ## And the mark constrains nothing
 *
 * `markErasedAuthoringInput` adds one vendor-prefixed keyword and rewrites
 * none that zod emitted. `the mark adds no constraint …` asserts that
 * structurally: every marked node, read with its mark removed, still admits
 * every instance. A JSON Schema validator ignores an unrecognised keyword, so
 * what each document ACCEPTS is exactly what it accepted before — which is why
 * this is an annotation and not the `io: 'input'` widening
 * `protocol.meta-types-degenerate-derivation.test.ts` refuses.
 *
 * Harness: the real `getMetaTypes()` over a stub engine, deliberately the same
 * shape as the degeneracy pin's — these assertions are about what the endpoint
 * SERVES, and a derivation taken here for convenience would not cover the
 * served path at all.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
// The spec's OWN dialect vocabulary, so the envelope sweep below is not a
// hand-written list of dialect names that a fourth dialect would silently
// outgrow.
import { ExpressionDialect } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';
// The emitter's OWN keyword, version and readers — never a second spelling of
// either, so this suite cannot drift into pinning a mark the server does not
// emit.
import {
    ERASED_AUTHORING_INPUT_KEYWORD,
    ERASED_AUTHORING_INPUT_VERSION,
    admitsEverything,
    erasedAuthoringInputMark,
} from './erased-authoring-mark.js';

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

type Served = Map<string, Record<string, unknown> | undefined>;

async function servedSchemas(): Promise<Served> {
    const listing = await makeProtocol().getMetaTypes();
    const map: Served = new Map();
    for (const entry of listing.entries as Array<{ type: string; schema?: Record<string, unknown> }>) {
        map.set(entry.type, entry.schema);
    }
    return map;
}

/** Every object node in a served document, with the pointer that located it. */
function* nodes(root: unknown, path: string[] = []): Generator<[Record<string, unknown>, string]> {
    if (Array.isArray(root)) {
        for (let i = 0; i < root.length; i++) yield* nodes(root[i], [...path, String(i)]);
        return;
    }
    if (!root || typeof root !== 'object') return;
    yield [root as Record<string, unknown>, path.join('.')];
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) yield* nodes(v, [...path, k]);
}

/** Resolve a dotted pointer against a served document. */
function at(doc: unknown, pointer: string): unknown {
    let cursor: any = doc;
    for (const step of pointer.split('.')) {
        if (cursor === undefined || cursor === null) return undefined;
        cursor = Array.isArray(cursor) ? cursor[Number(step)] : cursor[step];
    }
    return cursor;
}

/**
 * Is this arm the ADR-0089 expression envelope? Read structurally — an object
 * that pins `dialect` to declared dialect names and carries a `source` — so
 * the search depends on no slot's key NAME. That is the same rule the consumer
 * is held to: read the shape, never the key.
 *
 * Both pinnings are accepted because both are served: the general family
 * (`ExpressionInputSchema` / `EvaluatedExpressionInputSchema`) derives the
 * whole `enum`, while a TYPED slot (`CronExpressionInputSchema` on
 * `job.schedule`) derives a single `const`. A sweep that knew only the first
 * would walk straight past the typed members.
 */
const DECLARED_DIALECTS: readonly string[] = ExpressionDialect.options;

function isExpressionEnvelope(arm: unknown): boolean {
    if (!arm || typeof arm !== 'object') return false;
    const properties = (arm as any).properties;
    if (!properties || typeof properties !== 'object') return false;
    if (!properties.source || typeof properties.source !== 'object') return false;

    const dialect = properties.dialect;
    if (!dialect || typeof dialect !== 'object') return false;
    const pinned: unknown[] | undefined = Array.isArray(dialect.enum)
        ? dialect.enum
        : typeof dialect.const === 'string' ? [dialect.const] : undefined;
    if (!pinned || pinned.length === 0) return false;
    return pinned.every((d) => typeof d === 'string' && DECLARED_DIALECTS.includes(d));
}

/** Every `anyOf` / `oneOf` on the served surface that carries that envelope. */
function expressionUnions(served: Served): Array<{ type: string; pointer: string; arms: unknown[] }> {
    const found: Array<{ type: string; pointer: string; arms: unknown[] }> = [];
    for (const [type, schema] of served) {
        if (!schema) continue;
        for (const [node, pointer] of nodes(schema)) {
            for (const keyword of ['anyOf', 'oneOf'] as const) {
                const arms = node[keyword];
                if (Array.isArray(arms) && arms.some(isExpressionEnvelope)) {
                    found.push({ type, pointer: pointer ? `${pointer}.${keyword}` : keyword, arms });
                }
            }
        }
    }
    return found;
}

describe('#19295 — the served derivation marks an erased authoring arm', () => {
    it('marks every erased authoring arm of an expression-input union, and names its type', async () => {
        const served = await servedSchemas();
        const unions = expressionUnions(served);

        // The instrument must be capable of finding nothing — say so loudly
        // rather than passing an empty sweep.
        expect(unions.length, 'no expression-input union found on the served surface').toBeGreaterThan(0);

        const unmarked: string[] = [];
        for (const { type, pointer, arms } of unions) {
            for (let i = 0; i < arms.length; i++) {
                const arm = arms[i];
                if (!admitsEverything(arm)) continue; // a real arm needs no mark
                const mark = erasedAuthoringInputMark(arm);
                if (!mark) { unmarked.push(`${type}:${pointer}.${i}`); continue; }
                expect(mark.version, `${type}:${pointer}.${i} mark version`).toBe(ERASED_AUTHORING_INPUT_VERSION);
                // The erased arm of this family is the bare-string shorthand.
                expect(mark.type, `${type}:${pointer}.${i} erased authoring type`).toBe('string');
            }
        }
        expect(unmarked, 'husk arms of an expression union with no mark').toEqual([]);
    });

    /**
     * The predicate slots the filing card names, pinned by pointer so a
     * refactor that silently stops marking one of them is a named failure and
     * not a count that quietly drops by one.
     *
     * (`sharing_rule.condition` is on the card's list but is plugin-registered
     * — it resolves no schema in this registry-only harness, so it is covered
     * by the structural sweep above wherever it IS served, not pinned here.)
     */
    const NAMED_MEMBERS: Array<[string, string]> = [
        ['hook', 'properties.condition'],
        ['field', 'properties.visibleWhen'],
        ['field', 'properties.readonlyWhen'],
        ['field', 'properties.requiredWhen'],
        ['field', 'properties.expression'],
        ['flow', 'properties.edges.items.properties.condition'],
        ['job', 'properties.schedule.oneOf.0.properties.expression'],
    ];

    it.each(NAMED_MEMBERS)('marks the erased string arm of `%s` %s', async (type, pointer) => {
        const member = at((await servedSchemas()).get(type), pointer) as any;

        expect(member, `${type}:${pointer} must be served`).toBeDefined();
        expect(Array.isArray(member.anyOf), `${type}:${pointer} must be a union`).toBe(true);

        const marked = (member.anyOf as unknown[]).filter((arm) => erasedAuthoringInputMark(arm));
        expect(marked.length, `${type}:${pointer} marked arms`).toBe(1);
        expect(erasedAuthoringInputMark(marked[0])).toEqual({
            version: ERASED_AUTHORING_INPUT_VERSION,
            type: 'string',
        });
        // And the sibling arm is the envelope, unmarked — the member reads
        // "a string OR this envelope", which is what it accepts.
        expect((member.anyOf as unknown[]).some(isExpressionEnvelope)).toBe(true);
    });

    /**
     * ⭐ The negative control, and the half the card names as the one that
     * makes the mark mean anything.
     */
    it('leaves every OTHER reason for `{}` unmarked', async () => {
        const served = await servedSchemas();

        let marked = 0;
        const bare: string[] = [];
        for (const [type, schema] of served) {
            if (!schema) continue;
            for (const [node, pointer] of nodes(schema)) {
                if (erasedAuthoringInputMark(node)) marked += 1;
                else if (admitsEverything(node)) bare.push(`${type}:${pointer}`);
            }
        }

        // Both sides must be non-empty, or this control proves nothing: a
        // surface with no marks, and a surface where every `{}` is marked, are
        // both indistinguishable from the husk the card set out to name.
        expect(marked, 'marked arms on the served surface').toBeGreaterThan(0);
        expect(bare.length, 'unmarked `{}` nodes on the served surface').toBeGreaterThan(0);

        // Named instances, so the count above cannot drift into vacuity.
        // `ast` is the sharpest: a `z.unknown()` that derives `{}` for the
        // honest reason, sitting one level BELOW a marked arm inside the very
        // envelope that arm is a sibling of.
        for (const pinned of [
            'flow:properties.edges.items.properties.condition.anyOf.1.properties.ast',
            'field:properties.defaultValue',
            'tool:properties.parameters.additionalProperties',
        ]) {
            expect(bare, `${pinned} must still be an unmarked \`{}\``).toContain(pinned);
        }
    });

    /**
     * The second negative control, from the other direction: `action` is the
     * one type #17501 serves from the `io: 'input'` retry, so its predicate
     * slots derive their real string arm and nothing was erased.
     */
    it('marks nothing on `action`, which is served from the authoring retry', async () => {
        const action = (await servedSchemas()).get('action');
        expect(action, '`action` must be served').toBeDefined();

        const marked = [...nodes(action)].filter(([node]) => erasedAuthoringInputMark(node));
        expect(marked.map(([, pointer]) => pointer), '`action` marked nodes').toEqual([]);

        // And the absence is "nothing was erased", not "the sweep missed it":
        // the predicate slot really does carry a usable string arm here.
        const visible = JSON.stringify(at(action, 'properties.visible'));
        expect(visible, '`action.visible` must be served').toBeDefined();
        expect(visible).toContain('"type":"string"');
    });

    it('adds no constraint — every marked arm still admits every instance', async () => {
        const served = await servedSchemas();

        let checked = 0;
        for (const [type, schema] of served) {
            if (!schema) continue;
            for (const [node, pointer] of nodes(schema)) {
                if (!erasedAuthoringInputMark(node)) continue;
                checked += 1;
                const { [ERASED_AUTHORING_INPUT_KEYWORD]: _mark, ...rest } = node;
                // Read without its mark, the arm is exactly the `{}` zod
                // emitted — so a validator, which ignores the unrecognised
                // keyword, accepts precisely what it accepted before #19295.
                expect(admitsEverything(rest), `${type}:${pointer} gained a constraint`).toBe(true);
            }
        }
        expect(checked, 'marked arms inspected').toBeGreaterThan(0);
    });

    it('carries the mark under one vendor-prefixed keyword, versioned', () => {
        // The contract a consumer gates on: one keyword, `x-` prefixed so a
        // strict JSON Schema reader ignores it, and a version inside the value
        // rather than baked into the keyword name.
        expect(ERASED_AUTHORING_INPUT_KEYWORD).toBe('x-objectstack-erased-authoring-input');
        expect(ERASED_AUTHORING_INPUT_VERSION).toBe(1);

        // The reader refuses a value it does not understand rather than
        // guessing — a consumer copying this shape gates the same way.
        expect(erasedAuthoringInputMark({ [ERASED_AUTHORING_INPUT_KEYWORD]: { type: 'string' } })).toBeUndefined();
        expect(erasedAuthoringInputMark({ [ERASED_AUTHORING_INPUT_KEYWORD]: { version: 1 } })).toBeUndefined();
        expect(erasedAuthoringInputMark({})).toBeUndefined();
    });
});
