// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9931 — a `labelling: 'control'` widget keeps a labelable element on
 * its catalog-FAILURE arm, so the host's `<label for>` still resolves and the
 * field still has an accessible name.
 *
 * ## The defect
 *
 * `PickerLoadFailure` is a `div[role="status"]`. Four `'control'` widgets
 * rendered it INSTEAD of their picker when the option catalog failed to load,
 * so the `id` the host handed down landed nowhere: `FieldRow` emits
 * `<label for={id}>` for a `'control'` widget, and on that arm the `for`
 * DANGLED and the field had no accessible name — in the CARD layout too, where
 * the visible label is right there and points at nothing.
 *
 * ## What this file pins, and why in this order
 *
 *  1. the POPULATION is derived from `WIDGET_LABELLING` itself, ⛔ never from a
 *     list in prose: the case table must equal the set of keys the registry
 *     declares `'control'`, so a twelfth one cannot be added without a reading
 *     here;
 *  2. with EVERY catalog failed, each of those keys resolves its host label to
 *     a LABELABLE element carrying the field's accessible name — the assertion
 *     that goes RED on the defect. Asserted in BOTH layouts: the card row by
 *     `<label for>`, the grid cell by the column-header IDREF;
 *  3. ⭐ the ARM LEDGER, so (2) cannot be satisfied by deleting the failure
 *     arm instead of naming it: the `PickerLoadFailure` each key renders on a
 *     failed catalog is read OFF THE DOM and compared with what this file
 *     declares it shows. A widget that stops entering its failure arm goes red
 *     here even while (2) stays green;
 *  4. ⭐ the still-PASSING SUCCESS leg, in the same body: the same keys with
 *     every catalog LOADED keep the same name and show NO failure block.
 *     Without it, "the failure arm was fixed" and "the failure arm was switched
 *     off" are indistinguishable — the mistake this family's first card
 *     (objectui#9889) paid for, where the assertion that exposed the defect was
 *     deleted rather than satisfied.
 *
 * ## The two keys that are ⛔ NOT subjects — rejected on the record
 *
 * When this card landed, six of the declared `'control'` widgets had a
 * catalog-failure arm at all (the `banner` column below is the live reading);
 * two of them already kept a named control on it before this card, and this
 * file asserts they still do rather than treating them as defects:
 *
 *  - `ref:object` renders the banner BESIDE a freeform `<Input>` it keeps
 *    enabled, "so a failed catalog does not also block authoring";
 *  - `filter-builder` puts the failure INSIDE its popover, and the trigger
 *    `<Button>` that carries the naming renders in every arm — which is why its
 *    ledger row below is `null`: with the popover closed there is no banner in
 *    the document at all.
 *
 * That reading is the card's, re-derived here off `WIDGET_LABELLING` and off
 * the DOM, ⛔ not carried over as a claim.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaForm, type FormFieldSpec } from '../SchemaForm';
import {
  WIDGET_LABELLING,
  type RegisteredWidgetKey,
  type WidgetContext,
} from '../widgets';
import { failed, loaded } from '../loadState';
import { t } from '../i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The HTML elements a `<label for>` can actually address. */
const LABELABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'METER', 'OUTPUT', 'PROGRESS']);

/* `prettify('probe') === 'Probe'`, so `FieldRow` appends no machine-name
   `<code>` inside the label and the accessible name is the visible text alone.
   Same reason for the grid column's `trailing_stop` / "Trailing Stop" pair. */
const NAME = 'probe';
const HOST_ID = `mdf-${NAME}`;
const TITLE = 'Probe';
const SUB = 'trailing_stop';
const COLUMN = 'Trailing Stop';

/** The object `field-selector`'s raw `fetch` loader is pointed at. */
const OBJECT = 'showcase_account';

/**
 * Every "still asking" copy in this registry. A picker that is still LOADING
 * also renders a named control, so an assertion taken before the arm settles
 * would pass while measuring the wrong branch — `field-selector` is
 * genuinely asynchronous (a raw `fetch`, not a `WidgetContext` catalog).
 */
const STILL_LOADING = [
  t('engine.form.loadingObjects', 'en-US'),
  t('engine.form.loadingFields', 'en-US'),
  t('engine.form.loadingOptions', 'en-US'),
];

const FAILED_CTX: WidgetContext = {
  conditionScope: 'flattened',
  objectNames: failed('objects: HTTP 503'),
  objectFields: failed('fields: HTTP 503'),
  objectViews: failed('views: HTTP 503'),
  objectActions: failed('actions: HTTP 503'),
  datasets: failed('datasets: HTTP 503'),
};

const LOADED_CTX: WidgetContext = {
  conditionScope: 'flattened',
  objectNames: loaded(['account', 'contact']),
  objectFields: loaded([{ name: 'status', label: 'Status' }]),
  objectViews: loaded([{ name: 'account.all', label: 'All' }]),
  objectActions: loaded([{ name: 'approve' }]),
  datasets: loaded([{ name: 'sales_metrics', label: 'Sales metrics', dimensions: [], measures: [] }]),
};

interface ControlCase {
  key: RegisteredWidgetKey;
  /** JSON Schema for the probe field / grid column. */
  schema: Record<string, unknown>;
  /** Extra authoring keys the face needs. */
  spec?: Partial<FormFieldSpec>;
  /** The stored value, so every case renders with something to keep. */
  value: unknown;
  /** Sibling values a dependency reads — the same row object in the grid leg. */
  siblings?: Record<string, unknown>;
  /**
   * The `PickerLoadFailure` test id this widget shows when its catalogs have
   * failed, or `null` when it shows none in the document. Read off the DOM and
   * compared, so this column is a measurement and not a description.
   */
  banner: string | null;
}

/** One case per declared `'control'` key — checked against the registry below. */
const CASES: ControlCase[] = [
  { key: 'ref:object', schema: { type: 'string' }, value: 'account', banner: 'ref-object-load-failed' },
  { key: 'ref:component', schema: { type: 'string' }, value: 'c1', banner: null },
  { key: 'ref:dataset', schema: { type: 'string' }, value: 'sales_metrics', banner: 'ref-dataset-load-failed' },
  {
    key: 'object-selector',
    schema: { type: 'array' },
    spec: { multiple: true },
    value: ['account'],
    banner: 'object-selector-load-failed',
  },
  {
    key: 'field-selector',
    schema: { type: 'array' },
    spec: { multiple: true, dependsOn: 'objectName' },
    siblings: { objectName: OBJECT },
    value: ['status'],
    banner: 'field-selector-load-failed',
  },
  { key: 'field-ref', schema: { type: 'string' }, value: 'status', banner: 'field-ref-load-failed' },
  { key: 'view-ref', schema: { type: 'string' }, value: 'account.all', banner: 'view-ref-load-failed' },
  // The failure lives inside the popover, which is closed here; the trigger
  // that carries the naming renders on every arm.
  { key: 'filter-builder', schema: { type: 'array' }, value: [], banner: null },
  { key: 'icon', schema: { type: 'string' }, value: 'check', banner: null },
  { key: 'color-input', schema: { type: 'string' }, value: '#112233', banner: null },
  { key: 'string-tags', schema: { type: 'array', items: { type: 'string' } }, value: ['a'], banner: null },
  { key: 'secret', schema: { type: 'string' }, value: 's3cr3t', banner: null },
];

/**
 * `field-selector` is the one loader here that does not read a
 * `WidgetContext` catalog — it `fetch`es its own. Both modes are stubbed, so
 * the failed leg fails for a stated reason and the loaded leg is a real
 * completed load rather than an unresolved promise.
 */
function stubFetch(mode: 'failed' | 'loaded') {
  vi.stubGlobal(
    'fetch',
    mode === 'failed'
      ? vi.fn().mockRejectedValue(new Error('NetworkError: failed to fetch'))
      : vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ fields: [{ name: 'status', label: 'Status', type: 'text' }] }),
        } as unknown as Response),
  );
}

function renderCard(c: ControlCase, mode: 'failed' | 'loaded') {
  stubFetch(mode);
  const properties: Record<string, unknown> = { [NAME]: { ...c.schema, title: TITLE } };
  for (const k of Object.keys(c.siblings ?? {})) properties[k] = { type: 'string' };
  render(
    <SchemaForm
      schema={{ type: 'object', properties } as never}
      form={
        {
          type: 'simple',
          sections: [{ label: 'S', fields: [{ field: NAME, widget: c.key, ...c.spec }] }],
        } as never
      }
      value={{ [NAME]: c.value, ...(c.siblings ?? {}) }}
      widgetContext={mode === 'failed' ? FAILED_CTX : LOADED_CTX}
      onChange={() => {}}
    />,
  );
}

function renderGrid(c: ControlCase, mode: 'failed' | 'loaded') {
  stubFetch(mode);
  const rowProperties: Record<string, unknown> = { [SUB]: c.schema };
  for (const k of Object.keys(c.siblings ?? {})) rowProperties[k] = { type: 'string' };
  render(
    <SchemaForm
      schema={
        {
          type: 'object',
          properties: {
            rows: { type: 'array', title: 'Rows', items: { type: 'object', properties: rowProperties } },
          },
        } as never
      }
      form={
        {
          type: 'simple',
          sections: [
            {
              label: 'S',
              fields: [
                {
                  field: 'rows',
                  type: 'repeater',
                  widget: 'grid',
                  fields: [{ field: SUB, label: COLUMN, widget: c.key, ...c.spec }],
                },
              ],
            },
          ],
        } as never
      }
      value={{ rows: [{ [SUB]: c.value, ...(c.siblings ?? {}) }] }}
      widgetContext={mode === 'failed' ? FAILED_CTX : LOADED_CTX}
      onChange={() => {}}
    />,
  );
}

/** The `PickerLoadFailure` currently in the document, as its test id. */
function observedBanner(): string | null {
  const el = document.querySelector('[role="status"][data-testid$="-load-failed"]');
  return el ? el.getAttribute('data-testid') : null;
}

/** Block until no arm is still rendering its "asking" copy. */
async function settle() {
  await waitFor(() => {
    for (const copy of STILL_LOADING) expect(screen.queryByDisplayValue(copy)).toBeNull();
  });
}

describe('#9931 — the case table IS the registry', () => {
  it('covers exactly the keys declared `control`, no more and no fewer', () => {
    const declared = Object.entries(WIDGET_LABELLING)
      .filter(([, v]) => v === 'control')
      .map(([k]) => k)
      .sort();
    expect(CASES.map((c) => c.key).sort()).toEqual(declared);
    // The other half of the registry, so a mass re-declaration to `'group'`
    // cannot empty this file's subject and still read as green.
    expect(
      declared.length + Object.values(WIDGET_LABELLING).filter((v) => v === 'group').length,
    ).toBe(Object.keys(WIDGET_LABELLING).length);
  });
});

describe('#9931 — a FAILED catalog: the card row keeps a resolving `<label for>`', () => {
  for (const c of CASES) {
    it(`\`${c.key}\` — the host label names a labelable element on the failure arm`, async () => {
      renderCard(c, 'failed');
      await settle();

      // The arm is genuinely the failed one — ⛔ not a widget that quietly
      // stopped rendering a failure state to satisfy the assertions below.
      expect(
        observedBanner(),
        `${c.key}: the failure block in the document is not the one this arm declares`,
      ).toBe(c.banner);

      const label = screen.getByText(TITLE);
      expect(label.tagName).toBe('LABEL');
      expect(label).toHaveAttribute('for', HOST_ID);

      const target = document.getElementById(HOST_ID);
      expect(
        target,
        `${c.key}: the host id is on NO element — the visible label's \`for\` dangles`,
      ).not.toBeNull();
      expect(
        LABELABLE.has(target!.tagName),
        `${c.key}: the host id landed on <${target!.tagName.toLowerCase()}>, which no <label for> can address`,
      ).toBe(true);
      expect(target).toHaveAccessibleName(TITLE);
    });
  }
});

describe('#9931 — a FAILED catalog: the grid cell is still named by its column', () => {
  for (const c of CASES) {
    it(`\`${c.key}\` — the cell control answers the column-header IDREF`, async () => {
      renderGrid(c, 'failed');
      await settle();

      expect(observedBanner(), `${c.key}: unexpected failure block in the grid cell`).toBe(c.banner);

      const cell = document.querySelector('tbody td');
      expect(cell, `${c.key}: the grid layout rendered no data cell at all`).not.toBeNull();

      // The cell id and the IDREF sit on the SAME element (`controlNaming`),
      // so the element carrying the id is the one that must be named.
      const named = cell!.querySelector(`[id$="${SUB}"]`);
      expect(named, `${c.key}: no element in the cell carries the cell id`).not.toBeNull();
      expect(
        LABELABLE.has(named!.tagName),
        `${c.key}: the cell id landed on <${named!.tagName.toLowerCase()}>`,
      ).toBe(true);

      const ref = named!.getAttribute('aria-labelledby');
      expect(ref, `${c.key}: the named control dropped the column-header IDREF`).not.toBeNull();
      const header = document.getElementById(ref!);
      expect(header, `${c.key}: aria-labelledby="${ref}" resolves to nothing`).not.toBeNull();
      expect(header!.tagName).toBe('TH');
      expect(named).toHaveAccessibleName(COLUMN);
    });
  }
});

describe('#9931 — ⭐ the SUCCESS leg, unchanged: a LOADED catalog still names the same way', () => {
  for (const c of CASES) {
    it(`\`${c.key}\` — named by its label, and no failure block anywhere`, async () => {
      renderCard(c, 'loaded');
      await settle();

      // This is what stops the failed-catalog assertions being satisfiable by
      // switching the failure arm off: the completed load still renders its
      // own picker, and it renders no failure state at all.
      expect(observedBanner(), `${c.key}: a completed load rendered a failure block`).toBeNull();

      const label = screen.getByText(TITLE);
      expect(label).toHaveAttribute('for', HOST_ID);
      const target = document.getElementById(HOST_ID);
      expect(target, `${c.key}: the host id is on no element on the LOADED arm`).not.toBeNull();
      expect(LABELABLE.has(target!.tagName)).toBe(true);
      expect(target).toHaveAccessibleName(TITLE);
      // One label, one channel — a host that HAS a label sends no IDREF.
      expect(target).not.toHaveAttribute('aria-labelledby');
    });
  }
});
