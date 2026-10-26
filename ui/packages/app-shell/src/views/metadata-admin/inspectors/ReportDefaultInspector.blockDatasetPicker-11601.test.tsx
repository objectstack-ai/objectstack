// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11601 — the report inspector hands its dataset catalog to the spec
 * form, so a joined report's block row that DECLARES `widget: 'ref:dataset'`
 * offers the dataset picker and binds the block to a dataset name.
 *
 * ## Why the form is a fixture here
 *
 * The row spec is objectstack's (`reportForm`, the "Joined blocks" repeater),
 * and it is the one authority for which control a block's `dataset` gets: this
 * inspector does not override the row. The bundled `@objectstack/spec` row is
 * still `{ field: 'dataset', label: 'Dataset' }` — free text — until
 * objectstack#21714 declares the hint and objectstack's `.objectui-sha` pin
 * carries this change. So the fixture below is the bundled form with exactly
 * that declaration added, which is what this inspector will be handed then.
 *
 * ## What it pins
 *
 *  - the block row renders the picker over the inspector's catalog — the
 *    author's text, as the top-level picker reads it (objectui#11161);
 *  - picking writes the dataset NAME into that block, and nothing else moves.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';

type FormNode = { field?: unknown; fields?: unknown[] };
type FormShape = { sections?: Array<{ fields?: unknown[] }> };

/** The bundled `reportForm`, with the joined-blocks row's `dataset` declared the way objectstack#21714 declares it. */
function declareBlockDatasetPicker<T>(form: T): T {
  if (!form) return form;
  let declared = 0;
  const declare = (row: unknown): unknown => {
    const node = row as FormNode;
    if (typeof row !== 'object' || row === null || node.field !== 'dataset') return row;
    declared += 1;
    return { ...node, widget: 'ref:dataset', required: true };
  };
  const shape = form as unknown as FormShape;
  const sections = shape.sections?.map((section) => ({
    ...section,
    fields: section.fields?.map((field) => {
      const node = field as FormNode;
      if (typeof field !== 'object' || field === null || node.field !== 'blocks' || !Array.isArray(node.fields)) {
        return field;
      }
      return { ...node, fields: node.fields.map(declare) };
    }),
  }));
  // A fixture that silently stopped declaring anything would turn every pin
  // below into a reading of the free-text row.
  if (declared !== 1) throw new Error(`expected one joined-blocks dataset row, declared ${declared}`);
  return { ...shape, sections } as unknown as T;
}

vi.mock('../report-schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../report-schema.js')>();
  return { ...actual, getReportForm: () => declareBlockDatasetPicker(actual.getReportForm()) };
});

afterEach(cleanup);

// Same module-scope fetch double as `ReportDefaultInspector.test.tsx`
// (objectui#7439 / #6640): `useDatasetSemantics` fires a read no test awaits.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    description: 'Won and open deals by stage',
    dimensions: [{ name: 'stage', type: 'text' }],
    measures: [{ name: 'total_amount', aggregate: 'sum' }],
  },
  { name: 'support_load', label: 'Support load', dimensions: [], measures: [] },
];

const draft = {
  name: 'multi',
  label: 'Multi',
  type: 'joined',
  blocks: [{ name: 'won_deals' }],
};

function renderJoined() {
  const onPatch = vi.fn<(patch: Record<string, unknown>) => void>();
  render(
    <ReportDefaultInspector
      type="report"
      name="multi"
      locale="en-US"
      onSelectionChange={vi.fn()}
      datasetCatalogOverride={catalog}
      draft={draft}
      onPatch={onPatch}
      readOnly={false}
    />,
  );
  // The joined-blocks repeater is the card layout: open the one row.
  fireEvent.click(screen.getByText(/#1/));
  return onPatch;
}

describe('ReportDefaultInspector — a declared `ref:dataset` block row is the dataset picker (objectui#11601)', () => {
  it('offers the inspector catalog in the block row, as the author text', async () => {
    renderJoined();
    await userEvent.click(screen.getByRole('combobox', { name: 'Dataset' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual([
      'Sales metrics (sales_metrics) — Won and open deals by stage',
      'Support load (support_load)',
    ]);
  });

  it('picking a dataset binds THAT block to the dataset name, and nothing else moves', async () => {
    const onPatch = renderJoined();
    await userEvent.click(screen.getByRole('combobox', { name: 'Dataset' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Support load (support_load)' }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toStrictEqual({
      ...draft,
      blocks: [{ name: 'won_deals', dataset: 'support_load' }],
    });
  });
});
