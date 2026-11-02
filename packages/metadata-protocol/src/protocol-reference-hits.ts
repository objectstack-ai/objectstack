// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the
// reference-site walk behind `findReferencesToMeta`.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.

/**
 * Phase 3a-references: how a reference is FOUND in a stored document, given the
 * derived site index in `./reference-sites.ts`.
 *
 * The registry that used to sit here was a hand-curated table of `fromType` +
 * fully-qualified dotted paths. It rotted — 34 of its 40 paths named properties
 * the source type's schema does not declare, leaving five of its seven target
 * keys answering `{ references: [] }` unconditionally (#9190; the measurements
 * are in `reference-sites.ts`'s header, which is the one place they live).
 *
 * ⛔ Do not reintroduce a path table. Paths were the wrong unit: `AppSchema`'s
 * navigation is recursive, so an exhaustive path list is unbounded, and it goes
 * stale the moment a wrapper key moves. The derived index records the PROPERTY
 * that carries a name; this walk finds it wherever the document actually puts
 * it, and reports the path it was found at.
 */

/**
 * Every name a reference-bearing property value may be carrying, tolerant of
 * the four shapes a name can arrive in.
 *
 * Deliberately shape-TOLERANT at read time while the derivation is shape-STRICT
 * at build time: the derivation decides whether a property means "a reference"
 * (and rejects `enum`-constrained lookalikes such as a chart axis `position`),
 * while this function only has to read a value whose meaning is already
 * settled. Record KEYS are included because `z.record(name, …)` is how the
 * platform spells a name-keyed collection — `PermissionSetSchema.objects` is
 * exactly that, and the old table's `objects[].name` could not express it.
 */
function referencedNamesAt(value: unknown): Array<{ name: string; suffix: string }> {
    if (typeof value === 'string') {
        return value.length > 0 ? [{ name: value, suffix: '' }] : [];
    }
    if (Array.isArray(value)) {
        const out: Array<{ name: string; suffix: string }> = [];
        for (const element of value) {
            if (typeof element === 'string' && element.length > 0) out.push({ name: element, suffix: '[]' });
            else if (element && typeof element === 'object') {
                const named = (element as Record<string, unknown>).name;
                if (typeof named === 'string' && named.length > 0) out.push({ name: named, suffix: '[].name' });
            }
        }
        return out;
    }
    if (value && typeof value === 'object') {
        const out: Array<{ name: string; suffix: string }> = [];
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            if (key.length > 0) out.push({ name: key, suffix: '{key}' });
        }
        const named = record.name;
        if (typeof named === 'string' && named.length > 0) out.push({ name: named, suffix: '.name' });
        return out;
    }
    return [];
}

/**
 * Walk a stored metadata document and report every place it names
 * `targetName` through one of `properties`.
 *
 * `properties` is the derived property → target binding for THIS source type,
 * so the walk never guesses; it only looks where the schema said a name lives.
 * Paths are reported with array indices and record keys elided (`a.b[].c`,
 * `a{}.b`), matching the grammar the previous table used, so the value the
 * "Used by" panel renders keeps its established shape.
 */
function collectReferenceHits(
    item: unknown,
    properties: ReadonlyMap<string, string>,
    targetName: string,
): Array<{ path: string; property: string }> {
    const hits: Array<{ path: string; property: string }> = [];
    const seenNodes = new Set<unknown>();

    const walk = (node: unknown, trail: string, depth: number): void => {
        if (!node || typeof node !== 'object' || depth > 16) return;
        // Cycle guard. Stored documents are JSON, but a runtime-assembled item
        // can still be self-referential, and a scan that hangs is a worse
        // answer than a short one.
        if (seenNodes.has(node)) return;
        seenNodes.add(node);

        if (Array.isArray(node)) {
            for (const element of node) walk(element, `${trail}[]`, depth + 1);
            return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            const here = trail ? `${trail}.${key}` : key;
            if (properties.has(key)) {
                for (const hit of referencedNamesAt(value)) {
                    if (hit.name === targetName) hits.push({ path: `${here}${hit.suffix}`, property: key });
                }
            }
            walk(value, here, depth + 1);
        }
    };

    walk(item, '', 0);
    return hits;
}

/**
 * Every place a stored document names `targetName` as the HEAD of a composite
 * record key, through a composite-key site of the derived index
 * (`REFERENCE_SITES.compositeKeyByTarget`; the one site today is a permission
 * set's `fields`, keyed `<object>.<field>`).
 *
 * A separate walk, not a branch inside {@link collectReferenceHits}: that walk
 * matches a WHOLE value and serves every other site, so it stays as it is. This
 * one reads only the record each site names, at the document ROOT where the
 * site's premise is derived (`compositeKeySiteHolds`, `./reference-sites.ts`),
 * and only its keys.
 *
 * A key names the target when the text before its FIRST separator equals the
 * target's name — the split the security plugin makes for field rules
 * (`key.startsWith(object + '.')`), exact because no object name contains a `.`.
 * A key with no separator, or one at index 0 (`.full_name`), names no object.
 * The field part is never read, so a key whose FIELD part spells the target
 * (`invoice.customer`) is not a reference to it. One hit per site: the reported
 * path (`fields{key}`) does not carry the key, so a second matching key is the
 * same row.
 */
function collectCompositeKeyHeadHits(
    item: unknown,
    separators: ReadonlyMap<string, string>,
    targetName: string,
): Array<{ path: string; property: string }> {
    const hits: Array<{ path: string; property: string }> = [];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return hits;
    for (const [property, separator] of separators) {
        const record = (item as Record<string, unknown>)[property];
        if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
        for (const key of Object.keys(record)) {
            const at = key.indexOf(separator);
            if (at > 0 && key.slice(0, at) === targetName) {
                hits.push({ path: `${property}{key}`, property });
                break;
            }
        }
    }
    return hits;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { collectCompositeKeyHeadHits, collectReferenceHits };
