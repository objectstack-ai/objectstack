// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `record:related_list` block inspector edits the props the spec's
 * `RecordRelatedListProps` declares for a related list: `columns` (the child
 * object's field names), `sort`, `filter` (the list toolbar's filter builder),
 * `limit`, `showViewAll` and `add`, beside `objectName` / `relationshipField` /
 * `title`.
 *
 * The REAL inspector, inside a host that applies every patch to the draft the
 * next render reads, as the page designer does. Every block it writes is judged
 * by the spec's own props row for the block, so a control that writes a shape
 * the spec refuses turns these rows red.
 *
 *  - columns / filter / limit round-trip: a stored list is shown in its
 *    editors, edited, and written back in the spec's shape;
 *  - the pickers read the CHILD object (`objectName`), not the page's object;
 *  - `showViewAll` shows the spec default (on) when the key is absent;
 *  - a stored value in the OTHER arm of a union (`sort` as a string, `columns`
 *    as `ListColumn` objects) is shown as JSON, never as an empty or
 *    `[object Object]` list that the next edit would overwrite.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';

// The builder lives inside a Radix popover, which does not open in jsdom; the
// popover parts render inline (this directory's existing way of reaching it).
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

const fieldsFor = vi.hoisted(() => vi.fn((_objectName: string | undefined) => undefined));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName: string | undefined) => {
    fieldsFor(objectName);
    return {
      fields: objectName === 'task'
        ? [
          { name: 'subject', label: 'Subject', type: 'text', hidden: false },
          { name: 'status', label: 'Status', type: 'text', hidden: false },
        ]
        : [],
      loading: false,
      error: null,
    };
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(() => {
  cleanup();
  fieldsFor.mockClear();
});

type Row = Record<string, unknown>;
const RelatedListProps = (ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }>)['record:related_list'];

function Host({ props, writes }: { props: Row; writes: Row[] }) {
  const [draft, setDraft] = React.useState<Row>({
    name: 'lead_page',
    type: 'record',
    object: 'lead',
    kind: 'full',
    regions: [{ name: 'main', components: [{ id: 'tasks', type: 'record:related_list', properties: props }] }],
  });
  return (
    <PageBlockInspector
      type="page"
      name="lead_page"
      draft={draft}
      selection={{ kind: 'block', id: 'regions[0].components[0]' }}
      onPatch={(patch: Row) => setDraft((d) => {
        const next = { ...d, ...patch };
        writes.push(((next.regions as any)[0].components[0].properties) as Row);
        return next;
      })}
      onClearSelection={() => {}}
      readOnly={false}
      locale="en-US"
    />
  );
}

const BASE = { objectName: 'task', relationshipField: 'lead' };

/** The JSON editor drawn under a curated label (the label is a sibling, not a `for`). */
function jsonEditorUnder(label: string): HTMLTextAreaElement {
  const heading = screen.getAllByText(label).find((el) => el.tagName === 'LABEL')!;
  const box = heading.parentElement!.querySelector('textarea');
  expect(box, `no JSON editor under '${label}'`).not.toBeNull();
  return box as HTMLTextAreaElement;
}

function expectSpecAccepts(props: Row) {
  const res = RelatedListProps.safeParse(props);
  expect(res.success, JSON.stringify(res.error?.issues)).toBe(true);
}

describe('record:related_list block inspector — columns, sort, filter, limit, showViewAll, add', () => {
  it('curates every related-list prop, and the pickers read the child object', () => {
    render(<Host props={BASE} writes={[]} />);
    for (const label of ['Columns', 'Sort', 'Filter', 'Limit', 'Show "View all"', 'Add existing records (picker)']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The column / sort / filter pickers ask for the child object's fields.
    expect(new Set(fieldsFor.mock.calls.map((c) => c[0]))).toContain('task');
  });

  it('round-trips columns, filter and limit in the spec shape', () => {
    const writes: Row[] = [];
    const stored = {
      ...BASE,
      columns: ['subject', 'status'],
      filter: [{ field: 'status', operator: 'equals', value: 'open' }],
      limit: 10,
    };
    render(<Host props={stored} writes={writes} />);
    // Read: the stored filter is the builder's row; no write on open.
    expect(screen.getByTestId('filter-builder-trigger')).toHaveTextContent('Status');
    expect(writes).toEqual([]);

    // Edit the limit: the other two props ride through unchanged.
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '25' } });
    fireEvent.blur(screen.getByLabelText('Limit'));
    let last = writes.at(-1)!;
    expect(last.limit).toBe(25);
    expect(last.columns).toEqual(stored.columns);
    expect(last.filter).toEqual(stored.filter);
    expectSpecAccepts(last);

    // Edit the filter through the builder: the rule is written in the stored shape.
    const value = screen.getAllByPlaceholderText('Value')[0] as HTMLInputElement;
    fireEvent.change(value, { target: { value: 'waiting' } });
    last = writes.at(-1)!;
    expect(last.filter).toEqual([{ field: 'status', operator: 'equals', value: 'waiting' }]);
    expectSpecAccepts(last);

    // Remove a column: the list keeps field names.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    last = writes.at(-1)!;
    expect(last.columns).toEqual(['status']);
    expectSpecAccepts(last);
  });

  it('authors a filter from nothing with the builder', () => {
    const writes: Row[] = [];
    render(<Host props={BASE} writes={writes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(writes).toEqual([]);
    fireEvent.change(screen.getAllByPlaceholderText('Value')[0], { target: { value: 'call' } });
    const last = writes.at(-1)!;
    expect(last.filter).toEqual([{ field: 'subject', operator: 'equals', value: 'call' }]);
    expectSpecAccepts(last);
  });

  it('shows showViewAll on when the key is absent (the spec default), and writes false when cleared', () => {
    const writes: Row[] = [];
    render(<Host props={BASE} writes={writes} />);
    const box = screen.getByRole('checkbox', { name: 'Show "View all"' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(writes.at(-1)!.showViewAll).toBe(false);
    expectSpecAccepts(writes.at(-1)!);
  });

  it('shows a stored sort row by row, and a string-arm sort as JSON rather than an empty list', () => {
    render(<Host props={{ ...BASE, sort: [{ field: 'subject', order: 'desc' }] }} writes={[]} />);
    expect(screen.getByText('Add sort field')).toBeInTheDocument();
    expect(screen.getAllByText('Order').length).toBeGreaterThan(0);
    cleanup();

    render(<Host props={{ ...BASE, sort: 'subject' }} writes={[]} />);
    expect(screen.queryByText('Add sort field')).toBeNull();
    expect(jsonEditorUnder('Sort').value).toBe('"subject"');
  });

  it('shows ListColumn-arm columns as JSON, never as `[object Object]` rows', () => {
    render(<Host props={{ ...BASE, columns: [{ field: 'subject', width: 200 }] }} writes={[]} />);
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(JSON.parse(jsonEditorUnder('Columns').value)).toEqual([{ field: 'subject', width: 200 }]);
  });
});
