// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The react-tier block index is half generated (`data` props read from each
// block's spec zod schema) and half hand-authored (the React interaction
// overlay). These tests guard the seam between the two halves — the place a
// hand edit can silently contradict the protocol.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  REACT_BLOCKS,
  REACT_OVERLAY_SHADOWS,
  REACT_RECORD_BLOCK_ALTERNATIVES,
  RECORD_CONTEXT_BLOCK_TAGS,
  isRecordContextBlockType,
  reactBlockTagFor,
} from './react-blocks';
import { ComponentPropsMap } from './component.zod';

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

  it('every block tag is unique (the contract is keyed by it)', () => {
    const tags = REACT_BLOCKS.map((b) => b.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

/**
 * #4413. Four `record:*` blocks were published here with `objectName` /
 * `recordId` overlay props that NO renderer reads: every one of them takes its
 * record from the context a record page mounts, and a `kind:'react'` page
 * mounts none — so a page authored exactly to contract rendered empty, silently.
 *
 * The index is the authority the publish gate reads, so the exclusion has to
 * hold HERE or the gate rejects what the contract still advertises (or, worse,
 * stops rejecting what came back).
 */
describe('REACT_BLOCKS — the record:* family is out (#4413)', () => {
  it('publishes no block that needs a record context', () => {
    const offenders = REACT_BLOCKS.filter((b) => isRecordContextBlockType(b.schemaType));
    expect(offenders.map((b) => b.tag)).toEqual([]);
  });

  it('covers every record:* type the spec declares, under the tag the react scope injects', () => {
    const specTypes = Object.keys(ComponentPropsMap).filter(isRecordContextBlockType);
    // Not a hand-kept list: a record component added to ComponentPropsMap is
    // gated the day it lands, under the tag objectui's `toPascal` gives it.
    expect(specTypes.length).toBeGreaterThan(0);
    expect([...RECORD_CONTEXT_BLOCK_TAGS.entries()].sort()).toEqual(
      specTypes.map((t) => [reactBlockTagFor(t), t]).sort(),
    );
    // The four that were published, spelled out — the regression this pins.
    for (const tag of ['RecordDetails', 'RecordHighlights', 'RecordRelatedList', 'RecordPath']) {
      expect(RECORD_CONTEXT_BLOCK_TAGS.has(tag)).toBe(true);
    }
  });

  it('classifies by the `record:` prefix, not by a tag spelling', () => {
    expect(isRecordContextBlockType('record:related_list')).toBe(true);
    expect(isRecordContextBlockType('record:activity')).toBe(true);
    expect(isRecordContextBlockType('list-view')).toBe(false);
    expect(isRecordContextBlockType('element:record_picker')).toBe(false);
  });

  it('names a working replacement for each withdrawn block', () => {
    // The gate quotes these; an empty one would leave an author with a refusal
    // and no way forward.
    for (const type of ['record:details', 'record:highlights', 'record:related_list', 'record:path']) {
      expect(REACT_RECORD_BLOCK_ALTERNATIVES[type]).toBeTruthy();
    }
    // Each names a block the react tier actually publishes.
    const tags = REACT_BLOCKS.map((b) => b.tag);
    expect(REACT_RECORD_BLOCK_ALTERNATIVES['record:related_list']).toContain('ListView');
    expect(REACT_RECORD_BLOCK_ALTERNATIVES['record:details']).toContain('ObjectForm');
    expect(tags).toContain('ListView');
    expect(tags).toContain('ObjectForm');
  });
});
