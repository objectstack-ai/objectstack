/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every key `ObjectGridSchema` declares takes effect or is retired
 * (objectui#11068) — the RENDERER half. The declaration half (the four
 * tombstones and the `emptyState` mirror) is `packages/types`'
 * `object-grid-declared-keys-11068.test.ts`; the fifth tombstone, `showFilters`,
 * is `object-grid-show-filters-retired-11068.test.ts` there.
 *
 *   1. `description` draws one line of help text above the grid, resolved like
 *      `label` — a locale map against the display locale.
 *   2. `emptyState` draws in place of an empty table — but not when a term in
 *      the grid's own server-side search box emptied it, where the table and its
 *      search box must stay.
 *   3. `name`, `placeholder`, `rowSpecActions`, `bulkSpecActions` and
 *      `showFilters` — the five keys the card retired — draw nothing. Asked
 *      with a RULER, the same document drawn twice and compared as bytes,
 *      because `ObjectGridRenderer`
 *      hands a node's leftover keys on as props and a source grep cannot see
 *      that channel (AGENTS.md, "a source grep's zero cannot answer this").
 *
 * Every "draws nothing" reading is paired with a lit control on the same
 * instrument: a byte ruler that cannot move proves nothing.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';
// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';

afterEach(cleanup);

const ROWS = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];

/** A grid over inline rows; `items: []` is a grid with no record at all. */
const grid = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: 'probe',
  columns: ['name'],
  data: { provider: 'value', items },
  ...extra,
});

/** The table's own empty-row heading — what a grid draws with no `emptyState`. */
const TABLE_EMPTY_HEADING = 'No results found';

/* ── 1. `description` ─────────────────────────────────────────────────────── */

describe('`description` draws one line of help text above the grid (objectui#11068)', () => {
  it('draws a plain string', async () => {
    render(<ObjectGridRenderer schema={grid(ROWS, { description: 'Everyone you work with' })} />);
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    expect(screen.getByTestId('object-grid-description')).toHaveTextContent('Everyone you work with');
  });

  it('resolves a locale map against the display locale, through a real page document', async () => {
    // `en` FIRST on purpose: a resolver that fell back to `en` or to the first
    // entry would paint English under `fr` and fail this row.
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'fr', detectBrowserLanguage: false }}>
        <ActionProvider>
          <SchemaRenderer
            schema={{
              type: 'object-grid',
              properties: {
                objectName: 'probe',
                columns: ['name'],
                data: { provider: 'value', items: ROWS },
                description: { en: 'Everyone you work with', fr: 'Tous vos contacts' },
              },
            } as never}
          />
        </ActionProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(container.textContent ?? '').toContain('Alpha'));
    expect(screen.getByTestId('object-grid-description')).toHaveTextContent('Tous vos contacts');
  });

  it('a map with no usable entry draws no strip, and neither does an absent key', async () => {
    render(<ObjectGridRenderer schema={grid(ROWS, { description: {} })} />);
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    expect(screen.queryByTestId('object-grid-description')).toBeNull();
    cleanup();
    render(<ObjectGridRenderer schema={grid(ROWS)} />);
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    expect(screen.queryByTestId('object-grid-description')).toBeNull();
  });
});

/* ── 2. `emptyState` ──────────────────────────────────────────────────────── */

describe('`emptyState` draws in place of an empty table (objectui#11068)', () => {
  it('draws the authored title, message and icon when the grid has no record', async () => {
    const { container } = render(
      <ObjectGridRenderer
        schema={grid([], { emptyState: { title: 'No contacts yet', message: 'Add one to get started', icon: 'users' } })}
      />,
    );
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state).toHaveTextContent('No contacts yet');
    expect(state).toHaveTextContent('Add one to get started');
    expect(state.querySelector('svg.lucide-users')).not.toBeNull();
    // It REPLACES the table's own empty row; it is not drawn beside it.
    expect(screen.queryByText(TABLE_EMPTY_HEADING)).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('LIT CONTROL — without the key, the same empty grid draws the first-run state, not the authored one', async () => {
    // objectui#13142: an unsearched empty grid no longer falls through to the
    // table's "No results found" row; the first-run rows are
    // `ObjectGrid.firstRunEmptyState-13142.test.tsx`'s.
    render(<ObjectGridRenderer schema={grid([])} />);
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state).not.toHaveTextContent('No contacts yet');
    expect(screen.queryByText(TABLE_EMPTY_HEADING)).toBeNull();
  });

  it('a member left out keeps the default: the table’s heading, no message, the shared glyph', async () => {
    render(<ObjectGridRenderer schema={grid([], { emptyState: { icon: 'not-a-lucide-icon-11068' } })} />);
    const state = await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
    expect(state.querySelector('h3')).toHaveTextContent(TABLE_EMPTY_HEADING);
    expect(state.querySelector('p')).toBeNull();
    // An icon name that resolves to nothing is the same as none: the shared
    // component's own glyph, never a blank box.
    expect(state.querySelector('[data-slot="data-empty-state-icon"] svg')).not.toBeNull();
  });

  it('is not drawn while the grid holds rows', async () => {
    render(<ObjectGridRenderer schema={grid(ROWS, { emptyState: { title: 'No contacts yet' } })} />);
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
  });

  /**
   * The host-driven mode: a parent owns the rows and the search term, and the
   * grid's own search box writes back to it. A term that found nothing must
   * leave the table — and the box — in place, or the user cannot clear it.
   */
  const hostDriven = (search: string) => (
    <ObjectGrid
      schema={grid([], { emptyState: { title: 'No contacts yet' } }) as never}
      data={[]}
      manualPagination
      rowCount={0}
      page={1}
      pageSize={10}
      onPageChange={() => {}}
      search={search}
      onSearchChange={() => {}}
    />
  );

  it('is NOT drawn when a term in the grid’s own server-side search box emptied it', async () => {
    const { container } = render(hostDriven('zzz'));
    await screen.findByText(TABLE_EMPTY_HEADING, {}, { timeout: 5000 });
    expect(screen.queryByTestId('object-grid-empty-state')).toBeNull();
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('LIT CONTROL — the same host-driven grid with no term draws it', async () => {
    render(hostDriven(''));
    await screen.findByTestId('object-grid-empty-state', {}, { timeout: 5000 });
  });
});

/* ── 3. The five retired keys draw nothing ────────────────────────────────── */

/** Draw one document and return its markup, once the rows are on screen. */
async function draw(schema: Record<string, unknown>): Promise<string> {
  const { container } = render(<ObjectGridRenderer schema={schema} />);
  await screen.findByText('Alpha', {}, { timeout: 5000 });
  return container.innerHTML;
}

describe('the ruler', () => {
  it('two identical documents draw identical bytes', async () => {
    const a = await draw(grid(ROWS));
    cleanup();
    const b = await draw(grid(ROWS));
    expect(b).toBe(a);
  });

  it('LIT CONTROL — a key the renderer DOES read moves the bytes', async () => {
    const a = await draw(grid(ROWS));
    cleanup();
    const b = await draw(grid(ROWS, { description: 'GRID-HELP-11068' }));
    expect(b).not.toBe(a);
    expect(b).toContain('GRID-HELP-11068');
  });
});

describe('the five keys objectui#11068 retired change nothing the grid draws', () => {
  it.each([
    ['name', 'all_contacts'],
    ['placeholder', 'Nothing here yet'],
    ['rowSpecActions', ['edit', 'delete']],
    ['bulkSpecActions', ['delete']],
    // Retired after triage's retriage answer: the grid has no filter UI, so
    // neither value draws anything — the filter builder is `list-view`'s.
    ['showFilters', true],
    ['showFilters', false],
  ])('`%s` (%j)', async (key, value) => {
    const a = await draw(grid(ROWS));
    cleanup();
    const b = await draw(grid(ROWS, { [key]: value }));
    expect(b).toBe(a);
  });
});
