/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34228 — the print stylesheet puts a record page on paper as a
 * document: a data table fits the printable width, and the page prints on
 * white with links and select badges as plain text.
 *
 * Measured in Chromium (A4 portrait, 15 mm side margins) before the change: a
 * five-column `record:line_items` grid was 647 px wide in its 630 px box, its
 * last column under the box's right border; the page and its ancestors
 * printed the app's grey; a lookup printed in the link colour and a select as
 * a coloured pill. The readings are in the pull request.
 *
 * Two halves here, as in `page-print-stylesheet-11958.test.tsx`: the rules'
 * text, every one inside `@media print` and scoped to the print page, and the
 * rules' selectors against a real render — the fit rule reaches a data table
 * on the page and never the running-region table. ⚠️ `@media print` does not
 * apply under happy-dom, so nothing here shows a rule taking effect on paper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import '../renderers';
// `PageRenderer` reaches `react-page.tsx`, which loads this dynamically: pay the load at collection.
import '@object-ui/react-runtime';
import {
  buildPagePrintStylesheet,
  PRINT_PAGE_ATTRIBUTE,
  PRINT_PLAIN_BADGE_ATTRIBUTE,
  PRINT_RUNNING_ATTRIBUTE,
} from '../renderers/layout/page-print';

afterEach(() => cleanup());

const PAGE = `[${PRINT_PAGE_ATTRIBUTE}]`;

/** Each rule of the sheet as `[selector, body]`, the `@page` rule left out. */
function rulesOf(css: string): Array<[string, string]> {
  const rules: Array<[string, string]> = [];
  for (const line of css.split('\n')) {
    const rule = /^\s*(.+?) \{ (.*) \}$/.exec(line);
    if (rule && !rule[1].startsWith('@')) rules.push([rule[1], rule[2]]);
  }
  return rules;
}

describe('the print stylesheet fits a data table to the printable width (objectstack#34228)', () => {
  it('drops the cells’ screen minimum width and single line, and holds the table to the box', () => {
    const css = buildPagePrintStylesheet({});
    const table = `${PAGE} table:not([${PRINT_RUNNING_ATTRIBUTE}])`;
    expect(css).toContain(`${table} { width: 100% !important; }`);
    expect(css).toContain(`${table} :is(th, td) { min-width: 0 !important; white-space: normal !important;`);
  });

  it('every declaration shape carries the rules, whatever `print` declares', () => {
    for (const print of [{}, { avoidBreakInside: true }, { repeatHeader: true, repeatFooter: true }]) {
      expect(buildPagePrintStylesheet(print)).toContain(`${PAGE} table:not([${PRINT_RUNNING_ATTRIBUTE}]) { width: 100% !important; }`);
    }
  });
});

describe('the print stylesheet prints the page on white, links and select badges as plain text (objectstack#34228)', () => {
  it('the page and every box around it print on white', () => {
    expect(buildPagePrintStylesheet({})).toContain(`:has(${PAGE}), ${PAGE} { background: #fff !important; }`);
  });

  it('a link prints in the colour around it, with no underline', () => {
    expect(buildPagePrintStylesheet({})).toContain(`${PAGE} a[href] { color: inherit !important; text-decoration: none !important; }`);
  });

  it('a select badge prints as its label: no fill, no border colour, no padding, no pill', () => {
    const [, body] = rulesOf(buildPagePrintStylesheet({})).find(([sel]) => sel === `${PAGE} [${PRINT_PLAIN_BADGE_ATTRIBUTE}]`)!;
    for (const declaration of [
      'background: none !important',
      'border-color: transparent !important',
      'color: inherit !important',
      'padding: 0 !important',
      'border-radius: 0 !important',
    ]) {
      expect(body).toContain(declaration);
    }
  });

  it('every rule sits inside `@media print` and names the print page, so the screen and every other page are untouched', () => {
    const css = buildPagePrintStylesheet({ avoidBreakInside: true, repeatHeader: true });
    expect(css.startsWith('@media print {')).toBe(true);
    const rules = rulesOf(css);
    expect(rules.length).toBeGreaterThan(0);
    for (const [selector] of rules) {
      expect(selector, selector).toContain(PAGE);
    }
  });
});

const page = (print: Record<string, unknown>) => ({
  type: 'record',
  name: 'invoice_print',
  label: 'Invoice',
  print,
  regions: [
    { name: 'header', components: [{ type: 'text', value: 'ACME Ltd' }] },
    {
      name: 'main',
      components: [
        {
          type: 'table',
          columns: [{ header: 'Product', accessorKey: 'p' }, { header: 'Total', accessorKey: 't' }],
          data: [{ p: 'Widget', t: '12,345,678.90' }],
        },
      ],
    },
  ],
});

describe('the fit rule’s selectors against a real print page (objectstack#34228)', () => {
  it('reach a data table on the page and its cells, and never the running-region table', () => {
    const declaration = { repeatHeader: true };
    const { container } = render(<SchemaRenderer schema={page(declaration) as never} />);
    const [[tableSelector], [cellSelector]] = rulesOf(buildPagePrintStylesheet(declaration)).filter(([sel]) => sel.includes('table:not('));
    const running = container.querySelector(`table[${PRINT_RUNNING_ATTRIBUTE}]`)!;
    const data = [...container.querySelectorAll('table')].find((t) => t !== running)!;
    expect(running).not.toBeNull();
    expect(data).toBeDefined();
    expect(data.matches(tableSelector)).toBe(true);
    expect(data.querySelector('td')!.matches(cellSelector)).toBe(true);
    expect(data.querySelector('th')!.matches(cellSelector)).toBe(true);
    // CONTROL — the running-region table lays out regions, and keeps its own layout.
    expect(running.matches(tableSelector)).toBe(false);
    expect(running.querySelector(':scope > thead > tr > td')!.matches(cellSelector)).toBe(false);
  });
});
