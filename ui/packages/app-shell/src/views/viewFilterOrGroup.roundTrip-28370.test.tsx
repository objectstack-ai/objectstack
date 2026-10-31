// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28370 — the filter builder SAVES an OR group as one any-of group
 * element, `{ or: [rule, ...] }` (`ViewFilterOrGroupSchema`), and READS a
 * stored group back as the OR group it was.
 *
 * The fold used to refuse an OR group (`or_logic`): a flat rule list had no OR
 * spelling. Pinned here:
 *
 *  - fold → spec → read: the folded body is accepted by `ListViewSchema`, and
 *    `toFilterGroup` (over `parseSpecFilter`) reads it back as an OR group that folds
 *    to the same body;
 *  - the Studio `filter-builder` widget shows a stored group as an OR group,
 *    writes an OR toggle as one group, and shows a group beside other
 *    conditions read-only, so no save can drop part of it;
 *  - the view-override recovery pass (`sanitizeViewOverride`) keeps a group
 *    instead of dropping it as an entry with no `field`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListViewSchema } from '@objectstack/spec/ui';
import { toFilterGroup } from '@object-ui/plugin-view';
import { foldFilterGroupToSpecRules } from './viewFilterFold';
import { sanitizeViewOverride } from './objectViewTabs';
import { WIDGETS } from './metadata-admin/widgets';
import { loaded } from './metadata-admin/loadState';

// The builder lives inside a Radix popover, which does not open in jsdom; the
// popover parts render inline, as in `widgets.filterBuilderHeldRow-26738.test.tsx`.
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

afterEach(cleanup);

const OPEN = { field: 'status', operator: 'equals', value: 'open' };
const DRAFT = { field: 'title', operator: 'equals', value: 'draft' };
const OR_GROUP = { or: [OPEN, DRAFT] };

const viewBody = (filter: unknown) => ({ name: 'default', label: 'All', type: 'grid', columns: ['title'], filter });

describe('an OR group folds to one { or } element and reads back as an OR group (objectstack#28370)', () => {
  const builderGroup = {
    id: 'root',
    logic: 'or',
    conditions: [
      { id: 'a', ...OPEN },
      { id: 'b', ...DRAFT },
    ],
  };

  it('the fold writes one any-of group, which ListViewSchema accepts', () => {
    const folded = foldFilterGroupToSpecRules(builderGroup);
    expect(folded).toEqual({ ok: true, rules: [OR_GROUP] });
    const parsed = ListViewSchema.safeParse(viewBody(folded.ok ? folded.rules : undefined));
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });

  it('toFilterGroup reads the stored group back as an OR group of its rules', () => {
    const parsed = toFilterGroup([OR_GROUP]);
    expect(parsed.logic).toBe('or');
    expect(parsed.conditions.map(({ field, operator, value }) => ({ field, operator, value }))).toEqual([OPEN, DRAFT]);
  });

  it('round trip: what the builder reads back folds to the body that was stored', () => {
    const stored = foldFilterGroupToSpecRules(builderGroup);
    expect(stored.ok).toBe(true);
    const reread = toFilterGroup(stored.ok ? stored.rules : []);
    expect(reread.logic).toBe('or');
    expect(foldFilterGroupToSpecRules(reread)).toEqual(stored);
  });

  it('CONTROL: an AND group still folds flat and reads back as AND', () => {
    const folded = foldFilterGroupToSpecRules({ ...builderGroup, logic: 'and' });
    expect(folded).toEqual({ ok: true, rules: [OPEN, DRAFT] });
    expect(toFilterGroup([OPEN, DRAFT]).logic).toBe('and');
  });
});

type Elements = unknown[];
const FilterWidget = WIDGETS['filter-builder'];
const FIELDS = loaded([
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'status', label: 'Status', type: 'text' },
  { name: 'owner', label: 'Owner', type: 'text' },
]);

function Host({ initial, writes }: { initial?: Elements; writes: Array<Elements | undefined> }) {
  const [filter, setFilter] = React.useState<Elements | undefined>(initial);
  return (
    <>
      <FilterWidget
        schema={{}}
        value={filter}
        context={{ conditionScope: 'none', objectFields: FIELDS }}
        onChange={(next) => {
          writes.push(next as Elements | undefined);
          setFilter(next as Elements | undefined);
        }}
      />
      <pre data-testid="stored-filter">{JSON.stringify(filter ?? null)}</pre>
    </>
  );
}

const storedFilter = () => JSON.parse(screen.getByTestId('stored-filter').textContent ?? 'null');
const valueInputs = () => screen.queryAllByPlaceholderText('Value') as HTMLInputElement[];

describe('the Studio filter-builder widget reads and writes an OR group (objectstack#28370)', () => {
  it('a stored group shows as an OR group of its rows, and an edit writes the group back', () => {
    const writes: Array<Elements | undefined> = [];
    render(<Host initial={[OR_GROUP]} writes={writes} />);

    expect(valueInputs().map((input) => input.value)).toEqual(['open', 'draft']);
    expect(screen.getByTestId('filter-logic-toggle')).toHaveTextContent('OR');
    expect(screen.getByTestId('filter-builder-trigger')).toHaveTextContent('Status, Title');
    expect(screen.getByTestId('filter-builder-trigger')).toBeEnabled();
    expect(writes).toEqual([]);

    fireEvent.change(valueInputs()[1], { target: { value: 'final' } });
    expect(writes.at(-1)).toEqual([{ or: [OPEN, { ...DRAFT, value: 'final' }] }]);
  });

  it('switching a stored AND list to OR writes one group, and back to AND writes it flat', () => {
    const writes: Array<Elements | undefined> = [];
    render(<Host initial={[OPEN, DRAFT]} writes={writes} />);
    expect(screen.getByTestId('filter-logic-toggle')).toHaveTextContent('AND');

    fireEvent.click(screen.getByTestId('filter-logic-toggle'));
    expect(storedFilter()).toEqual([OR_GROUP]);

    fireEvent.click(screen.getByTestId('filter-logic-toggle'));
    expect(storedFilter()).toEqual([OPEN, DRAFT]);
  });

  it('a group beside another condition is shown read-only, never loaded into the one-level builder', () => {
    const writes: Array<Elements | undefined> = [];
    const mixed = [OR_GROUP, { field: 'owner', operator: 'equals', value: 'u1' }];
    render(<Host initial={mixed} writes={writes} />);

    const trigger = screen.getByTestId('filter-builder-trigger');
    expect(trigger).toBeDisabled();
    // The reason, through the console packs (no provider here, so the key).
    expect(trigger.getAttribute('title')).toBe('console.objectView.filterOrGroupNotEditable');
    // Every field the list holds is named, the group's members included.
    expect(trigger).toHaveTextContent('Status, Title, Owner');
    expect(writes).toEqual([]);
    expect(storedFilter()).toEqual(mixed);
  });
});

describe('sanitizeViewOverride keeps an OR group (objectstack#28370)', () => {
  it('a complete group is kept as stored', () => {
    const override = { id: 'v', filter: [OR_GROUP] };
    expect(sanitizeViewOverride(override)).toBe(override);
  });

  it('an unfinished member leaves the group, and the rest of the group stays', () => {
    const unfinished = { field: 'title', operator: 'equals', value: '' };
    expect(sanitizeViewOverride({ id: 'v', filter: [{ or: [OPEN, unfinished] }] }))
      .toEqual({ id: 'v', filter: [{ or: [OPEN] }] });
  });

  it('a group with no finished member carries no condition, so the source filter wins again', () => {
    const unfinished = { field: 'title', operator: 'equals', value: '' };
    expect(sanitizeViewOverride({ id: 'v', filter: [{ or: [unfinished] }] })).toEqual({ id: 'v' });
  });
});
