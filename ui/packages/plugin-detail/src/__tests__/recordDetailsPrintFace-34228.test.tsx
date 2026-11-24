/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34228 — a `record:details` block on a print page, in a `zh-CN`
 * organization, as `service-print` puts it on paper.
 *
 *  - **Dates.** A `date` field authored `format: 'short'` (a quote's date and
 *    expiry) drew `11月 15, '26`: only the month was localized into the
 *    English compact layout. The display locale reaches the render
 *    (`useDisplayLocale`, the tenant's resolved locale), and the field now
 *    draws that locale's own face with the year, `2026年11月15日`, on screen
 *    and on paper alike. Control: `en` keeps `Nov 15, '26`.
 *  - **Select badges and lookup links print as plain text.** The page's print
 *    stylesheet carries the rules; this file pins that a rule of the stylesheet
 *    the page actually mounts reaches the real badge and the real link drawn
 *    by the field renderers. ⚠️ `@media print` does not apply under happy-dom,
 *    so the rules are matched by selector here and were measured on paper in
 *    Chromium for the pull request.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, RecordContextProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
// Module scope: importing the package index runs the registrations under test.
import '../index';
import '@object-ui/components';

const objectSchema = {
  name: 'crm_quote',
  label: 'Quote',
  fields: {
    quote_date: { name: 'quote_date', type: 'date', label: 'Quote Date', format: 'short' },
    status: { name: 'status', type: 'select', label: 'Status', options: [{ value: 'approved', label: '已批准', color: 'green' }] },
    crm_account: { name: 'crm_account', type: 'lookup', label: 'Account', reference: 'crm_account' },
  },
};

const record = {
  id: 'Q1',
  quote_date: '2026-11-15',
  status: 'approved',
  crm_account: { id: 'A1', name: '北京黑猫科技有限公司' },
};

const printPage = {
  type: 'record',
  name: 'quote_print_page',
  label: 'Quote',
  object: 'crm_quote',
  print: { paperSize: 'A4', margins: { left: 15, right: 15 } },
  regions: [
    {
      name: 'main',
      components: [
        { type: 'record:details', properties: { sections: [{ name: 'quote', label: 'Quote', fields: ['quote_date', 'status', 'crm_account'] }] } },
      ],
    },
  ],
};

function renderPrintPage(locale: string) {
  return render(
    <LocalizationProvider value={{ locale }}>
      <RelatedRecordActionsProvider value={{ recordHref: (o: string, id: string | number) => `/r/${o}/${id}` } as never}>
        <RecordContextProvider objectName="crm_quote" recordId="Q1" data={record} objectSchema={objectSchema as never}>
          <SchemaRenderer schema={printPage as never} />
        </RecordContextProvider>
      </RelatedRecordActionsProvider>
    </LocalizationProvider>,
  );
}

/** Whether `el` matches `selector`; a selector the DOM cannot parse matches nothing. */
function matchesSelector(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/** The bodies of the print-stylesheet rules whose selector matches `el`. */
function printRuleBodiesFor(container: HTMLElement, el: Element): string[] {
  const css = container.querySelector('style[data-print-stylesheet]')?.textContent ?? '';
  const bodies: string[] = [];
  for (const line of css.split('\n')) {
    const rule = /^\s*(.+?) \{ (.*) \}$/.exec(line);
    if (!rule || rule[1].startsWith('@')) continue;
    if (matchesSelector(el, rule[1])) bodies.push(rule[2]);
  }
  return bodies;
}

afterEach(() => cleanup());

describe('record:details on a zh-CN print page prints a document face (objectstack#34228)', () => {
  it("a `format: 'short'` date draws the locale's own face with the year", async () => {
    const { container } = renderPrintPage('zh-CN');
    await waitFor(() => expect(container.textContent).toContain('2026年11月15日'));
    expect(container.textContent).not.toContain("11月 15, '26");
  });

  it("CONTROL — under `en` the same field keeps the compact face `Nov 15, '26`", async () => {
    const { container } = renderPrintPage('en');
    await waitFor(() => expect(container.textContent).toContain("Nov 15, '26"));
  });

  it('a print-stylesheet rule reaches the select badge and prints it as plain text', async () => {
    const { container } = renderPrintPage('zh-CN');
    const badge = await waitFor(() => {
      const el = container.querySelector('[data-print-page] [title="已批准"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const bodies = printRuleBodiesFor(container, badge).join(' ');
    expect(bodies).toContain('background: none !important');
    expect(bodies).toContain('border-color: transparent !important');
    expect(bodies).toContain('color: inherit !important');
  });

  it('a print-stylesheet rule reaches the lookup link and prints it in the colour around it', async () => {
    const { container } = renderPrintPage('zh-CN');
    const link = await waitFor(() => {
      const el = container.querySelector('[data-print-page] a[href="/r/crm_account/A1"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const bodies = printRuleBodiesFor(container, link).join(' ');
    expect(bodies).toContain('color: inherit !important');
    expect(bodies).toContain('text-decoration: none !important');
  });
});
