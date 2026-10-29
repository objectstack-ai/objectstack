/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 12 — every block the object page hands `ListView` is a
 * block `@object-ui/types` accepts.
 *
 * The census before that round found three keys this page's producers wrote
 * that the list view's blocks refuse (`kanban.cardFields`, `gallery.imageField`,
 * `timeline.descriptionField`), and the seat ruled the producer moves first
 * (Q1 → A on objectui#6152). So this file RUNS each exported producer on views
 * declaring their kind's block in full, and parses what it returns. A producer
 * that writes an undeclared key again reddens here by name.
 *
 * objectstack#25923: the blocks used to travel under the list view's `options`
 * bag and were parsed at the bag's door. The bag is retired, the page relays
 * each block at the top level, so each is parsed at the list view's own
 * top-level slot for its kind, the one door left.
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
const NODE = { type: 'list-view', objectName: 'deal' };
/** The issues the list view raises inside the relayed blocks, the node's own keys aside. */
const verdictOf = (blocks: Record<string, unknown>) => {
  const r = ListViewSchema.safeParse({ ...NODE, ...blocks });
  if (r.success) return [];
  return (r.error.issues as Issue[])
    .filter((i) => typeof i.path[0] === 'string' && i.path[0] in blocks)
    .map((i) => ({ code: i.code, path: i.path.join('.'), keys: i.keys }));
};

describe('every block the object page synthesizes parses at its top-level slot (objectui#6152 round 12, objectstack#25923)', () => {
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

  it('CONTROL: the slots still refuse the three keys these producers used to write', () => {
    // Without this, a slot that had stopped judging anything would satisfy every
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
