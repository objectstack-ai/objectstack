/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10222 — `ObjectTimeline` reads no `timeline.metaFields` list.
 *
 * Ruling batch #223 item 5b, letter A (comment 5824012155 on the card): the
 * undeclared `metaFields` reads are deleted in both packages. The spec's
 * `TimelineConfigSchema` is a strict object that declares no such member and
 * refuses one, so an author could only reach this read through a stored view's
 * unjudged `options` bag (objectui#10380). The chips beside each title are now
 * always the built-in `status` / `priority` pair, limited to the fields the
 * object declares. ⛔ `cardFields` is the reserved spelling if a producer ever
 * asks for authored chip fields; nothing is declared here.
 *
 * Behaviour change, named in the changeset: a stored interface-page view that
 * carries `options.timeline.metaFields` falls back to the default chips.
 * `plugin-list`'s `ListView.timelineMetaFieldsRetired-10222.test.tsx` pins the
 * projection half, which keeps fetching status / priority for every timeline.
 *
 * `./renderer` is deliberately NOT mocked: the chips are read off the real
 * `TimelineRenderer` output, the surface a user sees. Harness as in
 * `__tests__/timeline-shared-safe-field-label-5623.test.tsx`.
 *
 * The SOURCE pin for this package (no `metaFields` read left in any non-test
 * file under `src/`) lives in that `plugin-list` file beside the projection
 * pin, not here: it reads files off disk, and this package's
 * `tsconfig.test.json` names no `node` types, so a `node:fs` import here would
 * not type-check. It runs in the same `pnpm test`.
 */
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTimeline } from './ObjectTimeline';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

afterEach(() => cleanup());

const OBJECT_DEF = {
  fields: {
    status: { type: 'select', options: [{ value: 'open', label: 'Open' }] },
    priority: { type: 'select', options: [{ value: 'high', label: 'High' }] },
    region: { type: 'select', options: [{ value: 'emea', label: 'EMEA' }] },
  },
};

const ROWS = [
  { id: '1', name: 'Item 1', date: '2024-01-01', status: 'open', priority: 'high', region: 'emea' },
];

function makeDataSource() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
  };
}

/** `MetaChip`'s own classes; the title, date and markers carry none of them. */
const chipTexts = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('span.rounded-full.border.text-xs')).map((el) => el.textContent ?? '');

/** Mount with this `timeline` block and return the chip labels once the object definition has landed. */
async function chipsFor(timeline: Record<string, unknown>): Promise<string[]> {
  const props = {
    schema: { type: 'object-timeline', objectName: 'lead', titleField: 'name', timeline },
    data: ROWS,
    dataSource: makeDataSource(),
  } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  const { container, unmount } = render(<ObjectTimeline {...props} />);
  // The chips appear only after `getObjectSchema` resolves; the title is there
  // from the first render, so wait on a chip rather than on `Item 1`.
  await waitFor(() => expect(chipTexts(container).length).toBeGreaterThan(0));
  const chips = chipTexts(container);
  expect(screen.getByText('Item 1'), 'the row itself rendered').toBeDefined();
  unmount();
  return chips;
}

const BLOCK = { startDateField: 'date' };

describe('ObjectTimeline — the `metaFields` read is retired (objectui#10222)', () => {
  it('CONTROL: with no `metaFields`, the built-in status / priority chips render', async () => {
    expect(await chipsFor(BLOCK)).toEqual(['Open', 'High']);
  });

  it('RENDER: a block carrying `metaFields` renders the SAME chips as one without', async () => {
    const without = await chipsFor(BLOCK);
    const withKey = await chipsFor({ ...BLOCK, metaFields: ['region'] });
    expect(
      withKey,
      'the key is undeclared on the spec timeline block; the chips must not change with it',
    ).toEqual(without);
    expect(withKey, 'the field named by the retired key must not become a chip').not.toContain('EMEA');
  });
});
