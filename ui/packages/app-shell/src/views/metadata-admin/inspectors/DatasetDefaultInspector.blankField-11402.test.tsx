// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11402 — a blank Field box writes no `field` key.
 *
 * The dataset inspector used to seed every new row with `field: ''`, so a
 * Studio author who added a plain row-count measure and left the Field box
 * blank saved `field: ''`. The spec has one spelling for "no field" on a
 * measure — the key is ABSENT (`DatasetMeasureSchema.field` is optional, and
 * only `count` may omit it) — and a dimension's `field` is required, so an
 * empty string is a value no reader can use: the analytics door answered 500
 * on the ObjectQL strategy for a `count` measure with `field: ''`, and the
 * narrowed spec (objectstack-ai/objectstack#21240) refuses it at save.
 *
 * The rulings this file pins (triage on objectui#11402):
 *   - new rows are seeded without a `field` key;
 *   - a measure with a blank Field box writes no `field`;
 *   - a dimension with a blank Field box shows as incomplete and is not saved
 *     with `''` — it is reported on the inspector's blocking-issue channel, the
 *     one the host's Save gate already reads (objectui#4527 / objectui#6900);
 *   - no `id` default is written on the author's behalf.
 *
 * The "saved" body below is the draft as the host holds it — patches merged
 * shallowly, exactly as `ResourceEditPage` applies `onPatch` — sent through a
 * JSON round trip, because the `dataset` type declares no `fromDraft`
 * serialiser, so that draft IS the body the save sends.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DatasetSchema } from '@objectstack/spec/ui';

// Stub the catalog hooks so the inspector renders without a MetadataClient /
// network — the sibling suites' stubs, plus two catalog fields to pick from.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({
    relationships: [],
    fieldOptions: [
      { value: 'region', label: 'Region', type: 'text' },
      { value: 'amount', label: 'Amount', type: 'currency' },
    ],
    loading: false,
  }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector, writeRowField } from './DatasetDefaultInspector';

afterEach(cleanup);

type Draft = Record<string, unknown> & {
  dimensions?: Array<Record<string, unknown>>;
  measures?: Array<Record<string, unknown>>;
};

const BASE: Draft = { name: 'sales', label: 'Sales', object: 'opportunity', dimensions: [], measures: [] };

/** A host that holds the draft and merges each patch the way `ResourceEditPage` does. */
function mountHost(initial: Draft) {
  const seen: { draft: Draft; blocking: number[] } = { draft: initial, blocking: [] };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    seen.draft = draft;
    return (
      <DatasetDefaultInspector
        type="dataset"
        name="sales"
        locale="en-US"
        readOnly={false}
        draft={draft}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onBlockingIssuesChange={(count) => seen.blocking.push(count)}
      />
    );
  }
  render(<Host />);
  return seen;
}

/** The body the save sends: the held draft through the JSON wire. */
const savedBody = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft));

async function pickSelectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

async function pickComboOption(label: string, value: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  // By the option's value (cmdk's `data-value`), not by where its text starts:
  // a labelled option leads with its label (objectui#12303).
  const item = screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === value);
  expect(item, `the catalog option ${value}`).toBeTruthy();
  fireEvent.click(item!);
}

describe('DatasetDefaultInspector — new rows carry no `field` key (objectui#11402)', () => {
  it('seeds a new measure row with no `field` key', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector type="dataset" name="sales" locale="en-US" readOnly={false} draft={BASE} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('Add measure'));
    // `toStrictEqual`, not `toEqual`: a key present with the value `undefined`
    // must fail here too — the row has to be built without it.
    expect(onPatch.mock.calls[0][0].measures[0]).toStrictEqual({ name: '', aggregate: 'sum' });
  });

  it('seeds a new dimension row with no `field` key — and no `id` default either', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector type="dataset" name="sales" locale="en-US" readOnly={false} draft={BASE} onPatch={onPatch} />);
    fireEvent.click(screen.getByText('Add dimension'));
    expect(onPatch.mock.calls[0][0].dimensions[0]).toStrictEqual({ name: '', type: 'string' });
  });
});

describe('DatasetDefaultInspector — a blank Field box on a measure writes no `field` (objectui#11402)', () => {
  it('⭐ a measure added and saved with a blank Field box carries no `field`, and the saved dataset parses under DatasetSchema', async () => {
    const seen = mountHost(BASE);
    fireEvent.click(screen.getByText('Add measure'));
    fireEvent.change(screen.getByPlaceholderText('e.g. revenue'), { target: { value: 'row_count' } });
    await pickSelectOption('Aggregate', 'count');

    const held = seen.draft.measures![0];
    expect(Object.hasOwn(held, 'field'), 'the held row has no `field` key at all').toBe(false);
    const body = savedBody(seen.draft);
    expect(body.measures![0]).toStrictEqual({ name: 'row_count', aggregate: 'count' });

    const parsed = DatasetSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // Control: the same parse refuses a field-less NON-count measure, so the
    // green above is a verdict the schema could have withheld.
    const control = DatasetSchema.safeParse({ ...body, measures: [{ name: 'row_count', aggregate: 'sum' }] });
    expect(control.success).toBe(false);
  });

  it('a field-less measure is not held: only the dimension side is incomplete without a field', () => {
    const seen = mountHost({
      ...BASE,
      dimensions: [{ name: 'region', field: 'region', type: 'string' }],
      measures: [{ name: 'row_count', aggregate: 'count' }],
    });
    expect(seen.blocking.at(-1)).toBe(0);
  });

  it('a cleared Field value is written as an absent key, never as `\'\'`', () => {
    // Typed as the inspector's own row shape: a field-less literal shares no
    // key with `{ field?: string }`, so left to inference it reads as a weak
    // type and `tsc -p tsconfig.test.json` refuses its other keys.
    type Row = { name: string; aggregate: string; field?: string };
    const filled: Row = { name: 'n', aggregate: 'sum', field: 'amount' };
    const fieldless: Row = { name: 'n', aggregate: 'sum' };
    expect(writeRowField(filled, '')).toStrictEqual({ name: 'n', aggregate: 'sum' });
    expect(writeRowField(filled, '   ')).toStrictEqual({ name: 'n', aggregate: 'sum' });
    expect(writeRowField(fieldless, 'amount')).toStrictEqual({ name: 'n', aggregate: 'sum', field: 'amount' });
  });
});

describe('DatasetDefaultInspector — a blank-Field dimension is held as incomplete (objectui#11402)', () => {
  it('⭐ a dimension added with a blank Field box is reported to the Save gate until a field is picked', async () => {
    const seen = mountHost(BASE);
    expect(seen.blocking.at(-1), 'nothing to hold before the row exists').toBe(0);

    fireEvent.click(screen.getByText('Add dimension'));
    expect(seen.blocking.at(-1), 'the field-less dimension is a blocking issue').toBe(1);
    expect(Object.hasOwn(seen.draft.dimensions![0], 'field'), 'and it is not held as `field: \'\'`').toBe(false);
    // Shown as incomplete: while the box is blank, the Field label carries the
    // designer's required marker (objectui#10948) — the spec requires a
    // dimension's field.
    const markerOnFieldLabel = () => screen.getByText('Field').closest('label')?.querySelector('[data-required-marker="true"]');
    expect(markerOnFieldLabel(), 'the required marker on the blank Field label').toBeTruthy();

    await pickComboOption('Field', 'region');
    expect(seen.draft.dimensions![0]).toMatchObject({ name: 'region', field: 'region', type: 'string' });
    expect(seen.blocking.at(-1), 'a picked field releases the hold').toBe(0);
    expect(markerOnFieldLabel(), 'a complete row shows the plain label').toBeFalsy();
  });

  it('the hold is never stricter than the spec: DatasetSchema refuses the field-less dimension it holds, and takes it once a field is picked', () => {
    // The host keeps a verdict the server also returns advisory, because a
    // client gate STRICTER than the server would wedge Save on a body the
    // server takes (`ResourceEditPage`, the note above `blockingReport`). This
    // hold is safe on that count only while the spec itself refuses a
    // dimension without a `field` — if `DatasetDimensionSchema.field` ever
    // turns optional, this goes red and the hold has to be revisited. (A
    // stored `field: ''` is the one row it holds that this spec still takes:
    // that one is ruled — not saved with `''` — and the Field box on screen
    // repairs it, so it cannot wedge.)
    const held = DatasetSchema.safeParse({ ...BASE, dimensions: [{ name: 'region', type: 'string' }] });
    expect(held.success).toBe(false);
    expect(held.error?.issues.map((i) => i.path.join('.'))).toContain('dimensions.0.field');
    const picked = DatasetSchema.safeParse({ ...BASE, dimensions: [{ name: 'region', field: 'region', type: 'string' }] });
    expect(picked.success, JSON.stringify(picked.error?.issues)).toBe(true);
  });

  it('a stored dimension whose field is `\'\'` is held too, so it is not saved again as `\'\'`', () => {
    const seen = mountHost({ ...BASE, dimensions: [{ name: 'region', field: '', type: 'string' }] });
    expect(seen.blocking.at(-1)).toBe(1);
  });

  it('counts each incomplete dimension once', () => {
    const seen = mountHost({
      ...BASE,
      dimensions: [
        { name: 'a', type: 'string' },
        { name: 'b', field: 'region', type: 'string' },
        { name: 'c', field: '', type: 'string' },
      ],
    });
    expect(seen.blocking.at(-1)).toBe(2);
  });
});
