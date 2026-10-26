/**
 * html-tier provenance marking (objectui#4000).
 *
 * The parser stamps every element it emits, so a renderer can tell an html-tier
 * node from a JSON-authored one and scope authoring advice to the surface the
 * advice is actually about. What is pinned here is the marker's four load-
 * bearing properties, each of which has a distinct failure mode:
 *
 *  - it is SET on what the parser produces, at every depth;
 *  - it SURVIVES an object spread — `SchemaRenderer` hands renderers a shallow
 *    copy, so a marker that did not survive would restore the original bug in
 *    the render path only, silently;
 *  - it is INVISIBLE to JSON — so it cannot be persisted, and therefore cannot
 *    be replayed by an authored document that wants the exemption;
 *  - it is NOT set on JSON reached through a braced attribute — that JSON was
 *    hand-written, so the JSON surface's advice does apply to it.
 */

import { describe, expect, it } from 'vitest';
import { parseJsx } from '../parse.js';
import { HTML_TIER_NODE, isHtmlTierNode, markHtmlTierNode } from '../provenance.js';
import type { SchemaElement } from '../types.js';

describe('html-tier provenance (#4000)', () => {
  it('marks every element the parser emits, at every depth', () => {
    const { tree } = parseJsx('<div className="outer"><span><em>deep</em></span></div>');
    const root = tree as SchemaElement;
    expect(isHtmlTierNode(root)).toBe(true);

    const child = root.children![0] as SchemaElement;
    expect(isHtmlTierNode(child)).toBe(true);
    const grandchild = child.children![0] as SchemaElement;
    expect(isHtmlTierNode(grandchild)).toBe(true);
  });

  it('survives the shallow copy a renderer receives', () => {
    // `SchemaRenderer` evaluates expressions against `{ ...schema }` and passes
    // the COPY down. Object spread carries own enumerable symbol keys and drops
    // non-enumerable ones — so this assertion, not the definition site, is what
    // actually holds the marker's descriptor in place.
    const { tree } = parseJsx('<div className="a" />');
    const copy = { ...(tree as SchemaElement) };
    expect(isHtmlTierNode(copy)).toBe(true);

    // …and through a second hop, which is what nesting plus scoped styling does.
    expect(isHtmlTierNode({ ...copy, className: 'a scoped' })).toBe(true);
  });

  it('is invisible to JSON, to Object.keys and to for...in', () => {
    const { tree } = parseJsx('<div className="a" />');
    const root = tree as SchemaElement;

    expect(JSON.parse(JSON.stringify(root))).toEqual({ type: 'div', className: 'a' });
    // ⚠️ Key ORDER, not key SET: `type` moved from first to last when the
    // discriminator collision was closed (objectui#7235) and the node became
    // `{ ...props, type: tag }`. The set, the values and the round-trip are
    // unchanged — this line is the one visible consequence of that reversal,
    // and it is here rather than adjusted away because an order pin that
    // silently follows the implementation pins nothing.
    expect(Object.keys(root)).toEqual(['className', 'type']);
    const seen: string[] = [];
    for (const k in root) seen.push(k);
    expect(seen).toEqual(['className', 'type']);

    // The round-trip is the anti-forgery pin: a persisted tree comes back
    // unmarked, so a saved (or AI-generated) document cannot carry the
    // exemption back in with it.
    expect(isHtmlTierNode(JSON.parse(JSON.stringify(root)))).toBe(false);
  });

  it('survives the reversed spread — the marking is applied AFTER every key', () => {
    // objectui#7235 reversed `markHtmlTierNode({ type: tag, ...props })` into
    // `markHtmlTierNode({ ...props, type: tag })`. The wrapper is objectui-only
    // (objectstack's copy of this parser builds a bare object), so the reversal
    // is the one edit in that port where the stamp could have been dropped —
    // e.g. by moving the call inside the literal, or by spreading a marked
    // object into a fresh unmarked one. Pinned at every depth and for the
    // shapes the reversal actually moves: props present, props absent, and a
    // container whose children were attached after the stamp.
    const { tree } = parseJsx('<flex direction="col" gap={4}><grid columns={2} /><div /></flex>');
    const root = tree as SchemaElement;

    expect(isHtmlTierNode(root)).toBe(true);
    expect(root.type).toBe('flex');
    // `children` is assigned after `markHtmlTierNode` returns; the stamp is on
    // the same object, so it must still read true once they are attached.
    expect(root.children).toHaveLength(2);
    for (const child of root.children as SchemaElement[]) {
      expect(isHtmlTierNode(child)).toBe(true);
    }
    // The propless element — `{ ...{}, type: tag }` — is the degenerate case
    // of the reversal and has its own way of going wrong.
    expect(isHtmlTierNode((root.children as SchemaElement[])[1])).toBe(true);
  });

  it('does not mark JSON smuggled in through a braced attribute', () => {
    // The parser produces the element; the object inside the braces is
    // hand-written JSON that merely rode along. Marking it would hand the
    // exemption to authored metadata — the precise over-reach this mechanism
    // exists to avoid.
    const { tree } = parseJsx('<page body={[{"type":"div","className":"inner"}]} />');
    const root = tree as SchemaElement;
    expect(isHtmlTierNode(root)).toBe(true);

    const smuggled = (root.body as SchemaElement[])[0];
    expect(smuggled.type).toBe('div');
    expect(isHtmlTierNode(smuggled)).toBe(false);
  });

  it('reads false for anything unmarked, and never throws on non-objects', () => {
    expect(isHtmlTierNode({ type: 'div' })).toBe(false);
    expect(isHtmlTierNode(null)).toBe(false);
    expect(isHtmlTierNode(undefined)).toBe(false);
    expect(isHtmlTierNode('div')).toBe(false);
    expect(isHtmlTierNode(7)).toBe(false);
    // A string-keyed lookalike is not provenance — there is no fallback read.
    expect(isHtmlTierNode({ type: 'div', _provenance: 'html' })).toBe(false);
  });

  it('keys the marker in the global registry, so duplicate instances agree', () => {
    // This package ships ESM and CJS and is consumed from several packages. Two
    // module instances holding two local symbols would not compare equal, and
    // the failure mode of that mismatch is the original bug returning with no
    // error anywhere. A registry key cannot drift.
    expect(HTML_TIER_NODE).toBe(Symbol.for('@object-ui/sdui-parser.html-tier-node'));
    expect(isHtmlTierNode(markHtmlTierNode({ type: 'div' }))).toBe(true);
  });
});
