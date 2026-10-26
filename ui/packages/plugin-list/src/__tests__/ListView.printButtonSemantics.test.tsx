/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4462 — the list toolbar's Print button says what it does.
 *
 * ## The defect
 *
 * The button was a bare `window.print()` with a bare "Print" label and no
 * tooltip. Acceptance testers at the reporting project read it as the
 * product's "export to PDF" entry point; in headless browsers and several
 * embedded WebViews `window.print()` is a silent no-op, so the same button
 * also reads as simply broken. The real print/PDF primitive was closed
 * NOT_PLANNED as objectstack#1301, so the fix is honesty, not a feature:
 * the control keeps working and now states that it opens the BROWSER's print
 * dialog and is not a PDF export.
 *
 * ## ⚠ What this file cannot assert
 *
 * Nothing here observes the printed PAGE. `@media print` does not apply under
 * happy-dom (no layout engine, no media emulation), so the shared print
 * stylesheet that makes the resulting page usable is pinned STRUCTURALLY, in
 * `packages/app-shell/src/__tests__/print-stylesheet-4462.test.ts`, and that
 * file states the same limitation at greater length. This file pins only what
 * a DOM assertion can actually see: the button carries the sentence, through
 * the i18n channel, on the accessible name and the tooltip.
 *
 * ## Path under test, and the one it does not cover
 *
 * Provider-less — no `I18nProvider` — which is `createSafeTranslation`'s
 * fallback path and therefore reads `LIST_DEFAULT_TRANSLATIONS`. The
 * provider-mounted path reads `en.common.printDialogHint`, and the two are
 * held byte-identical by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (#4401), so
 * asserting the map row here pins both without mounting `createI18n` — whose
 * registration as react-i18next's module-global default survives `cleanup()`
 * and would leak into the sibling cases (the reason
 * `ListView.overlayTitleI18n` and `…NoProviderFallback` are two files).
 *
 * ## Direction, predicted before running (#4118)
 *
 * All four cases fail on `origin/main`: the button has no `title` and no
 * `aria-label` there, and `LIST_DEFAULT_TRANSLATIONS` has no
 * `common.printDialogHint` row — so the accessible name is just "Print" and
 * the raw key would render if the row were dropped.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListView, LIST_DEFAULT_TRANSLATIONS } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const HINT_KEY = 'common.printDialogHint';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        clear: () => { store = {}; },
        removeItem: (k: string) => { delete store[k]; },
      };
    })(),
    configurable: true,
  });
});

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function renderList(schema: Partial<ListViewSchema>, ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{ type: 'list-view', objectName: 'proj', fields: ['name'], ...schema } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );
}

describe('ListView — Print button semantics (objectui#4462)', () => {
  it('carries the print-dialog sentence as its tooltip', async () => {
    const ds = makeDataSource();
    renderList({ allowPrinting: true } as any, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    const btn = screen.getByTestId('print-button');
    const hint = LIST_DEFAULT_TRANSLATIONS[HINT_KEY];

    expect(btn).toHaveAttribute('title', hint);
    // Not the raw key: a missing defaults-map row degrades to the key string,
    // which would satisfy a bare "has a title" assertion.
    expect(btn.getAttribute('title')).not.toBe(HINT_KEY);
  });

  it('names the disambiguation on its accessible name, not just the tooltip', async () => {
    // `title` alone is not exposed to every assistive technology, and it never
    // reaches touch users. The accessible name is the one channel that always
    // carries it.
    const ds = makeDataSource();
    renderList({ allowPrinting: true } as any, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    const btn = screen.getByTestId('print-button');
    const accessibleName = btn.getAttribute('aria-label') ?? '';

    expect(accessibleName).toContain(LIST_DEFAULT_TRANSLATIONS['list.print']);
    expect(accessibleName).toContain(LIST_DEFAULT_TRANSLATIONS[HINT_KEY]);
  });

  it('says "browser" and "not a PDF export" — the two facts the issue is about', () => {
    // Pins MEANING, not just presence: a tooltip reading "Print this view"
    // would pass both cases above and leave the misreading exactly where it
    // was. Case-insensitive substring, so wording may still be edited.
    const hint = LIST_DEFAULT_TRANSLATIONS[HINT_KEY];
    expect(hint).toBeTypeOf('string');
    expect(hint.toLowerCase()).toContain('browser');
    expect(hint.toLowerCase()).toContain('print dialog');
    expect(hint.toLowerCase()).toContain('not a pdf export');
  });

  it('still opens the browser dialog — no removal, no headless gating', async () => {
    // The ruling on #4462 forbids both alternatives the issue offered as
    // fallbacks. Clicking must still reach `window.print()`.
    const printSpy = vi.fn();
    Object.defineProperty(window, 'print', { value: printSpy, configurable: true });

    const ds = makeDataSource();
    renderList({ allowPrinting: true } as any, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('print-button'));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('marks the tool cluster for the shared print sheet to hide', async () => {
    // The rule lives in `@object-ui/app-shell/styles.css`; this is the marker
    // it selects on. The left half of the toolbar (view tabs, active filter
    // chips) is deliberately NOT marked — it says which slice of the data is
    // on the page.
    const ds = makeDataSource();
    const { container } = renderList({ allowPrinting: true } as any, ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    const cluster = container.querySelector('[data-print-hide]');
    expect(cluster).not.toBeNull();
    expect(cluster).toContainElement(screen.getByTestId('print-button'));
  });
});
