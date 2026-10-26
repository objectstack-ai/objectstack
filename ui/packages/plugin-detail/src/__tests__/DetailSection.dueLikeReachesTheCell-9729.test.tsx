/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `dueLike` on a DETAIL-VIEW FIELD reaches the cell (objectui#9729)
 * — retired by objectui#11815; the cases at the bottom pin the inversion.
 *
 * ## Why this reading exists
 *
 * `views.zod.ts#DetailViewFieldSchema` states `dueLike` and the `DetailViewField`
 * twin does not — one of the two LOCAL entries in the `MirroredUndeclared`
 * ledger. The contract review that decides which published face moves needs one
 * fact the ledger cannot carry: whether anything READS the key on THIS pair's
 * authored face, because a key nothing reads is a different decision from one a
 * renderer consumes.
 *
 * ⛔ A source grep cannot answer that. `SchemaRenderer` hands a node's leftover
 * keys to the component as props, and this path adds a second hop of its own:
 * `DetailSection` spreads the authored field into the enriched bag
 * (`enrichDetailField` opens with a spread of the view field) and hands that bag
 * to the resolved cell renderer. So the question is asked here the only way it
 * can be answered — by rendering, and by watching the drawn text change.
 *
 * ## The reading, and its control
 *
 * `end_date` deliberately does NOT match the due/deadline field-NAME convention
 * that `resolveDueLike` falls back to, so the authored key is the only thing
 * that can turn the affordance on. The control leg renders BY VALUE — it asserts
 * the neutral relative wording is present, not merely that "Overdue" is absent,
 * which would also be true of a document that drew nothing.
 *
 * ⛔ This file takes no position on the remedy. It measures a read; whether the
 * key should be declared on the twin or removed from the mirror is objectui#9729.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const sectionOf = (fields: unknown[]): DetailViewSection =>
  ({ title: 'S', fields }) as unknown as DetailViewSection;

/** A past date on a field whose NAME carries no due/deadline convention. */
const BASE = { name: 'end_date', label: 'End', type: 'date', format: 'relative' };
const DATA = { end_date: daysAgo(3) };

/**
 * ⭐ INVERTED BY RULING (objectui#11815, ruling D) — ⛔ not relaxed. The
 * authored view-entry `dueLike` retired: the deadline is the object FIELD's
 * declaration, read through `enrichDetailField`. So the key on the view entry
 * no longer reaches the cell, and the same key on the object field does.
 */
describe('`dueLike` reaches the detail cell from the FIELD, not the view entry (objectui#11815)', () => {
  it('a view-entry `dueLike` no longer changes the drawn wording', () => {
    render(<DetailSection section={sectionOf([{ ...BASE, dueLike: true }])} data={DATA} />);
    const html = document.body.innerHTML;
    expect(html).toContain('days ago');
    expect(html).not.toContain('Overdue');
  });

  it("the object field's `dueLike` reaches the date cell and changes the drawn wording", () => {
    const objectSchema = { fields: { end_date: { name: 'end_date', type: 'date', dueLike: true } } };
    render(<DetailSection section={sectionOf([{ ...BASE }])} data={DATA} objectSchema={objectSchema} />);
    expect(document.body.innerHTML).toContain('Overdue');
  });

  it('CONTROL — the same field without the key draws the neutral wording', () => {
    render(<DetailSection section={sectionOf([{ ...BASE }])} data={DATA} />);
    const html = document.body.innerHTML;
    // Rendered BY VALUE first: an absent affordance means nothing on a document
    // that drew nothing at all.
    expect(html).toContain('days ago');
    expect(html).not.toContain('Overdue');
  });
});
