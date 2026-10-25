/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4155 — a list emptied BY ITS OWN FILTER must not render the
 * first-run copy.
 *
 * The empty state already distinguished "filtered to empty" from "truly
 * empty", but it only counted SESSION filters: the search box, the user-filter
 * chips, and the filter panel's own conditions. The view's declared `filter`
 * was not counted, so a view returning nothing precisely because it is
 * filtered — `status not_in [archived, deleted]`, or a stale stored condition
 * — told the user "Nothing here yet / Create your first record" over an object
 * full of records.
 *
 * That is the misleading half of this issue: it reads as data loss or a
 * permission problem and sends triage away from the view layer. The copy is
 * the diagnosis the user gets, so the two cases must not share one string.
 *
 * SUITE DIRECTION, predicted before running: `a view filtered to empty says so`
 * is RED against `origin/main` (which renders the first-run copy) and green
 * after; the other two are green in both worlds — they pin that the fix does
 * not swallow the genuine first-run case or the author's own override.
 *
 * objectui#11687 — the second half: a view filter is not the USER's filter.
 * The "your current filters or search" message is said only when the user
 * applied one (search, user-filter chips, filter panel); a view emptied by its
 * own declared filter alone gets its own message (`list.viewFilterNoMatchesMessage`).
 * Measured on the console: Webhooks' Active view, zero rows, nothing applied.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

/** A data source that answers every query with zero rows. */
function emptyDataSource() {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

async function emptyState(
  schema: ListViewSchema,
  session: Pick<React.ComponentProps<typeof ListView>, 'initialFilters' | 'initialSearchTerm'> = {},
): Promise<HTMLElement> {
  const ds = emptyDataSource();
  const { container } = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} {...session} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const BASE: ListViewSchema = {
  type: 'list-view',
  objectName: 'work_order',
  fields: ['name'],
};

/**
 * A `list-view` node as an AUTHOR writes it, before `normalizeListViewSchema`
 * folds the legacy vocabulary onto the spec's (#2890).
 *
 * `ListViewSchema` describes the CANONICAL surface, so it types `filter` as the
 * spec's `ViewFilterRule[]` (`{ field, operator, value }` objects). What
 * objectui actually stores and passes to `$filter` is an ObjectQL FilterNode
 * array — `[['status', 'not_in', ['archived']]]`, the form used below and the
 * form the issue's repro carries. That divergence is stated outright in the
 * normalizer's own contract note ("the spec types `filter` as `ViewFilterRule[]`
 * … so objectui's field is typed from the spec but used as something else …
 * That mismatch is real and out of scope here"), and it is the reason these
 * fixtures cannot be re-spelled into the declared shape: re-spelling them would
 * stop testing the filter form the renderer actually receives.
 *
 * So the assertion is deliberately made about pre-normalization input, and the
 * cast says exactly that rather than widening `ListViewSchema` to admit both —
 * widening is what would re-fork the vocabulary #2890 unified. The legacy input
 * vocabulary has no declared type of its own today; filed as #4337.
 */
const authored = (node: Record<string, unknown>): ListViewSchema =>
  node as unknown as ListViewSchema;

describe('ListView empty state — a filtered view says it is filtered (#4155)', () => {
  it('a view filtered to empty says "no matching records", not "nothing here yet"', async () => {
    const panel = await emptyState(
      authored({
        ...BASE,
        // The source-declared filter from the issue's repro.
        filter: [['status', 'not_in', ['archived', 'deleted']]],
      }),
    );

    expect(panel.textContent).toMatch(/No matching records/i);
    expect(panel.textContent).not.toMatch(/Nothing here yet/i);
    expect(panel.textContent).not.toMatch(/Create your first record/i);
  });

  // objectui#11687 — the Webhooks "Active" view: its own filter, zero rows,
  // and no filter or search from the user.
  it('a view filtered to empty names the VIEW\'s filter, not "your current filters or search"', async () => {
    const panel = await emptyState(
      authored({ ...BASE, filter: [{ field: 'active', operator: 'equals', value: true }] }),
    );

    expect(panel.textContent).toContain('No records match this view’s filter.');
    expect(panel.textContent).not.toMatch(/your current filters or search/i);
    expect(panel.textContent).not.toMatch(/Create your first record/i);
  });

  it('a search the user typed still gets the "your current filters or search" copy', async () => {
    const panel = await emptyState(BASE, { initialSearchTerm: 'zzz' });

    expect(panel.textContent).toMatch(/No matching records/i);
    expect(panel.textContent).toMatch(/your current filters or search/i);
  });

  it('a filter the user applied over a filtered view is the user\'s, and says so', async () => {
    const panel = await emptyState(
      authored({ ...BASE, filter: [['status', 'not_in', ['archived']]] }),
      {
        initialFilters: {
          id: 'root',
          logic: 'and',
          conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'zzz' }],
        } as never,
      },
    );

    expect(panel.textContent).toMatch(/your current filters or search/i);
    expect(panel.textContent).not.toContain('No records match this view’s filter.');
  });

  it('a genuinely unfiltered empty list still invites the user to create', async () => {
    const panel = await emptyState(BASE);

    expect(panel.textContent).toMatch(/Nothing here yet/i);
    expect(panel.textContent).not.toMatch(/No matching records/i);
  });

  it('an empty filter array is not "filtered" — it imposes nothing', async () => {
    const panel = await emptyState({ ...BASE, filter: [] } as ListViewSchema);

    expect(panel.textContent).toMatch(/Nothing here yet/i);
  });

  it("the author's own emptyState copy still wins over both", async () => {
    const panel = await emptyState(
      authored({
        ...BASE,
        filter: [['status', 'not_in', ['archived']]],
        emptyState: { title: 'No open work orders', message: 'Dispatch one to get started.' },
      }),
    );

    expect(panel.textContent).toMatch(/No open work orders/);
    expect(panel.textContent).not.toMatch(/No matching records/i);
  });
});
