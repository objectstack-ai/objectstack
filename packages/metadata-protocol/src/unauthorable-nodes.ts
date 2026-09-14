// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17502] Drop the properties a served JSON Schema publishes but no instance
 * can satisfy.
 *
 * ## What lands in the payload, and why it reads as an offer
 *
 * `retiredKey()` (`@objectstack/spec` `shared/retired-key.ts`) declares a
 * REMOVED authorable key as `z.never({ error: () => guidance }).optional()
 * .describe('[REMOVED] ' + guidance)`. The key stays declared on purpose — the
 * retirement has to be audible, and the two channels it names are `tsc` (the
 * input type is `never`) and the parse (the refusal carries the FROM -> TO
 * prescription instead of a bare "unrecognized key").
 *
 * `z.toJSONSchema` renders that tombstone as a property node, measured here as
 *
 *     { "description": "[REMOVED] <prescription>", "not": {} }
 *
 * `not: {}` is the JSON Schema spelling of "no instance validates", so a
 * consumer that reads the SUBSCHEMA sees the refusal. A consumer that reads the
 * KEY SET does not: Studio builds a repeater's column headers from
 * `items.properties[k].title ?? k`, so every tombstone in a row shape becomes a
 * column an author is invited to fill and the publish door then refuses. That
 * is the offer-vs-door defect, and the payload is where it is cheapest to
 * close — one emission point instead of one accommodation per renderer.
 *
 * ## Why the prescription is not lost with the node
 *
 * The removal keeps every channel that carries the prescription today: `tsc`
 * and the parse are properties of the Zod shape and are untouched here;
 * `packages/spec`'s `authorable-surface/` ratchet still lists each retired key
 * as `[RETIRED]`; and the generated reference pages still print the full
 * prescription in the description column of a `never`-typed row (see
 * `content/docs/references/ui/dashboard.mdx`). What this drops is a fourth
 * copy, on the one surface whose documented job is to describe what an author
 * MAY write.
 *
 * ## The predicate is structural, never the `[REMOVED] ` prefix
 *
 * Matching the description prefix would put a second, hand-written spelling of
 * "this is a tombstone" in a consumer — the very shape this card exists to
 * remove. `acceptsNothing()` asks the JSON Schema question instead: does this
 * subschema admit any instance at all? Anything that answers "no" is not part
 * of an authorable surface, whatever produced it.
 *
 * ## The one thing it must not do
 *
 * A property that accepts nothing and is REQUIRED makes its object
 * uninhabitable. Dropping such a key would turn "nothing validates" into
 * "anything validates" — a real widening, and a lie of exactly the kind
 * Route & surface ownership rule 4 forbids. So a key named in the parent's
 * `required` array is kept, unsatisfiable and all. `retiredKey()` is
 * `.optional()`, so no tombstone is ever in that arm; the guard is for
 * whatever else may one day derive to `{ not: {} }`.
 */

/** JSON Schema keywords whose values are DATA, not subschemas — never walked. */
const NON_SCHEMA_KEYS: ReadonlySet<string> = new Set([
    'default', 'const', 'enum', 'examples', 'title', 'description',
    '$schema', '$id', '$comment', 'required',
]);

/**
 * Does this subschema admit no instance at all?
 *
 * `{ "not": {} }` is the canonical spelling — `{}` accepts everything, so its
 * negation accepts nothing — and it is what `z.toJSONSchema` emits for
 * `z.never()` in both the output and the authoring derivation.
 */
export function acceptsNothing(node: unknown): boolean {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const not = (node as Record<string, unknown>).not;
    return (
        typeof not === 'object'
        && not !== null
        && !Array.isArray(not)
        && Object.keys(not).length === 0
    );
}

/**
 * Return `json` with every unsatisfiable, non-required property removed, at
 * every depth. Pure and copy-on-write: a document with nothing to drop is
 * returned by reference, so an untouched type's served payload stays
 * byte-identical (and reference-identical) to its derivation.
 */
export function stripUnauthorableProperties<T>(json: T): T {
    return walk(json) as T;
}

function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
        let changed = false;
        const out = node.map((entry) => {
            const next = walk(entry);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : node;
    }
    if (!node || typeof node !== 'object') return node;

    const source = node as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    const write = (key: string, value: unknown) => {
        out ??= { ...source };
        out[key] = value;
    };

    const properties = source.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        const required = new Set(
            Array.isArray(source.required) ? source.required.filter((k): k is string => typeof k === 'string') : [],
        );
        let kept: Record<string, unknown> | undefined;
        for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
            if (acceptsNothing(value) && !required.has(key)) {
                kept ??= { ...(properties as Record<string, unknown>) };
                delete kept[key];
            }
        }
        if (kept) write('properties', kept);
    }

    for (const [key, value] of Object.entries(source)) {
        if (NON_SCHEMA_KEYS.has(key)) continue;
        const current = key === 'properties' && out ? out[key] : value;
        const next = walk(current);
        if (next !== current) write(key, next);
    }

    return out ?? node;
}
