// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19295] Tell an ERASED authoring arm apart from one that admits anything.
 *
 * ## The husk, and why it is indistinguishable from `{}`
 *
 * Every predicate slot the platform serves — `hook.condition`,
 * `sharing_rule.condition`, `field.visibleWhen` / `readonlyWhen` /
 * `requiredWhen`, a flow `edge.condition` — composes the expression-input
 * family (`EvaluatedExpressionInputSchema`, and `ExpressionInputSchema` /
 * `PredicateInputSchema` at the persistence slots). Each is a two-arm union
 * whose FIRST arm is a `ZodPipe`: `z.string()…transform(source => ({ dialect:
 * 'cel', source }))`. The bare string is the author-facing shorthand.
 *
 * `/meta/types` serves the OUTPUT derivation, and the output derivation of a
 * pipe describes what comes OUT of the transform — the envelope — so the arm's
 * own input type is erased and zod emits the empty schema:
 *
 *     "condition": { "anyOf": [ {}, { …ADR-0089 envelope } ] }
 *
 * On the wire `{}` means "admits everything". A metadata designer reading that
 * document cannot tell this husk — a member that accepts a string and nothing
 * else on that arm — from a member that genuinely admits any instance, so a
 * condition builder has to veto both.
 *
 * ## Why this is an annotation and not a wider derivation
 *
 * The obvious repair — derive the served surface with `io: 'input'` — was
 * measured and REFUSED as a weakening of a published contract (24 of the 26
 * types carrying a Zod schema answer differently; `required` entries 1132 to
 * 867). `protocol.meta-types-degenerate-derivation.test.ts` pins that refusal
 * and this file does not reopen it: the served derivation stays `io: 'output'`
 * and every keyword it emits is untouched.
 *
 * What is added is ONE vendor-prefixed annotation on the husk arm itself.
 * JSON Schema ignores an unrecognised keyword, so the arm still admits exactly
 * what it admitted before — the document is byte-different and semantically
 * identical. ⛔ This is deliberately NOT a place to publish the authoring
 * derivation: only the erased arm's own `type` travels, never its constraints,
 * so nothing here can ever be mistaken for the refused widening.
 *
 * ## What a consumer reads, and what it must never read
 *
 * The mark, and only the mark. A consumer that enables a builder by matching
 * `hook.condition` / `visibleWhen` / the rest is maintaining a second,
 * hand-written copy of this list and drifts the moment a new predicate slot
 * lands. {@link ERASED_AUTHORING_INPUT_KEYWORD} is the whole contract, its
 * value carries {@link ERASED_AUTHORING_INPUT_VERSION} so a consumer can gate
 * on the shape it understands, and the value's `type` names the authoring type
 * that was erased (`"string"` for every member on today's served surface).
 *
 * ## The predicate is structural, and declines on absence of evidence
 *
 * Three facts must all hold before a node is marked, and each one is read off
 * the node itself:
 *
 *  1. the emitted subschema ADMITS EVERYTHING — no keyword but a pure
 *     annotation. This is the husk being disambiguated; a node that already
 *     carries a constraint tells the consumer what it accepts and needs no
 *     mark.
 *  2. the Zod node behind it is a `ZodPipe` — the one construct whose output
 *     derivation can legitimately erase an input type. `z.unknown()`,
 *     `z.any()` and a `z.custom()` also emit `{}`; none of them is a pipe, and
 *     none of them is erasing anything, so none is marked. The `ast` key on
 *     the ADR-0089 envelope is exactly that case and is the in-payload
 *     negative control: it sits one level below a marked arm and stays bare.
 *  3. the pipe's INPUT side derives a named `type`. A pipe fed by something
 *     that itself admits everything has erased nothing a consumer could act
 *     on, and an input whose derivation names no `type` (a union of
 *     primitives, say) cannot be reported in this shape — both decline. The
 *     mark is a statement about a KNOWN authoring type; it is never a bare
 *     "something was erased here".
 *
 * A declined mark leaves the payload exactly as it was, which is the pre-#19295
 * behaviour — this widens nothing and can degrade only to the husk it found.
 */
import { z } from 'zod';

/**
 * The served document's one custom keyword for this. Vendor-prefixed in the
 * `x-objectstack-*` form this platform already uses on the wire, so a strict
 * JSON Schema consumer ignores it and a validator's accept set is unchanged.
 */
export const ERASED_AUTHORING_INPUT_KEYWORD = 'x-objectstack-erased-authoring-input';

/**
 * The mark's shape version, carried in every emission so a consumer gates on a
 * shape it understands rather than on mere presence. Bump it when the VALUE's
 * shape changes; adding a new optional field to the value does not need one.
 */
export const ERASED_AUTHORING_INPUT_VERSION = 1;

/** The value {@link ERASED_AUTHORING_INPUT_KEYWORD} carries. */
export interface ErasedAuthoringInputMark {
    /** {@link ERASED_AUTHORING_INPUT_VERSION} as of the emission. */
    version: number;
    /**
     * The JSON Schema `type` the erased authoring arm accepts — `"string"` for
     * every expression-input member on the served surface today.
     */
    type: string | string[];
}

/**
 * JSON Schema keywords that describe a subschema without constraining it. A
 * node carrying only these still admits every instance.
 *
 * `default` is deliberately absent: it seeds an authoring form and is read as
 * a statement about the value, so a node carrying one is not the anonymous
 * husk this mark exists to name.
 */
const ANNOTATION_ONLY_KEYWORDS: ReadonlySet<string> = new Set([
    'description', 'title', '$comment', 'examples', 'deprecated', 'readOnly', 'writeOnly',
]);

/**
 * Does this subschema admit every instance — is it the anonymous `{}` (or a
 * `{}` wearing a description)?
 */
export function admitsEverything(node: unknown): boolean {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    return Object.keys(node as Record<string, unknown>).every((k) => ANNOTATION_ONLY_KEYWORDS.has(k));
}

/**
 * Read the mark off a served subschema — the accessor a consumer's own reader
 * mirrors, and the one this package's tests use, so no second spelling of the
 * keyword exists anywhere.
 */
export function erasedAuthoringInputMark(node: unknown): ErasedAuthoringInputMark | undefined {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    const value = (node as Record<string, unknown>)[ERASED_AUTHORING_INPUT_KEYWORD];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const { version, type } = value as Record<string, unknown>;
    if (typeof version !== 'number') return undefined;
    if (typeof type !== 'string' && !Array.isArray(type)) return undefined;
    return value as unknown as ErasedAuthoringInputMark;
}

/** The `_zod.def` of a zod node, without importing zod's internal types. */
function zodDef(schema: unknown): { type?: unknown; in?: unknown } | undefined {
    const core = (schema as { _zod?: { def?: unknown } } | undefined)?._zod?.def;
    if (core && typeof core === 'object') return core as { type?: unknown; in?: unknown };
    return undefined;
}

/** The `type` keyword of a derivation, when it names one. */
function namedType(json: Record<string, unknown>): string | string[] | undefined {
    const type = json.type;
    if (typeof type === 'string' && type.length > 0) return type;
    if (Array.isArray(type) && type.length > 0 && type.every((t) => typeof t === 'string')) {
        return type as string[];
    }
    return undefined;
}

/**
 * The `override` hook `z.toJSONSchema` calls for every node it emits. Pass it
 * on BOTH derivations the projection can serve: on the authoring (`io:
 * 'input'`) retry a pipe derives from its input side, so nothing is erased and
 * nothing is marked — one emitter, and the absence of marks on a type served
 * from the retry is itself the honest answer.
 */
export function markErasedAuthoringInput(ctx: {
    zodSchema: unknown;
    jsonSchema: Record<string, unknown>;
    path: (string | number)[];
}): void {
    // (1) Only the anonymous husk is ambiguous.
    if (!admitsEverything(ctx.jsonSchema)) return;

    // (2) Only a pipe can have erased an input type.
    const def = zodDef(ctx.zodSchema);
    if (def?.type !== 'pipe' || !def.in) return;

    // (3) Only an input side that names a type says anything a consumer can use.
    let derived: Record<string, unknown>;
    try {
        derived = z.toJSONSchema(def.in as z.ZodTypeAny, {
            unrepresentable: 'any',
            io: 'input',
        }) as Record<string, unknown>;
    } catch {
        // An input side that cannot be derived is not evidence of anything.
        return;
    }
    const type = namedType(derived);
    if (type === undefined) return;

    const mark: ErasedAuthoringInputMark = { version: ERASED_AUTHORING_INPUT_VERSION, type };
    ctx.jsonSchema[ERASED_AUTHORING_INPUT_KEYWORD] = mark;
}
