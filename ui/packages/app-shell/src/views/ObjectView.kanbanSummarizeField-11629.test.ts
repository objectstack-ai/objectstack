/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11629: the object page relays the view's `summarizeField`.
 *
 * `@objectstack/spec` declares `summarizeField` on the view-level
 * `KanbanConfig`: "Field to sum at top of column". `plugin-kanban` paints that
 * total in each column header, and `ListView` projects the field and passes it
 * onto the board it generates. On the console object page, though,
 * `kanbanViewOptions` is the only kanban config `ListView` receives when the
 * stored row carries no `options.kanban` bag. It relayed only the lane, the
 * title and the card fields, so the showcase task board
 * (`summarizeField: 'estimate_hours'`) rendered counts with no totals.
 *
 * The arms assert what this face WRITES. Absence stays absence: a view that
 * declares no `summarizeField` gets no key at all, not an invented one. The
 * omission arms are the control that keeps the carry arm from passing against a
 * producer that writes the key unconditionally.
 */

import { describe, it, expect } from 'vitest';
import { kanbanViewOptions } from './ObjectView';

/** An object whose lifecycle field the ADR-0085 detector finds by name. */
const OBJECT_WITH_STAGE = {
  name: 'deal',
  fields: { name: { type: 'text' }, stage: { type: 'select' }, amount: { type: 'currency' } },
};

describe('the object page relays the view\'s `summarizeField` (objectui#11629)', () => {
  it('carries `summarizeField` when the view declares it', () => {
    const out = kanbanViewOptions(
      { kanban: { groupByField: 'stage', summarizeField: 'amount', columns: ['name'] } },
      OBJECT_WITH_STAGE,
    );
    expect(out.summarizeField).toBe('amount');
    // The neighbouring forwards are untouched by the relay.
    expect(out.groupByField).toBe('stage');
    expect(out.columns).toEqual(['name']);
  });

  it('carries it on the detector path too, where the view names no lane', () => {
    const out = kanbanViewOptions({ kanban: { summarizeField: 'amount' } }, OBJECT_WITH_STAGE);
    expect(out.groupByField).toBe('stage');
    expect(out.summarizeField).toBe('amount');
  });

  it('omits the key when the view declares a kanban block without it', () => {
    const out = kanbanViewOptions({ kanban: { groupByField: 'stage' } }, OBJECT_WITH_STAGE);
    expect(out).not.toHaveProperty('summarizeField');
  });

  it('omits the key when the view declares no kanban block at all', () => {
    const out = kanbanViewOptions({}, OBJECT_WITH_STAGE);
    expect(out).not.toHaveProperty('summarizeField');
    // CONTROL: the bag is not empty, so the omission is not a producer that wrote nothing.
    expect(out.groupByField).toBe('stage');
  });
});
