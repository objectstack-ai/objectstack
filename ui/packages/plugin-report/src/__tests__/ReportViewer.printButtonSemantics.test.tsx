/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4462 — the report toolbar's Print button says what it does.
 *
 * ## Why this surface is the sharpest case of the defect
 *
 * `ReportViewer`'s toolbar puts Print immediately beside a **PDF** button that
 * really does export a PDF (`handleExport('pdf')` → `ReportExportEngine`).
 * Two adjacent controls, one of which produces a file and one of which opens
 * the browser's print dialog, both previously labelled with a bare noun. The
 * issue reports the predictable outcome: Print being accepted against an
 * "export to PDF" requirement. objectstack#1301 closed the real print/PDF
 * primitive NOT_PLANNED, so the fix is to make the two controls legible, not
 * to build a third thing.
 *
 * ## ⚠ What this file cannot assert
 *
 * Nothing here observes the printed PAGE — `@media print` never applies under
 * happy-dom (no layout engine, no media-type emulation). The shared stylesheet
 * that makes `window.print()` produce a usable page is pinned structurally in
 * `packages/app-shell/src/__tests__/print-stylesheet-4462.test.ts`, which
 * states the limitation in full. This file pins the DOM-observable half only.
 *
 * ## The i18n channel used here, and why it is not a defaults map
 *
 * `plugin-report` has no `createSafeTranslation` table; its existing channel is
 * `useSafeTranslate` from `@object-ui/i18n` (already used by
 * `DatasetReportRenderer.tsx`), a per-call hook that takes the English default
 * at the call site. So the sentence renders from the call-site fallback when no
 * `I18nProvider` is mounted — which is what these cases exercise — and from
 * `en.common.printDialogHint` when one is. Those two strings must stay
 * byte-identical; the case below asserts that directly against the pack rather
 * than trusting the duplication.
 *
 * ## Direction, predicted before running (#4118)
 *
 * Every case fails on `origin/main`: the button carries neither `title` nor
 * `aria-label` there, and `common.printDialogHint` exists in no pack.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { en } from '@object-ui/i18n';
import { ReportViewer } from '../ReportViewer';

const schema: any = {
  type: 'report-viewer',
  showToolbar: true,
  allowExport: true,
  allowPrint: true,
  data: [],
  report: {
    title: 'Pipeline by stage',
    description: 'Open opportunities',
    fields: [],
    sections: [],
    showExportButtons: true,
  },
};

/** The button whose only text node is "Print" (the "PDF" sibling is an export). */
function printButton(): HTMLElement {
  return screen.getByRole('button', { name: /print/i });
}

describe('ReportViewer — Print button semantics (objectui#4462)', () => {
  it('carries the print-dialog sentence as its tooltip', () => {
    render(<ReportViewer schema={schema} />);
    const btn = printButton();

    expect(btn).toHaveAttribute('title', en.common.printDialogHint);
    expect(btn.getAttribute('title')).not.toBe('common.printDialogHint');
  });

  it('names the disambiguation on its accessible name, not just the tooltip', () => {
    render(<ReportViewer schema={schema} />);
    const accessibleName = printButton().getAttribute('aria-label') ?? '';

    expect(accessibleName).toContain('Print');
    expect(accessibleName).toContain(en.common.printDialogHint);
  });

  it('says "browser" and "not a PDF export" — the two facts the issue is about', () => {
    // Pins MEANING: a tooltip reading "Print this report" would satisfy the
    // two cases above and leave the misreading untouched.
    const hint = en.common.printDialogHint;
    expect(hint.toLowerCase()).toContain('browser');
    expect(hint.toLowerCase()).toContain('print dialog');
    expect(hint.toLowerCase()).toContain('not a pdf export');
  });

  it('still opens the browser dialog — no removal, no headless gating', () => {
    const printSpy = vi.fn();
    Object.defineProperty(window, 'print', { value: printSpy, configurable: true });

    render(<ReportViewer schema={schema} />);
    fireEvent.click(printButton());

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('marks the button cluster — but not the report title — for the shared print sheet', () => {
    // The rule lives in `@object-ui/app-shell/styles.css`. Marking the whole
    // toolbar would take the report's own title and description off the paper,
    // since they share that row.
    const { container } = render(<ReportViewer schema={schema} />);

    const cluster = container.querySelector('[data-print-hide]');
    expect(cluster).not.toBeNull();
    expect(cluster).toContainElement(printButton());
    expect(cluster).not.toContainElement(screen.getByText('Pipeline by stage'));
  });
});
