/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11270 — the authored `record:related_list.actions` channel places an
 * id whose action declares `record_related` on each row (the renderer half of
 * objectstack-ai/objectstack#20937's enforce answer, triage `5919625056`).
 *
 * `record_related` is ROW placement scoped to a parent record, and this block
 * only ever draws inside one, so the placement rule the channel applies reads
 * three locations: `list_toolbar` (header), `list_item` and `record_related`
 * (each row's menu). The DOM half, through the real host bridge and the real
 * renderer, is `RelatedRecordActionsBridge.recordRelated-11270.test.tsx` in
 * `@object-ui/app-shell`.
 */

import { describe, it, expect } from 'vitest';
import {
  describeRelatedListActionRefusals,
  placeAuthoredRelatedListActions,
} from '../relatedListActions';

const REGISTERED = [
  { name: 'log_time', locations: ['record_related'] },
  { name: 'send_reminder', locations: ['list_item'] },
  { name: 'archive', locations: ['list_item', 'record_related'] },
  { name: 'invite', locations: ['list_toolbar'] },
  { name: 'header_only', locations: ['record_header'] },
];

const names = (actions: ReadonlyArray<{ name?: unknown }>) => actions.map((a) => a.name);

describe('placeAuthoredRelatedListActions — `record_related` (objectui#11270)', () => {
  it('a named `record_related` id is placed on the row, and nothing is refused', () => {
    const placed = placeAuthoredRelatedListActions(['log_time'], REGISTERED);
    expect(names(placed.row)).toEqual(['log_time']);
    expect(placed.toolbar).toEqual([]);
    expect(placed.refused).toEqual([]);
  });

  it('CONTROL: `list_item` is still placed on the row and `list_toolbar` in the header', () => {
    const placed = placeAuthoredRelatedListActions(['invite', 'send_reminder'], REGISTERED);
    expect(names(placed.row)).toEqual(['send_reminder']);
    expect(names(placed.toolbar)).toEqual(['invite']);
    expect(placed.refused).toEqual([]);
  });

  it('a `record_related` id shares the row with `list_item` ids, in authored order', () => {
    const placed = placeAuthoredRelatedListActions(['log_time', 'invite', 'send_reminder'], REGISTERED);
    expect(names(placed.row)).toEqual(['log_time', 'send_reminder']);
    expect(names(placed.toolbar)).toEqual(['invite']);
    expect(placed.refused).toEqual([]);
  });

  it('an action declaring both row locations is placed once', () => {
    const placed = placeAuthoredRelatedListActions(['archive'], REGISTERED);
    expect(names(placed.row)).toEqual(['archive']);
  });

  it('an action declaring none of the three is still refused as unplaced', () => {
    const placed = placeAuthoredRelatedListActions(['header_only'], REGISTERED);
    expect(placed.row).toEqual([]);
    expect(placed.toolbar).toEqual([]);
    expect(placed.refused).toEqual([{ kind: 'unplaced', id: 'header_only' }]);
  });
});

describe('describeRelatedListActionRefusals — the notice names the three related-list locations (objectui#11270)', () => {
  it('an unplaced id is told every location this list draws', () => {
    const text = describeRelatedListActionRefusals([{ kind: 'unplaced', id: 'header_only' }], 'task', true);
    expect(text).toContain('"header_only"');
    expect(text).toMatch(/list_toolbar/);
    expect(text).toMatch(/list_item/);
    expect(text).toMatch(/record_related/);
  });
});
