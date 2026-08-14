// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8691 — `record:reference_rail` gets its `ComponentPropsMap` row.
//
// The gap this pins: the rail had a registered renderer, a `PageComponentType`
// entry and a console palette slot, but no props row — so an authored entry
// `filter` parsed, typechecked, `objectstack validate`d, built, shipped
// verbatim in `dist/objectstack.json` and silently filtered nothing, while the
// SAME build emitted loud `component-props-unknown-key` diagnostics for
// `record:related_list` keys in the same file. The issue's measurement chain is
// reproduced here as pins in both directions: the planted bogus key refused,
// the real shape accepted byte-identically.
//
// The key set is measured from the renderer's read points at the
// `.objectui-sha` pin (`record-reference-rail.tsx`), NOT from its TS interface
// — `icon` is in the interface and emitted by the page synthesizer but read by
// no render path, so it is a guidance refusal here, not a declared key.

import { describe, expect, it } from 'vitest';
import {
  ComponentPropsMap,
  RecordReferenceRailProps,
  ReferenceRailEntrySchema,
} from './component.zod';
import { RECORD_CONTEXT_BLOCK_TAGS, reactBlockTagFor } from './react-blocks';

/** All issue messages of a failed safeParse, joined for content assertions. */
const messagesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) => {
  expect(result.success).toBe(false);
  return result.error!.issues.map((i) => i.message).join('\n');
};

describe('ComponentPropsMap["record:reference_rail"] (#8691)', () => {
  it('exists, and is the exported schema (the row is what the #5068 gate dispatches on)', () => {
    expect(ComponentPropsMap['record:reference_rail']).toBe(RecordReferenceRailProps);
  });

  // The issue's own planted key, spelled exactly as it was authored on the
  // real app: it passed tsc, validate and build, and the rendered badge kept
  // counting everything. With the row in place it is a prescriptive refusal.
  it('refuses the planted entry `filter` with the no-capability prescription', () => {
    const message = messagesOf(RecordReferenceRailProps.safeParse({
      entries: [{
        objectName: 'task',
        relationshipField: 'project_id',
        filter: [{ field: 'status', op: 'neq', value: 'completed' }],
      }],
    }));
    expect(message).toContain('`filter`');
    expect(message).toContain('record:reference_rail');
    // The prescription: the rail's query is fixed, related_list is where
    // `filter` is real, and this shape is where a granted filter would land.
    expect(message).toContain('record:related_list');
  });

  it('accepts the real shape byte-identically (no defaults materialized)', () => {
    // The synth-emitted shape minus `icon` — every key the renderer reads.
    const authored = {
      entries: [
        {
          objectName: 'opportunity_quote',
          relationshipField: 'opportunity_id',
          title: 'Quotes',
          limit: 3,
          displayField: 'quote_number',
        },
        { objectName: 'task', relationshipField: 'opportunity_id' },
      ],
      hideEmpty: false,
    };
    const result = RecordReferenceRailProps.parse(authored);
    // Byte-identical: nothing stripped, nothing added. `limit` / `hideEmpty`
    // carry NO schema default (renderer fallbacks 3 / true are the renderer's
    // facts, not the author's), so the minimal entry round-trips unchanged.
    expect(result).toEqual(authored);
  });

  it('leaves `limit` and `hideEmpty` undefined when unauthored — the renderer owns those defaults', () => {
    const result = RecordReferenceRailProps.parse({
      entries: [{ objectName: 'task', relationshipField: 'project_id' }],
    });
    expect(result.hideEmpty).toBeUndefined();
    expect(result.entries[0]!.limit).toBeUndefined();
  });

  // `icon` is the measured divergence between the renderer's TS interface (and
  // the page synthesizer's emission) and its actual read points: no render
  // path reads it. Declaring it would be declared-but-unenforced surface — the
  // exact defect class this row closes.
  it('refuses entry `icon` with the read-by-nothing prescription', () => {
    const message = messagesOf(ReferenceRailEntrySchema.safeParse({
      objectName: 'task',
      relationshipField: 'project_id',
      icon: 'CheckSquare',
    }));
    expect(message).toContain('`icon`');
    expect(message).toContain('read by nothing');
  });

  it('routes an entry-level `hideEmpty` up to the component level', () => {
    const message = messagesOf(ReferenceRailEntrySchema.safeParse({
      objectName: 'task',
      relationshipField: 'project_id',
      hideEmpty: true,
    }));
    expect(message).toContain('COMPONENT-level');
    expect(message).toContain('`entries`');
  });

  // The rail renders `title` as a raw React child: a locale map would paint
  // `[object Object]`. The inline-map capability question belongs to the
  // downstream console card (maintainer pull ruling pending) — until granted,
  // the contract is the literal string the renderer delivers.
  it('accepts a literal string `title` and refuses an inline locale map', () => {
    expect(ReferenceRailEntrySchema.parse({
      objectName: 'task', relationshipField: 'project_id', title: 'Open Tasks',
    }).title).toBe('Open Tasks');
    expect(ReferenceRailEntrySchema.safeParse({
      objectName: 'task', relationshipField: 'project_id',
      title: { en: 'Tasks', 'zh-CN': '任务' },
    }).success).toBe(false);
  });

  it('names the neighbouring-surface aliases in both shapes', () => {
    // Component level: `items` (page:tabs / page:accordion) and `related`
    // (the page synthesizer's option) both point at `entries`.
    for (const key of ['items', 'related'] as const) {
      const message = messagesOf(RecordReferenceRailProps.safeParse({ [key]: [] }));
      expect(message).toContain(`\`${key}\``);
      expect(message).toContain('`entries`');
    }
    // Entry level: `object` (element data sources) → `objectName`; `label`
    // (record:highlights / record:path spelling) → `title`.
    const objectMsg = messagesOf(ReferenceRailEntrySchema.safeParse({
      object: 'task', relationshipField: 'project_id',
    }));
    expect(objectMsg).toContain('`objectName`');
    const labelMsg = messagesOf(ReferenceRailEntrySchema.safeParse({
      objectName: 'task', relationshipField: 'project_id', label: 'Tasks',
    }));
    expect(labelMsg).toContain('`title`');
  });

  it('requires at least one entry — an empty rail renders nothing, loudly refused', () => {
    expect(RecordReferenceRailProps.safeParse({ entries: [] }).success).toBe(false);
    expect(RecordReferenceRailProps.safeParse({}).success).toBe(false);
  });

  it('rejects a non-positive or fractional `limit` rather than shipping it to `$top`', () => {
    for (const limit of [0, -1, 2.5]) {
      expect(ReferenceRailEntrySchema.safeParse({
        objectName: 'task', relationshipField: 'project_id', limit,
      }).success).toBe(false);
    }
  });

  // Derived coverage the row buys with no further edit: the react publish gate
  // classifies every `record:*` map key as record-context, so the rail is now
  // withdrawable-by-name from `kind:'react'` pages under its injected tag.
  it('is covered by the react record-context gate under its derived tag', () => {
    expect(RECORD_CONTEXT_BLOCK_TAGS.get(reactBlockTagFor('record:reference_rail')))
      .toBe('record:reference_rail');
  });
});
