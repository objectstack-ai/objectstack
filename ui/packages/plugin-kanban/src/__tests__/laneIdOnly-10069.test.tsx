/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10069 (ruling A) — a kanban lane matches a record by lane `id`, the
 * stored option value, ONLY. The lane `title` is presentation.
 *
 * Before the ruling `bucketCardsIntoColumns` also lowercased every lane
 * `title` into its lookup, so the title was an undeclared second bucketing
 * key. Three things moved records as a result, and each is a row here:
 *
 *   1. LOCALE. Lane titles are translated (`localizeColumn` and
 *      `translateOptions` in `ObjectKanban.tsx`), so a record storing the
 *      English label bucketed into its lane under one locale and into
 *      "Uncategorized" under another. Membership must not depend on titles.
 *   2. THE PICKLIST DOOR. With no authored `columns`, lanes are derived from
 *      the groupBy field's options as `{ id: opt.value, title: opt.label }`,
 *      so relabelling an option moved records too. Driven through the real
 *      renderer, because that door lives in `ObjectKanban`, not in the pure
 *      bucketer. (The authored-`columns` door is the flipped row in
 *      `objectKanbanColumnMembers-8071.test.tsx`.)
 *   3. LOUDNESS. A record that no longer matches is a DATA defect (it stored a
 *      label instead of the value), so the move into "Uncategorized" is
 *      named on the console — once per distinct raw value per bucketing pass.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`; module scope because the import IS the
// registration (AGENTS.md's test-discipline section).
import { bucketCardsIntoColumns, KANBAN_UNCOLUMNED_ID } from '../index';
// Same specifier as `index.tsx`'s `React.lazy` factory, imported at module
// scope so the cold transform is billed to the import phase (objectui#3010).
import '../KanbanImpl';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** `id:card+card` per lane, in lane order. */
const summarise = (lanes: Array<any>): string =>
  lanes.map((l: any) => `${String(l.id)}:${(l.cards || []).map((c: any) => c.id).join('+')}`).join(', ');

const bucket = (columns: Array<any>, data: Array<any>) =>
  bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');

const RECORDS = [
  { id: 'r1', status: 'in_progress' }, // the option VALUE
  { id: 'r2', status: 'In Progress' }, // the English LABEL
  { id: 'r3', status: 'done' },
];

describe('objectui#10069 — lane membership is decided by lane id only', () => {
  it('⭐ a translated title does not change membership', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const english = [
      { id: 'in_progress', title: 'In Progress' },
      { id: 'done', title: 'Done' },
    ];
    const german = [
      { id: 'in_progress', title: 'In Bearbeitung' },
      { id: 'done', title: 'Erledigt' },
    ];

    const underEnglish = summarise(bucket(english, RECORDS));
    const underGerman = summarise(bucket(german, RECORDS));

    // Same ids, different titles ⇒ the same board. Before the ruling the
    // English run put r2 in `in_progress` and the German run swept it.
    expect(underEnglish).toBe(underGerman);
    expect(underEnglish).toBe(`in_progress:r1, done:r3, ${KANBAN_UNCOLUMNED_ID}:r2`);
  });

  it('CONTROL — the id comparison keeps its case folding', () => {
    // The ruling retires the TITLE key only; an id spelled in another case
    // still lands, so the row above is about titles and not about folding.
    expect(summarise(bucket([{ id: 'in_progress', title: 'In Progress' }], [{ id: 'r1', status: 'IN_PROGRESS' }]))).toBe(
      'in_progress:r1',
    );
  });

  describe('the console warn', () => {
    const LANES = [
      { id: 'open', title: 'Open' },
      { id: 'won', title: 'Won' },
    ];

    it('names the raw value, the grouping field and every available lane id', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      bucket(LANES, [{ id: 'r1', status: 'Opened' }]);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('"Opened"');
      expect(message).toContain('"status"');
      expect(message).toContain('["open", "won"]');
    });

    it('fires ONCE per distinct raw value per pass, not once per record', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      bucket(LANES, [
        { id: 'r1', status: 'Opened' },
        { id: 'r2', status: 'Opened' },
        { id: 'r3', status: 'Opened' },
        { id: 'r4', status: 'Closed Won' },
        { id: 'r5', status: 'OPEN' }, // matched (case-folded id): no warn
      ]);

      expect(warn).toHaveBeenCalledTimes(2);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.find((m) => m.includes('"Opened"'))).toContain('3 record(s)');
      expect(messages.find((m) => m.includes('"Closed Won"'))).toContain('1 record(s)');

      // A second pass (the next render or data load) warns again: deduplication
      // is per pass, never module-wide, so a later board is not silenced.
      bucket(LANES, [{ id: 'r1', status: 'Opened' }]);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('stays silent when every record matches, and for an EMPTY group value', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const out = bucket(LANES, [
        { id: 'r1', status: 'open' },
        { id: 'r2', status: '' },
        { id: 'r3' },
      ]);

      // The empty-valued records still surface (#2792) — only the warn is withheld.
      expect(summarise(out)).toBe(`open:r1, won:, ${KANBAN_UNCOLUMNED_ID}:r2+r3`);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The picklist door — lanes derived from `field.options`, no `columns`        */
/* -------------------------------------------------------------------------- */

const OBJECT = 'deal';

const DEAL_SCHEMA = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' },
      ],
    },
  },
};

function makeAdapter(rows: Array<Record<string, unknown>>): Record<string, any> {
  return {
    find: vi.fn(async () => ({ data: rows })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEAL_SCHEMA),
  };
}

const cardsInList = (container: HTMLElement, label: string): string[] =>
  [...(container.querySelector(`[role="list"][aria-label="${label}"]`)?.children ?? [])]
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((name) => name !== '');

const laneNames = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="group"]')].map((n) => n.getAttribute('aria-label') ?? '');

describe('objectui#10069 — the picklist door (`title: opt.label`) no longer buckets by label', () => {
  it('⭐ a record storing an option LABEL is swept; the one storing its VALUE lands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeAdapter([
      { id: 'a', name: 'By value', status: 'in_progress' },
      { id: 'b', name: 'By label', status: 'In Progress' },
    ]);
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={{ type: 'object-kanban', objectName: OBJECT, groupBy: 'status' } as never} />
      </SchemaRendererProvider>,
    );

    // Wait on the CARD, not the lane: lanes commit before the query settles.
    await waitFor(() => expect(cardsInList(container, 'In Progress cards')).toEqual(['By value']));
    // The lanes really were derived from the picklist (titles are the labels),
    // plus the trailing sweep holding the label-valued record.
    expect(laneNames(container).slice(0, 2)).toEqual(['In Progress', 'Done']);
    expect(laneNames(container)).toHaveLength(3);
    expect(cardsInList(container, `${laneNames(container)[2]} cards`)).toEqual(['By label']);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('"In Progress"') && String(c[0]).includes('"in_progress", "done"')),
    ).toBe(true);
  });
});
