// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11601 — a spec-form field that declares `widget: 'ref:dataset'`
 * renders the dataset picker, and writes the dataset NAME.
 *
 * ## The defect
 *
 * `ref:dataset` is a declared hint — the spec's `reportForm` puts it on the
 * report's top-level `dataset` — but `WIDGETS` had no entry for it, so
 * `resolveFieldFace` sent it down the announced raw-JSON face: a JSON
 * `<textarea>` under "widget ref:dataset — falling back to JSON…". A joined
 * report's block row is about to declare the same hint (objectstack#21714),
 * and without a renderer that row would turn from free text into a JSON box.
 *
 * ## What this file pins
 *
 *  - with a dataset catalog on the host's `WidgetContext`, the picker renders
 *    and writes the picked dataset's name — in a SECTION, and in a REPEATER row
 *    under both layouts (grid cell and card row);
 *  - the options are `datasetPickerOptions`' author text (objectui#11161): the
 *    label beside the name, the description after ` — `;
 *  - with NO catalog — every host that does not feed one — the field degrades
 *    to a labelled text input that still writes the name, ⛔ never the raw-JSON
 *    face.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchemaForm } from './SchemaForm';
import type { WidgetContext } from './widgets';
import { loaded } from './loadState';
import { tFormat } from './i18n';
import type { DatasetCatalogEntry } from './previews/useDatasetCatalog';

afterEach(cleanup);

const CATALOG: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    description: 'Won and open deals by stage',
    dimensions: [],
    measures: [],
  },
  { name: 'support_load', label: 'support_load', dimensions: [], measures: [] },
];

/** The ONE text a select item renders for each catalog entry (objectui#11161). */
const SALES_OPTION = 'Sales metrics (sales_metrics) — Won and open deals by stage';
const SUPPORT_OPTION = 'support_load';

const WITH_CATALOG: WidgetContext = { conditionScope: 'none', datasets: loaded(CATALOG) };

/** The announced fallback the defect rendered in place of a picker. */
const RAW_JSON_NOTICE = tFormat('engine.form.fallbackJson', 'en-US', { widget: 'ref:dataset' });

type Layout = 'grid' | 'card';

function sectionForm() {
  return {
    type: 'simple',
    sections: [{ label: 'S', fields: [{ field: 'dataset', label: 'Dataset', widget: 'ref:dataset' }] }],
  } as never;
}

function sectionSchema() {
  return { type: 'object', properties: { dataset: { type: 'string' } } } as never;
}

/** A `blocks` repeater whose row declares the hint — the shape objectstack#21714 gives the joined-blocks row. */
function repeaterForm(layout: Layout) {
  return {
    type: 'simple',
    sections: [
      {
        label: 'S',
        fields: [
          {
            field: 'blocks',
            type: 'repeater',
            ...(layout === 'grid' ? { widget: 'grid' } : {}),
            fields: [
              { field: 'name', label: 'Name' },
              { field: 'dataset', label: 'Dataset', widget: 'ref:dataset', required: true },
            ],
          },
        ],
      },
    ],
  } as never;
}

function repeaterSchema() {
  return {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, dataset: { type: 'string' } },
          required: ['name'],
        },
      },
    },
  } as never;
}

function renderSection(ctx: WidgetContext | undefined, value: Record<string, unknown> = {}) {
  const onChange = vi.fn<(next: Record<string, unknown>) => void>();
  render(
    <SchemaForm schema={sectionSchema()} form={sectionForm()} value={value} widgetContext={ctx} onChange={onChange} />,
  );
  return onChange;
}

function renderRepeater(layout: Layout, ctx: WidgetContext | undefined) {
  const onChange = vi.fn<(next: Record<string, unknown>) => void>();
  render(
    <SchemaForm
      schema={repeaterSchema()}
      form={repeaterForm(layout)}
      value={{ blocks: [{ name: 'won_deals' }] }}
      widgetContext={ctx}
      onChange={onChange}
    />,
  );
  // The card layout keeps a row collapsed until it is opened.
  if (layout === 'card') fireEvent.click(screen.getByText(/#1/));
  return onChange;
}

/** Open the picker named `name`, pick `option`, and hand back what the form wrote. */
async function pick(name: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

/** The defect's face, read positively so a picker that renders nothing cannot pass. */
function expectNoRawJsonFace() {
  expect(screen.queryByText(RAW_JSON_NOTICE), 'the announced raw-JSON fallback is on screen').toBeNull();
  expect(document.querySelector('textarea'), 'a JSON textarea renders in place of the field').toBeNull();
}

describe('`ref:dataset` with a catalog — the dataset picker (objectui#11601)', () => {
  it('a SECTION field renders the picker and writes the dataset name', async () => {
    const onChange = renderSection(WITH_CATALOG);
    expectNoRawJsonFace();
    await pick('Dataset', SALES_OPTION);
    expect(onChange).toHaveBeenLastCalledWith({ dataset: 'sales_metrics' });
  });

  it('offers the catalog as the author text: label beside name, description after the dash; a label equal to the name reads once', async () => {
    renderSection(WITH_CATALOG);
    await userEvent.click(screen.getByRole('combobox', { name: 'Dataset' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual([SALES_OPTION, SUPPORT_OPTION]);
  });

  for (const layout of ['grid', 'card'] as const) {
    it(`a REPEATER row (${layout} layout) renders the picker and writes the dataset name into that row`, async () => {
      const onChange = renderRepeater(layout, WITH_CATALOG);
      expectNoRawJsonFace();
      await pick('Dataset', SALES_OPTION);
      expect(onChange).toHaveBeenLastCalledWith({ blocks: [{ name: 'won_deals', dataset: 'sales_metrics' }] });
    });
  }

  it('a stored dataset the catalog does not offer stays visible, flagged — never blanked', () => {
    renderSection(WITH_CATALOG, { dataset: 'retired_metrics' });
    expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveTextContent('retired_metrics (not found)');
  });
});

describe('`ref:dataset` with NO catalog — a labelled text input, ⛔ not the raw-JSON face (objectui#11601)', () => {
  it('a SECTION field degrades to a text input named by its label, and writes the typed name', () => {
    const onChange = renderSection(undefined, { dataset: 'sales_metrics' });
    expectNoRawJsonFace();
    const input = screen.getByRole('textbox', { name: 'Dataset' });
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveValue('sales_metrics');
    fireEvent.change(input, { target: { value: 'support_load' } });
    expect(onChange).toHaveBeenLastCalledWith({ dataset: 'support_load' });
  });

  it('a host that hands a WidgetContext without `datasets` gets the same degrade', () => {
    renderSection({ conditionScope: 'none' }, { dataset: 'sales_metrics' });
    expectNoRawJsonFace();
    expect(screen.getByRole('textbox', { name: 'Dataset' })).toHaveValue('sales_metrics');
  });

  for (const layout of ['grid', 'card'] as const) {
    it(`a REPEATER row (${layout} layout) degrades to a named text input and writes into that row`, () => {
      const onChange = renderRepeater(layout, undefined);
      expectNoRawJsonFace();
      const input = screen.getByRole('textbox', { name: 'Dataset' });
      expect(input.tagName).toBe('INPUT');
      fireEvent.change(input, { target: { value: 'sales_metrics' } });
      expect(onChange).toHaveBeenLastCalledWith({ blocks: [{ name: 'won_deals', dataset: 'sales_metrics' }] });
    });
  }
});
