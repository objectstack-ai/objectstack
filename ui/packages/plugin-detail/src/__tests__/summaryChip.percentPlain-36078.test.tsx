/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36078: the `summaryFields` chip beside the record H1 honours a
 * percent field's `percentDisplay` (`@objectstack/spec`, `FieldSchema`):
 * `plain` states the percentage alone and draws no bar, for a `percent` field
 * and for a `formula` whose `returnType` is `percent`. The key is read off the
 * chip's merged field bag, view entry over object schema. Absent or `bar`
 * keeps the bar (CONTROL).
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   percent field, plain                       RED   (bar drawn)
 *   percent formula, plain                     RED   (bar drawn)
 *   object-schema plain, no view entry         RED   (bar drawn)
 *   control: absent / bar, field and formula   GREEN (bar drawn)
 *   control: view `bar` over object `plain`    GREEN (bar drawn)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DetailView } from '../DetailView';
import type { DetailViewSchema, FieldMetadata } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; served from a double so no case here
 * depends on the network (the stub `summaryChip.currencyMode-10422` uses).
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/**
 * Renders a page whose summary chips are `kpi`, stored as `0.4`, and
 * `region`, the ARRIVAL PROBE: it has no view entry, so its accessible name
 * reads `Region: EMEA` only once the object schema below has landed.
 */
function renderPage(
  viewField: Record<string, unknown> | null,
  objectSchema?: Record<string, unknown>,
): HTMLElement {
  const dataSource = objectSchema
    ? ({ getObjectSchema: async () => objectSchema } as any)
    : undefined;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en', currency: 'USD' }}>
        <DetailView
          dataSource={dataSource}
          schema={
            {
              type: 'record:details',
              objectName: 'opportunity',
              summaryFields: ['kpi', 'region'],
              fields: viewField ? [{ name: 'kpi', label: 'Probability', ...viewField } as FieldMetadata] : [],
              data: { id: 'O1', name: 'Acme renewal', kpi: 0.4, region: 'EMEA' },
            } as unknown as DetailViewSchema
          }
        />
      </LocalizationProvider>
    </I18nProvider>,
  ).container;
}

const requireChip = (c: HTMLElement, field = 'kpi'): HTMLElement => {
  const chip = c.querySelector<HTMLElement>(`[data-summary-chip="${field}"]`);
  expect(chip, `a summary chip for "${field}" is beside the H1`).not.toBeNull();
  return chip!;
};

const OBJECT_PLAIN = {
  fields: {
    kpi: { type: 'percent', label: 'Probability', percentDisplay: 'plain' },
    region: { type: 'text', label: 'Region' },
  },
};

const objectSchemaArrived = (c: HTMLElement) =>
  waitFor(() =>
    expect(requireChip(c, 'region'), 'CONTROL: the object schema arrived').toHaveAccessibleName('Region: EMEA'),
  );

const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The chip's bar FILL — the inner span of its decorative track — or null. */
const barFill = (chip: HTMLElement) => chip.querySelector<HTMLElement>('span[aria-hidden] > span');

/** The chip reads `40%` as text alone: no bar track, no fill. */
function expectPlain(chip: HTMLElement) {
  expect(textOf(chip)).toBe('40%');
  expect(chip).toHaveAccessibleName('Probability: 40%');
  expect(chip.querySelector('span[aria-hidden]'), 'no bar track in a plain chip').toBeNull();
}

/** The chip reads `40%` beside a bar filled to 40%. */
function expectBar(chip: HTMLElement) {
  expect(textOf(chip)).toBe('40%');
  expect(barFill(chip), 'the chip draws its bar').not.toBeNull();
  expect(barFill(chip)!.style.width).toBe('40%');
}

const percentFormula = (extra: Record<string, unknown> = {}) => ({
  type: 'formula',
  returnType: 'percent',
  expression: 'record.a',
  ...extra,
});

describe('the summary chip honours percentDisplay: plain (objectstack#36078)', () => {
  it('a percent field set to plain reads 40% with no bar', () => {
    expectPlain(requireChip(renderPage({ type: 'percent', percentDisplay: 'plain' })));
  });

  it('a formula whose returnType is percent, set to plain, reads 40% with no bar', () => {
    expectPlain(requireChip(renderPage(percentFormula({ percentDisplay: 'plain' }))));
  });

  it('plain declared on the object schema alone (no view entry) is read too', async () => {
    const container = renderPage(null, OBJECT_PLAIN);
    await objectSchemaArrived(container);
    expectPlain(requireChip(container));
  });

  it('CONTROL: a percent field with no percentDisplay draws the bar', () => {
    expectBar(requireChip(renderPage({ type: 'percent' })));
  });

  it('CONTROL: a percent field set to bar draws the bar', () => {
    expectBar(requireChip(renderPage({ type: 'percent', percentDisplay: 'bar' })));
  });

  it('CONTROL: a percent formula with no percentDisplay, and one set to bar, draws the bar', () => {
    expectBar(requireChip(renderPage(percentFormula())));
    cleanup();
    expectBar(requireChip(renderPage(percentFormula({ percentDisplay: 'bar' }))));
  });

  it('CONTROL: a view entry set to bar wins over an object schema set to plain', async () => {
    const container = renderPage({ type: 'percent', percentDisplay: 'bar' }, OBJECT_PLAIN);
    await objectSchemaArrived(container);
    expectBar(requireChip(container));
  });
});
