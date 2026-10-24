/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4757 — WHICH record a BULK action dialog's per-option `visibleWhen`
 * predicates are evaluated against.
 *
 * The same gap objectui#3765 closed for the single-record action dialog, at its
 * second landing site. objectui#3559 delivered the keys (a per-option
 * `visibleWhen` survives inheritance and reaches the control) and the shared
 * evaluator has always taken its record from `dependentValues` (it also spelled
 * a `?? ctx.formValues ?? ctx.data` tail, which no host could ever set and
 * objectui#7206 retired). What was missing here was the SUPPLY: `BulkActionDialog`'s `ParamField`
 * passed only `dataSource`, never `dependentValues`, so the values the user was
 * typing INTO THIS DIALOG could not narrow a sibling param's list however the
 * author wrote the predicate.
 *
 * Maintainer ruling of 2026-08-11 (Option B on objectui#3765): the dialog is a
 * small form, so its own in-progress values are that record, and the shared
 * evaluator is not modified. Bulk needed no separate ruling and gets none —
 * see `the SELECTION is never the record` below for why it is the cheap case:
 * an action over N selected rows has no single row record that the dialog's
 * values could be displacing.
 *
 * These four cases mirror `app-shell/src/views/ActionParamDialog.dialogRecord.test.tsx`
 * one-for-one, deliberately: the two dialogs feed one evaluator, and a shared
 * pin shape is how a future change to it shows up on both surfaces at once.
 * They drive the real `BulkActionDialog` rather than a widget wired to look
 * like one, because the wiring IS the change — only a real render can show a
 * keystroke in one param re-resolving another param's offered options.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { CASCADE_OPTION_WIDGET_TYPES } from '@object-ui/core';
// Module scope, per AGENTS.md §测试纪律: the dialog reaches its widgets through
// `getLazyFieldWidget` → `React.lazy(() => import('./widgets/RadioField'))`
// inside `@object-ui/fields`, and a first dynamic import() under a saturated
// transform pipeline can eat most of RTL's 1s `findBy` budget. This barrel
// STATICALLY re-exports those widget modules, so importing it puts them in the
// ESM cache and the lazy factories resolve in a microtask instead of racing the
// assertions below.
import '@object-ui/fields';

import { BulkActionDialog } from '../components/BulkActionDialog';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix Select probes pointer-capture APIs happy-dom lacks.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});

const COUNTRY = { name: 'country', label: 'Country', type: 'text' };

/** Province options gated on a SIBLING PARAM's value (`country`), not on scope. */
const PROVINCE = {
  name: 'province',
  label: 'Province',
  type: 'radio',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'Texas', value: 'tx', visibleWhen: "record.country == 'us'" },
  ],
};

function makeDataSource() {
  return { update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } as any;
}

function openDialog(
  params: Array<Record<string, unknown>>,
  opts: {
    /** The SELECTED rows. Never a predicate record — asserted, not assumed. */
    rows?: Array<Record<string, unknown>>;
    /** The host grid page's record, as the evaluator's fallback chain reads it. */
    hostFormValues?: Record<string, unknown>;
  } = {},
) {
  const def: any = { name: 'bulk_edit', label: 'Bulk edit', operation: 'update', params };
  const dialog = (
    <BulkActionDialog
      def={def}
      rows={opts.rows ?? [{ id: 'r1' }, { id: 'r2' }]}
      resource="account"
      dataSource={makeDataSource()}
      open
      onClose={() => {}}
    />
  );
  render(
    opts.hostFormValues
      // The host page's record, expressed the way the evaluator reads it: the
      // context type declares `dataSource` only, and `formValues` is the key
      // `useCascadingOptions` picks off it through an `any` cast.
      ? <SchemaRendererContext.Provider value={{ dataSource: null, formValues: opts.hostFormValues } as never}>
          {dialog}
        </SchemaRendererContext.Provider>
      : dialog,
  );
}

/** The dialog labels its controls `bulk-param-<name>`; type into one by id. */
const typeCountry = (value: string) => {
  const el = document.getElementById('bulk-param-country');
  expect(el).not.toBeNull();
  fireEvent.change(el as HTMLElement, { target: { value } });
};

describe('BulkActionDialog — the dialog IS the record for its option predicates (objectui#4757)', () => {
  it("narrows a param's options against a value typed into a SIBLING param", async () => {
    openDialog([COUNTRY, PROVINCE]);
    // Nothing typed yet: `record.country` is unresolvable, which fails OPEN, so
    // both provinces are offered. (Before this wiring the bulk dialog was stuck
    // here forever — typing had no way to reach the predicate.)
    expect(await screen.findByTestId('radio-option-zj')).toBeInTheDocument();
    expect(screen.getByTestId('radio-option-tx')).toBeInTheDocument();

    typeCountry('cn');

    // The keystroke re-resolved a DIFFERENT param's offered set: `zj` survives
    // its predicate, `tx` does not. This assertion is the whole issue.
    await waitFor(() => expect(screen.queryByTestId('radio-option-tx')).not.toBeInTheDocument());
    expect(screen.getByTestId('radio-option-zj')).toBeInTheDocument();

    // …and it tracks the value rather than latching on the first one seen.
    typeCountry('us');
    await waitFor(() => expect(screen.queryByTestId('radio-option-zj')).not.toBeInTheDocument());
    expect(screen.getByTestId('radio-option-tx')).toBeInTheDocument();
  });

  it('the SELECTION is never the record: the dialog values are the whole basis', async () => {
    // Why bulk needed no ruling of its own. Both other candidate records say
    // `country: 'us'` here — the N selected ROWS, and the host grid page's
    // `SchemaRendererContext` — and neither reaches the predicate: the list
    // falls open (Texas AND Zhejiang) instead of narrowing to Texas.
    //
    // The rows never could: a bulk action has no single row, `rows` is a
    // selection, and no per-row scope was ever offered to these predicates.
    // That is what makes Option B free on this surface — the dialog's values
    // are not displacing a row record, they are the only record there has ever
    // been. The page record IS displaced, which is Option B's ruled cost
    // (a supplied `dependentValues` wins `useCascadingOptions`' chain outright),
    // and it is asserted here rather than left for a reader to discover: under
    // the unruled option C (`{ ...pageRecord, ...dialogValues }`) the first two
    // assertions would read `tx` only, so this case is the executable
    // difference between the two readings.
    openDialog([COUNTRY, PROVINCE], {
      rows: [{ id: 'r1', country: 'us' }, { id: 'r2', country: 'us' }],
      hostFormValues: { country: 'us' },
    });
    expect(await screen.findByTestId('radio-option-zj')).toBeInTheDocument();
    expect(screen.getByTestId('radio-option-tx')).toBeInTheDocument();

    // And once the dialog HAS a value it is the only one that counts: `cn` wins
    // over the ambient `us`, the same direction a form field's own value wins
    // over anything ambient.
    typeCountry('cn');
    await waitFor(() => expect(screen.queryByTestId('radio-option-tx')).not.toBeInTheDocument());
    expect(screen.getByTestId('radio-option-zj')).toBeInTheDocument();
  });

  it('keeps an option whose predicate names a key NO param carries: fails OPEN', async () => {
    // The safety direction, unchanged by the wiring and pinned separately from
    // the cases above because it decides how bad a mistake here can be. An
    // unresolvable predicate OFFERS the option — the user can still complete
    // the action, and a wrong value earns a server rejection that carries a
    // message — instead of hiding it, which would leave an empty control with
    // nothing pointing at the predicate. Same direction the param-level
    // `visible` gate rules on this surface (objectui#4640).
    openDialog([
      COUNTRY,
      {
        name: 'province',
        label: 'Province',
        type: 'radio',
        options: [{ label: 'Zhejiang', value: 'zj', visibleWhen: "record.owner_id == 'u1'" }],
      },
    ]);
    expect(await screen.findByTestId('radio-option-zj')).toBeInTheDocument();

    typeCountry('cn');

    // Still unresolvable after a keystroke — `owner_id` is not a param, and the
    // selected rows do not supply one either — so the option stays offered
    // rather than vanishing as the user types.
    await waitFor(() =>
      expect(document.getElementById('bulk-param-country')).toHaveValue('cn'),
    );
    expect(screen.getByTestId('radio-option-zj')).toBeInTheDocument();
  });

  it('empties a select whose every option the in-progress values exclude', async () => {
    // The `select` widget's counterpart to the radio cases: when the dialog's
    // own values exclude the whole list there is no dropdown to offer, so the
    // widget renders its legible empty state (objectui#3231) keyed on the param
    // name — not a silently-empty Radix trigger.
    openDialog([
      COUNTRY,
      {
        name: 'region',
        label: 'Region',
        type: 'select',
        options: [{ label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" }],
      },
    ]);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();

    typeCountry('us');

    await waitFor(() => expect(screen.getByTestId('select-empty-region')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('BulkActionDialog — the allow-table is the SHARED object (objectui#4770)', () => {
  it('asks @object-ui/core CASCADE_OPTION_WIDGET_TYPES which params get the record', async () => {
    // Identity, not membership — the same pin the other two surfaces carry
    // (`app-shell/src/views/ActionParamDialog.dialogRecord.test.tsx`,
    // `components/src/renderers/form/__tests__/form-dependent-values.test.tsx`).
    // This file's four behavioural cases above pass against ANY set with these
    // four members, including a re-inlined private copy — which is precisely
    // the drift objectui#4770 removed and nothing could report. The spy is
    // installed on the Set object exported by `@object-ui/core`, so it records
    // a call only if this dialog consulted THAT object while rendering.
    const spy = vi.spyOn(CASCADE_OPTION_WIDGET_TYPES, 'has');
    try {
      openDialog([COUNTRY, PROVINCE]);
      expect(await screen.findByTestId('radio-option-zj')).toBeInTheDocument();
      expect(spy.mock.calls.map(([k]) => k)).toContain('radio');
    } finally {
      spy.mockRestore();
    }
  });
});
