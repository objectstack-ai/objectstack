// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The react-tier block index is half generated (`data` props read from each
// block's spec zod schema) and half hand-authored (the React interaction
// overlay). These tests guard the seam between the two halves — the place a
// hand edit can silently contradict the protocol.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { REACT_BLOCKS, REACT_OVERLAY_SHADOWS } from './react-blocks';

/** The prop names a block's spec schema declares, as the contract generator reads them. */
function schemaPropNames(schema: unknown): string[] {
  let js: any;
  try {
    js = z.toJSONSchema(schema as any, { unrepresentable: 'any' } as any);
  } catch {
    return [];
  }
  if (js?.$ref && js?.$defs) js = js.$defs[String(js.$ref).split('/').pop()!] ?? js;
  return Object.keys(js?.properties ?? {});
}

/** tag → overlay props that also exist on the block's spec schema. */
function actualShadows(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of REACT_BLOCKS) {
    if (!b.schema) continue;
    const schemaProps = new Set(schemaPropNames(b.schema));
    const collisions = b.interactions.map((i) => i.name).filter((n) => schemaProps.has(n));
    if (collisions.length > 0) out[b.tag] = collisions.sort();
  }
  return out;
}

describe('REACT_BLOCKS — overlay/schema seam', () => {
  /**
   * The bug class #4340 opened on, closed structurally.
   *
   * `build-react-blocks-contract`'s `mergeProps` lets the overlay win on a name
   * collision: the schema's type and description are DROPPED. So an overlay
   * entry that duplicates a schema prop can publish a different meaning for it
   * and nothing reports the divergence — which is exactly what happened to
   * `<RecordRelatedList objectName>` (schema: the related object; overlay: "the
   * parent object"). Every live page authored against the published gloss then
   * named the wrong object, and the lint that should have caught it had no way
   * to know which reading to check against.
   *
   * A collision is therefore allowed only when it is deliberate and
   * meaning-preserving, and must be ledgered with its reason in
   * `REACT_OVERLAY_SHADOWS`. This asserts the ledger IS the collision set, in
   * both directions: a new accidental shadow fails here, and a ledger entry
   * that stops being a real collision fails here too rather than rotting.
   */
  it('every overlay prop shadowing a spec-schema prop is ledgered', () => {
    const ledger = Object.fromEntries(
      Object.entries(REACT_OVERLAY_SHADOWS).map(([tag, props]) => [tag, [...props].sort()]),
    );
    expect(actualShadows()).toEqual(ledger);
  });

  it('ledgers only tags that exist in the index', () => {
    const tags = new Set(REACT_BLOCKS.map((b) => b.tag));
    for (const tag of Object.keys(REACT_OVERLAY_SHADOWS)) expect(tags.has(tag)).toBe(true);
  });

  /**
   * The `record:related_list` reading, pinned where an author and the linter
   * both read it. `validate-page-field-bindings` resolves this component's
   * `columns`/`sort`/`filter` against `properties.objectName` as the RELATED
   * object on the metadata surface, and `validate-react-page-props` now does
   * the same on the react surface — both are wrong the moment this description
   * says "parent" again.
   */
  it('<RecordRelatedList objectName> is published as the related (child) object', () => {
    const block = REACT_BLOCKS.find((b) => b.tag === 'RecordRelatedList');
    const objectName = block?.interactions.find((i) => i.name === 'objectName');
    expect(objectName).toBeDefined();
    expect(objectName!.description).toMatch(/RELATED \(child\) object/);
    expect(objectName!.description).toMatch(/NOT the parent/);
    // The spec schema is the authority it must agree with.
    expect(schemaPropNames(block!.schema)).toContain('objectName');
  });

  it('every block tag is unique (the contract is keyed by it)', () => {
    const tags = REACT_BLOCKS.map((b) => b.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
