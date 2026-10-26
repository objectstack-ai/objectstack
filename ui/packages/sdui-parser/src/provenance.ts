/**
 * ObjectUI — html-tier provenance (ADR-0080, objectui#4000)
 *
 * Records the one fact a renderer cannot otherwise recover: whether the node it
 * is about to render was EMITTED BY THIS PARSER (an author's `kind:'html'`
 * source, compiled tag-name-straight-through) or AUTHORED AS JSON metadata.
 *
 * Why a renderer needs it: the two surfaces have different vocabularies. A type
 * the JSON surface is steering authors away from can still be a supported tag
 * in the html tier — the plain inline element (`span`) is exactly that. (The
 * plain box element was too, until objectui#10757 deprecated `div` on the html
 * surface as well; the console's html compile now refuses it outright, so no
 * notice is involved there.) Advice aimed at the JSON surface, delivered to an
 * html-tier author, is advice they cannot act on: in that tier there is no
 * other spelling. The
 * deprecation notice fired at them anyway (objectui#4000), which is also why the
 * type could never be retired — the engine's own compiler keeps emitting it.
 *
 * The judgement therefore has to be PROVENANCE, established by the producer,
 * not a guess made at the consumer from the node's shape.
 *
 * ## Why a symbol, and why `Symbol.for`
 *
 * The marker is deliberately NOT a JSON-visible key:
 *
 *  - `JSON.stringify` skips symbol keys, so provenance never lands in a
 *    persisted tree. That is the point, not a limitation: "our parser produced
 *    this node in this process" is not a fact about the saved document, and a
 *    saved document must not be able to REPLAY it. A string key like
 *    `_provenance: 'html'` would be copyable — an authored (or AI-generated)
 *    JSON page could paste it in and buy itself silence from a notice that is
 *    meant for it. Provenance that authored metadata can forge is not
 *    provenance.
 *  - `Object.keys` / `for...in` skip symbol keys, so the marker cannot leak out
 *    of a renderer onto a host element as a stray DOM attribute.
 *
 * It IS enumerable, which matters more than it looks: `SchemaRenderer` hands
 * renderers a shallow copy of the node (`{ ...schema }`), and object spread
 * copies own ENUMERABLE symbol keys while dropping non-enumerable ones. A
 * non-enumerable marker would be lost in that copy and the misfire would come
 * back — silently, and only in the render path. `render.test.tsx` and the
 * components-side pin both go through the real `SchemaRenderer` for this reason.
 *
 * `Symbol.for` (the cross-realm registry) rather than a module-local `Symbol()`:
 * this package ships as both ESM and CJS and is consumed from several packages,
 * so two module instances are possible. Two local symbols would not compare
 * equal, and the failure mode of that mismatch is the ORIGINAL BUG returning
 * with no error anywhere. A registry key cannot drift.
 */

/** Registry key for the marker. Stable — it is a cross-instance contract. */
const HTML_TIER_NODE_KEY = '@object-ui/sdui-parser.html-tier-node';

/**
 * The provenance marker itself. Exported for tests and for any consumer that
 * needs to reason about the key; prefer {@link isHtmlTierNode} for reading.
 */
export const HTML_TIER_NODE: symbol = Symbol.for(HTML_TIER_NODE_KEY);

/**
 * Stamp a node as html-tier output. Called by the parser as it builds each
 * element — the producer is the only place that knows this for certain.
 */
export function markHtmlTierNode<T extends object>(node: T): T {
  (node as Record<symbol, unknown>)[HTML_TIER_NODE] = true;
  return node;
}

/**
 * True when this node came out of the html tier's parser.
 *
 * Deliberately a plain boolean read of the marker — no fallback to a
 * string-keyed spelling, no shape heuristic ("looks like a raw tag"). Either
 * the producer marked it or it did not; a consumer-side guess is precisely what
 * this replaces.
 */
export function isHtmlTierNode(node: unknown): boolean {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<symbol, unknown>)[HTML_TIER_NODE] === true
  );
}
