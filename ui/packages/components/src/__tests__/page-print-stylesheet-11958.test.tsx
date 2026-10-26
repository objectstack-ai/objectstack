/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11958 — a page that declares `print` renders its print stylesheet
 * (card ② of the ruling of record on objectstack#8346, letter B′).
 *
 * Two halves, each with its control:
 *
 *  - the stylesheet text, one rule per declared key, as each key's
 *    `.describe()` in `@objectstack/spec` names its print-CSS mapping, and the
 *    defaults the spec states for an omitted key;
 *  - the real render through `SchemaRenderer` and the registered `record`
 *    `PageRenderer`: a print page carries the scoping attribute, the
 *    stylesheet and the `PrintPageProvider`; the same page without `print`
 *    carries none of them, and apart from those two additions the two pages'
 *    DOM is byte-identical ("the page renders on screen exactly as before").
 *    The one DOM addition beyond them is the running-region table that
 *    `repeatHeader` / `repeatFooter` need (a real `thead` / `tfoot` is what the
 *    browser repeats); every box of it is `display: contents` on screen, so
 *    the regions keep the layout they had.
 *
 * ⚠️ `@media print` does not apply under happy-dom, so nothing here can show a
 * rule MATCHING on paper; that was measured once in Chromium for the pull
 * request (the reading is in its body), not pinned here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, usePrintPage } from '@object-ui/react';
import '../renderers';
import { buildPagePrintStylesheet, PRINT_PAGE_ATTRIBUTE, PRINT_RUNNING_ATTRIBUTE } from '../renderers/layout/page-print';

afterEach(() => cleanup());

describe('buildPagePrintStylesheet — one print-CSS rule per declared key (objectui#11958)', () => {
  it('every rule sits inside `@media print`, so the screen is untouched', () => {
    const css = buildPagePrintStylesheet({});
    expect(css.startsWith('@media print {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('`paperSize` / `orientation` → `@page { size }`, A4 portrait when omitted', () => {
    expect(buildPagePrintStylesheet({})).toContain('size: A4 portrait;');
    expect(buildPagePrintStylesheet({ paperSize: 'Letter', orientation: 'landscape' })).toContain('size: Letter landscape;');
  });

  it('`margins` → one `@page` margin descriptor per declared side, in millimetres', () => {
    const css = buildPagePrintStylesheet({ margins: { top: 20, left: 15.5 } });
    expect(css).toContain('margin-top: 20mm;');
    expect(css).toContain('margin-left: 15.5mm;');
    // A side left out keeps the console's default sheet margin.
    expect(css).not.toContain('margin-right:');
    expect(css).not.toContain('margin-bottom:');
  });

  it('only the spec’s own values reach the stylesheet (its injection boundary)', () => {
    const css = buildPagePrintStylesheet({
      paperSize: 'A4; } body { display: none' as never,
      margins: { top: '1mm; } x {' as never, right: -3, bottom: Number.NaN },
    });
    expect(css).toContain('size: A4 portrait;');
    expect(css).not.toContain('margin-top');
    expect(css).not.toContain('margin-right');
    expect(css).not.toContain('margin-bottom');
    expect(css).not.toContain('x {');
  });

  it('`pageNumbers` → the bottom-right `@page` margin box with counter(page) / counter(pages)', () => {
    expect(buildPagePrintStylesheet({ pageNumbers: true })).toContain('@bottom-right { content: counter(page) " / " counter(pages);');
    expect(buildPagePrintStylesheet({})).not.toContain('counter(page)');
  });

  it('`repeatHeader` / `repeatFooter` → the running-region table is a table on paper, its thead / tfoot repeating', () => {
    const table = `[${PRINT_PAGE_ATTRIBUTE}] table[${PRINT_RUNNING_ATTRIBUTE}]`;
    for (const css of [buildPagePrintStylesheet({ repeatHeader: true }), buildPagePrintStylesheet({ repeatFooter: true })]) {
      expect(css).toContain(`${table} { display: table !important;`);
      expect(css).toContain(`${table} > thead { display: table-header-group !important; }`);
      expect(css).toContain(`${table} > tfoot { display: table-footer-group !important; }`);
    }
    expect(buildPagePrintStylesheet({})).not.toContain(PRINT_RUNNING_ATTRIBUTE + ']) {');
    expect(buildPagePrintStylesheet({})).not.toContain(`${table} {`);
  });

  it('`repeatTableHeaders` → a table’s `thead` as a header group, on when omitted; `false` stops the repeat', () => {
    const thead = `[${PRINT_PAGE_ATTRIBUTE}] thead:not(table[${PRINT_RUNNING_ATTRIBUTE}] > thead)`;
    expect(buildPagePrintStylesheet({})).toContain(`${thead} { display: table-header-group !important; }`);
    expect(buildPagePrintStylesheet({ repeatTableHeaders: false })).toContain(`${thead} { display: table-row-group !important; }`);
  });

  it('`avoidBreakInside` → `break-inside: avoid` on every block of a region, off when omitted', () => {
    expect(buildPagePrintStylesheet({ avoidBreakInside: true })).toContain(`[${PRINT_PAGE_ATTRIBUTE}] [data-region] > * { break-inside: avoid; }`);
    expect(buildPagePrintStylesheet({})).not.toContain('break-inside');
  });

  it('only the print page reaches paper, and its ancestors stop clipping it to one screen', () => {
    const css = buildPagePrintStylesheet({});
    expect(css).toContain(`body :not(:has([${PRINT_PAGE_ATTRIBUTE}])):not([${PRINT_PAGE_ATTRIBUTE}]):not([${PRINT_PAGE_ATTRIBUTE}] *) { display: none !important; }`);
    expect(css).toContain(`:has([${PRINT_PAGE_ATTRIBUTE}]) {`);
    expect(css).toContain('overflow: visible !important;');
  });
});

const PRINT_PROBE = 'print-probe-11958';
ComponentRegistry.register(PRINT_PROBE, () => {
  const print = usePrintPage();
  return <span data-testid="print-probe">{print ? JSON.stringify(print) : 'none'}</span>;
});

const page = (print?: Record<string, unknown>) => ({
  type: 'record',
  name: 'invoice_print',
  label: 'Invoice',
  ...(print ? { print } : {}),
  regions: [
    { name: 'header', components: [{ type: 'text', value: 'ACME Ltd' }] },
    { name: 'main', components: [{ type: PRINT_PROBE }] },
    { name: 'footer', components: [{ type: 'text', value: 'Thank you' }] },
  ],
});

describe('PageRenderer — a page that declares `print` mounts its print stylesheet, and only then (objectui#11958)', () => {
  it('a print page carries the scoping attribute, the stylesheet and the declaration for its blocks', () => {
    const declaration = { paperSize: 'A5', repeatHeader: true } as const;
    const { container } = render(<SchemaRenderer schema={page(declaration) as never} />);
    const root = container.querySelector(`[${PRINT_PAGE_ATTRIBUTE}]`);
    expect(root).not.toBeNull();
    const style = root!.querySelector('style[data-print-stylesheet]');
    expect(style?.textContent).toBe(buildPagePrintStylesheet(declaration));
    expect(container.querySelector('[data-testid="print-probe"]')?.textContent).toBe(JSON.stringify(declaration));
  });

  it('CONTROL — the same page without `print` carries none of them', () => {
    const { container } = render(<SchemaRenderer schema={page() as never} />);
    expect(container.querySelector(`[${PRINT_PAGE_ATTRIBUTE}]`)).toBeNull();
    expect(container.querySelector('style[data-print-stylesheet]')).toBeNull();
    expect(container.querySelector('[data-testid="print-probe"]')?.textContent).toBe('none');
  });

  it('`repeatHeader` / `repeatFooter` put the header / footer region in a real thead / tfoot, drawn `display: contents` on screen', () => {
    const { container } = render(<SchemaRenderer schema={page({ repeatHeader: true, repeatFooter: true }) as never} />);
    const table = container.querySelector(`table[${PRINT_RUNNING_ATTRIBUTE}]`)!;
    expect(table).not.toBeNull();
    expect(table.querySelector(':scope > thead [data-region="header"]')).not.toBeNull();
    expect(table.querySelector(':scope > tfoot [data-region="footer"]')).not.toBeNull();
    expect(table.querySelector(':scope > tbody [data-region="main"]')).not.toBeNull();
    // Every table box is `contents` on screen, so the regions stay the layout's flex children.
    for (const el of [table, ...table.querySelectorAll(':scope > *, :scope > * > tr, :scope > * > tr > td')]) {
      expect(el.classList.contains('contents')).toBe(true);
    }
  });

  it('a region that is not repeated prints once, in the body of the running-region table', () => {
    const { container } = render(<SchemaRenderer schema={page({ repeatHeader: true }) as never} />);
    const table = container.querySelector(`table[${PRINT_RUNNING_ATTRIBUTE}]`)!;
    expect(table.querySelector(':scope > tfoot')).toBeNull();
    expect(table.querySelector(':scope > tbody [data-region="footer"]')).not.toBeNull();
  });

  it('CONTROL — a print page without running regions draws no running-region table', () => {
    const { container } = render(<SchemaRenderer schema={page({ paperSize: 'A4' }) as never} />);
    expect(container.querySelector(`table[${PRINT_RUNNING_ATTRIBUTE}]`)).toBeNull();
  });

  it('on screen a print page without running regions is the same page: only the attribute and the stylesheet are added', () => {
    const printed = render(<SchemaRenderer schema={page({ pageNumbers: true }) as never} />).container;
    printed.querySelector('style[data-print-stylesheet]')!.remove();
    printed.querySelector(`[${PRINT_PAGE_ATTRIBUTE}]`)!.removeAttribute(PRINT_PAGE_ATTRIBUTE);
    const probe = printed.querySelector('[data-testid="print-probe"]')!;
    probe.textContent = 'none';
    const plainHtml = render(<SchemaRenderer schema={page() as never} />).container.innerHTML;
    expect(printed.innerHTML).toBe(plainHtml);
  });
});
