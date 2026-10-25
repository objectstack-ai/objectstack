/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 12 — what the object page writes into the `options` bag
 * it hands `ListView` is a bag `@object-ui/types` accepts.
 *
 * `ListViewSchema.options` became the `@objectstack/spec` list overlay's own
 * bag that round: strict, each kind its list-view block with every key
 * optional. The census before it found three keys this page's producers wrote
 * that the bag refuses (`kanban.cardFields`, `gallery.imageField`,
 * `timeline.descriptionField`), and the seat ruled the producer moves first
 * (Q1 → A on objectui#6152). So this file RUNS each exported producer on views
 * declaring their kind's block in full, and parses the block it returns at the
 * bag's own door for that kind. A producer that writes an undeclared key again
 * reddens here by name.
 *
 * ⚠️ The render path parses nothing: the claim is about the contract this page's
 * output meets, not about anything that is enforced while it renders.
 * ⚠️ `map` and `tree` are built inline in `renderListView`, not by an exported
 * producer, so they are not run here; the census read both as spec keys only.
 */

import { describe, it, expect } from 'vitest';
import { ListViewSchema } from '@object-ui/types/zod';
import {
  calendarViewOptions,
  galleryViewOptions,
  ganttViewOptions,
  kanbanViewOptions,
  timelineViewOptions,
} from './ObjectView';

const OBJECT_WITH_STAGE = { name: 'deal', fields: { name: { type: 'text' }, stage: { type: 'select' } } };

type Issue = { code: string; path: PropertyKey[]; keys?: string[] };
const bag = (ListViewSchema.shape.options as unknown as { unwrap: () => { safeParse: (v: unknown) => { success: boolean; error?: { issues: Issue[] } } } }).unwrap();
const verdictOf = (options: Record<string, unknown>) => {
  const r = bag.safeParse(options);
  return r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: i.keys }));
};

describe('every block the object page synthesizes parses at the bag\'s door (objectui#6152 round 12)', () => {
  it.each([
    ['kanban, a declared block', { kanban: kanbanViewOptions({ kanban: { groupByField: 'stage', columns: ['name'], titleField: 'name', summarizeField: 'amount' } }, OBJECT_WITH_STAGE) }],
    ['kanban, the detector path', { kanban: kanbanViewOptions({}, OBJECT_WITH_STAGE) }],
    ['calendar, a declared block', { calendar: calendarViewOptions({ calendar: { startDateField: 'starts_at', endDateField: 'ends_at', titleField: 'name' } }) }],
    ['timeline, a declared block', { timeline: timelineViewOptions({ timeline: { startDateField: 'starts_at', endDateField: 'ends_at', groupByField: 'stage', scale: 'month' } }) }],
    ['timeline, no block', { timeline: timelineViewOptions({}) }],
    ['gallery, a declared block', { gallery: galleryViewOptions({ gallery: { coverField: 'logo', coverFit: 'contain', cardSize: 'large', visibleFields: ['name'] } }) }],
    ['gallery, no block', { gallery: galleryViewOptions({}) }],
    ['gantt, a declared block', { gantt: ganttViewOptions({ gantt: { startDateField: 'starts_at', endDateField: 'ends_at', progressField: 'progress' } }) }],
  ])('%s', (_label, options) => {
    expect(verdictOf(options)).toEqual([]);
  });

  it('CONTROL: the door still refuses the three keys these producers used to write', () => {
    // Without this, a bag that had stopped judging anything would satisfy every
    // row above. Each key is refused at its own kind, by name.
    expect(verdictOf({ kanban: { groupByField: 'stage', cardFields: ['name'] } })).toContainEqual(
      expect.objectContaining({ path: 'kanban.cardFields' }),
    );
    expect(verdictOf({ gallery: { coverField: 'logo', imageField: 'logo' } })).toContainEqual(
      expect.objectContaining({ path: 'gallery.imageField' }),
    );
    expect(verdictOf({ timeline: { titleField: 'name', descriptionField: 'notes' } })).toContainEqual(
      { code: 'unrecognized_keys', path: 'timeline', keys: ['descriptionField'] },
    );
  });
});
