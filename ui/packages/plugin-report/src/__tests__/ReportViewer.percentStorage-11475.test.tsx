/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11475 — the legacy `ReportViewer` draws a `type: 'percent'` report
 * column through the shared percent cell, and the cell reads storage from the
 * field it is handed: here, the report's own column (`ReportField`).
 *
 * That column declares no `max`, and the viewer does not hydrate it from the
 * bound object's field. So the column reads the spec's own answer for a
 * percent that declares nothing (`percentScaleOf`: a fraction). That is the
 * loss the changeset states for a legacy report over a whole-stored field.
 * Measured at `6007dd4e4`: no producer in objectui or objectstack writes a
 * `percent` column into a legacy report, and the pre-9.0 spec bridge
 * (`specReportToPresentation`) writes columns with no `type` at all.
 *
 * A column that does carry a `max` (a host that builds the column from the
 * field) is read at that storage.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ReportViewer } from '../ReportViewer';

registerAllFields();
afterEach(cleanup);

function renderViewer(columns: Array<Record<string, unknown>>, row: Record<string, unknown>) {
  const schema: any = {
    type: 'report-viewer',
    showToolbar: false,
    allowExport: false,
    allowPrint: false,
    data: [row],
    report: {
      title: 'T',
      fields: columns,
      sections: [{ type: 'table', title: 'Details', columns }],
    },
  };
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <ReportViewer schema={schema} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

function cells(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim());
}

describe("the legacy report's percent column reads the storage its column states (objectui#11475)", () => {
  it('a column declaring no `max` reads a fraction, the spec default: 1 is 100%, 0.25 is 25%', () => {
    const { container } = renderViewer(
      [
        { name: 'won', label: 'Won', type: 'percent' },
        { name: 'share', label: 'Share', type: 'percent' },
      ],
      { won: 1, share: 0.25 },
    );
    const texts = cells(container);
    expect(texts, `cells: ${JSON.stringify(texts)}`).toContain('100%');
    expect(texts).toContain('25%');
  });

  it('a column that states `max: 100` reads whole points: 50 is 50%', () => {
    const { container } = renderViewer([{ name: 'p', label: 'P', type: 'percent', max: 100 }], { p: 50 });
    const texts = cells(container);
    expect(texts, `cells: ${JSON.stringify(texts)}`).toContain('50%');
    expect(texts).not.toContain('5000%');
  });
});
