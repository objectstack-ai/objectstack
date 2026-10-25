/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * App pages lay a region's blocks on a 12-column grid, and the page
 * description sits under its title (objectui#12624).
 *
 * The span is derived from the block's kind (`page-block-span.ts`) and folded
 * by breakpoint with Tailwind's `md` (768px) and `xl` (1280px) variants. A
 * DOM test has no stylesheet, so the row arithmetic below reads the span the
 * cell's REAL classes give at a viewport width, by the breakpoint rule those
 * variants compile to (`min-width`); the browser screenshots on the pull
 * request show the same classes laid out.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers PageRenderer, `page:header` and
// `statistic` (AGENTS.md §测试纪律).
import '../renderers';
import { pageBlockSpan, isPageRailRegion, PAGE_BLOCK_SPANS } from '../renderers/layout/page-block-span';

/** Tailwind's default breakpoints the span classes use. */
const BREAKPOINTS: Array<[prefix: string, minWidth: number]> = [
  ['xl:', 1280],
  ['lg:', 1024],
  ['md:', 768],
  ['sm:', 640],
  ['', 0],
];

/** The `col-span-N` a cell's classes resolve to at a viewport width. */
function activeSpan(cell: Element, width: number): number {
  const classes = Array.from(cell.classList);
  for (const [prefix, min] of BREAKPOINTS) {
    if (width < min) continue;
    const hit = classes.find((c) => c.startsWith(`${prefix}col-span-`) && !c.slice(prefix.length).includes(':'));
    if (hit) return Number(hit.slice(`${prefix}col-span-`.length));
  }
  throw new Error(`no col-span class on ${cell.outerHTML}`);
}

/** How many grid rows the cells fill at a width, packing spans into 12. */
function rowsAt(cells: Element[], width: number): number {
  let rows = 0;
  let used = 12;
  for (const cell of cells) {
    const span = activeSpan(cell, width);
    if (used + span > 12) {
      rows += 1;
      used = 0;
    }
    used += span;
  }
  return rows;
}

function tile(id: string) {
  return { type: 'statistic', id, label: id, value: 1 } as any;
}

function renderPage(schema: any) {
  return render(
    <ActionProvider>
      <SchemaRenderer schema={schema} />
    </ActionProvider>,
  );
}

function regionCells(container: HTMLElement, name: string): Element[] {
  const region = container.querySelector(`[data-region="${name}"]`);
  expect(region).not.toBeNull();
  return Array.from(region!.children);
}

describe('a region lays its blocks on a 12-column grid (objectui#12624)', () => {
  const kpiPage = {
    type: 'app',
    pageType: 'app',
    name: 'kpi_page',
    label: 'Sales Dashboard',
    regions: [{ name: 'main', components: [tile('revenue'), tile('won'), tile('pipeline'), tile('leads')] }],
  } as any;

  it('four metric tiles fill one row at 1280px and two rows at 1024px', () => {
    const { container } = renderPage(kpiPage);
    const region = container.querySelector('[data-region="main"]')!;
    expect(region.classList.contains('grid')).toBe(true);
    expect(region.classList.contains('grid-cols-12')).toBe(true);

    const cells = regionCells(container, 'main');
    expect(cells).toHaveLength(4);
    for (const cell of cells) expect(cell.getAttribute('data-block-span')).toBe('3');

    expect(rowsAt(cells, 1280)).toBe(1);
    expect(rowsAt(cells, 1024)).toBe(2);
    // Under 768px every block takes the full width.
    expect(rowsAt(cells, 390)).toBe(4);
  });

  it('a block whose kind the table does not name takes 12', () => {
    expect(PAGE_BLOCK_SPANS.has('element:text')).toBe(false);
    expect(pageBlockSpan('element:text')).toBe(12);
    expect(pageBlockSpan('no-such-block')).toBe(12);
    expect(pageBlockSpan(undefined)).toBe(12);

    const { container } = renderPage({
      ...kpiPage,
      regions: [{ name: 'main', components: [{ type: 'element:text', properties: { content: 'Hello' } }, tile('won')] }],
    });
    const [text, metric] = regionCells(container, 'main');
    expect(text.getAttribute('data-block-span')).toBe('12');
    expect(activeSpan(text, 1280)).toBe(12);
    expect(activeSpan(metric, 1280)).toBe(3);
  });

  it('a chart takes 6 from 1280px and 12 below', () => {
    expect(pageBlockSpan('object-chart')).toBe(6);
    const { container } = renderPage({
      ...kpiPage,
      regions: [{ name: 'main', components: [{ type: 'chart', id: 'c1' }, { type: 'chart', id: 'c2' }] }],
    });
    const cells = regionCells(container, 'main');
    expect(cells.map((c) => c.getAttribute('data-block-span'))).toEqual(['6', '6']);
    expect(rowsAt(cells, 1280)).toBe(1);
    expect(rowsAt(cells, 1024)).toBe(2);
  });

  it('a rail region (sidebar / aside) keeps every block full width', () => {
    const { container } = renderPage({
      ...kpiPage,
      template: 'three-column',
      regions: [
        { name: 'sidebar', components: [tile('a')] },
        { name: 'main', components: [tile('b')] },
        { name: 'aside', components: [tile('c')] },
      ],
    });
    expect(regionCells(container, 'sidebar')[0].getAttribute('data-block-span')).toBe('12');
    expect(regionCells(container, 'aside')[0].getAttribute('data-block-span')).toBe('12');
    expect(regionCells(container, 'main')[0].getAttribute('data-block-span')).toBe('3');
    // The designer's rail answer agrees with the slots the renderer placed.
    expect(isPageRailRegion('sidebar', 'three-column')).toBe(true);
    expect(isPageRailRegion('aside', 'three-column')).toBe(true);
    expect(isPageRailRegion('main', 'three-column')).toBe(false);
  });

  it('on the dashboard template each region is a grid cell that holds its own block grid', () => {
    const { container } = renderPage({
      ...kpiPage,
      template: 'dashboard',
      regions: [
        { name: 'sidebar', components: [tile('a'), tile('b')] },
        { name: 'main', components: [tile('c')] },
      ],
    });
    const cellsGrid = container.querySelector('[data-template="dashboard"] .md\\:grid-cols-2')!;
    expect(cellsGrid).not.toBeNull();
    const regions = Array.from(cellsGrid.children);
    expect(regions.map((r) => r.getAttribute('data-region'))).toEqual(['sidebar', 'main']);
    for (const r of regions) expect(r.classList.contains('grid-cols-12')).toBe(true);
    // No rail on this template: the sidebar's tiles keep their kind's span.
    expect(regionCells(container, 'sidebar')[0].getAttribute('data-block-span')).toBe('3');
    expect(isPageRailRegion('sidebar', 'dashboard')).toBe(false);
  });

  it('a hidden block leaves an empty cell that the grid does not draw', () => {
    const { container } = renderPage({
      ...kpiPage,
      regions: [{ name: 'main', components: [{ ...tile('gone'), hidden: true }, tile('kept')] }],
    });
    const [gone] = regionCells(container, 'main');
    expect(gone.childNodes).toHaveLength(0);
    expect(gone.classList.contains('empty:hidden')).toBe(true);
  });
});

describe('page:card and page:section lay their children on the same grid (objectui#12624)', () => {
  const metric = (id: string) => ({ type: 'object-metric', id, properties: { objectName: 'opportunity' } });
  const four = () => [metric('revenue'), metric('won'), metric('pipeline'), metric('leads')];

  function pageWith(container: Record<string, unknown>, regionName = 'main', template?: string) {
    return {
      type: 'app',
      pageType: 'app',
      name: 'sales_home_page',
      label: 'Sales Home',
      ...(template ? { template } : {}),
      regions: [{ name: regionName, components: [container] }],
    } as any;
  }

  /** The cells of the block grid a container draws its children on. */
  function containerCells(container: HTMLElement, selector: string): Element[] {
    const host = container.querySelector(selector);
    expect(host).not.toBeNull();
    const grid = host!.querySelector('.grid-cols-12');
    expect(grid).not.toBeNull();
    return Array.from(grid!.children);
  }

  it('a page:card holding four object-metric tiles (the HotCRM Sales Home shape) fills one row at 1280px and two at 1024px', () => {
    const { container } = renderPage(
      pageWith({ type: 'page:card', id: 'kpis', properties: { title: 'Key Performance Indicators', children: four() } }),
    );
    // The card itself is one region block, spanning 12 by its own kind.
    const [cardCell] = regionCells(container, 'main');
    expect(cardCell.getAttribute('data-block-span')).toBe('12');

    const cells = Array.from(cardCell.querySelector('.grid-cols-12')!.children);
    expect(cells).toHaveLength(4);
    for (const cell of cells) expect(cell.getAttribute('data-block-span')).toBe('3');
    expect(rowsAt(cells, 1280)).toBe(1);
    expect(rowsAt(cells, 1024)).toBe(2);
    expect(rowsAt(cells, 390)).toBe(4);
  });

  it('a page:section does the same', () => {
    const { container } = renderPage(pageWith({ type: 'page:section', id: 'kpis', properties: { children: four() } }));
    const cells = containerCells(container, 'section');
    expect(cells.map((c) => c.getAttribute('data-block-span'))).toEqual(['3', '3', '3', '3']);
    expect(rowsAt(cells, 1280)).toBe(1);
    expect(rowsAt(cells, 1024)).toBe(2);
  });

  it('a container whose children are not tiles still stacks them full width', () => {
    const { container } = renderPage(
      pageWith({
        type: 'page:card',
        id: 'notes',
        properties: {
          title: 'Notes',
          children: [
            { type: 'element:text', properties: { content: 'one' } },
            { type: 'element:text', properties: { content: 'two' } },
          ],
        },
      }),
    );
    const [cardCell] = regionCells(container, 'main');
    const cells = Array.from(cardCell.querySelector('.grid-cols-12')!.children);
    expect(cells.map((c) => c.getAttribute('data-block-span'))).toEqual(['12', '12']);
    expect(rowsAt(cells, 1280)).toBe(2);
  });

  it('a container in a rail region keeps its tiles full width', () => {
    const { container } = renderPage(
      pageWith({ type: 'page:card', id: 'kpis', properties: { title: 'KPIs', children: four() } }, 'sidebar', 'three-column'),
    );
    const [cardCell] = regionCells(container, 'sidebar');
    const cells = Array.from(cardCell.querySelector('.grid-cols-12')!.children);
    expect(cells.map((c) => c.getAttribute('data-block-span'))).toEqual(['12', '12', '12', '12']);
  });
});

describe('the page description sits under its title (objectui#12624)', () => {
  const DESCRIPTION = 'Sales team home page with key metrics';

  function headerPage() {
    return {
      type: 'app',
      pageType: 'app',
      name: 'sales_home_page',
      label: 'Sales Home',
      description: DESCRIPTION,
      regions: [
        {
          name: 'header',
          components: [{ type: 'page:header', properties: { title: 'Sales Dashboard', subtitle: 'Welcome back' } }],
        },
        { name: 'main', components: [tile('revenue')] },
      ],
    } as any;
  }

  it('a titled page:header draws the description after the title, with one h1', () => {
    renderPage(headerPage());
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Sales Dashboard');

    const descriptions = screen.getAllByText(DESCRIPTION);
    expect(descriptions).toHaveLength(1);
    // After the title in document order, and inside the header.
    expect(h1s[0].compareDocumentPosition(descriptions[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(descriptions[0].closest('header')).not.toBeNull();
    // After the header's own subtitle too.
    const subtitle = screen.getByText('Welcome back');
    expect(subtitle.compareDocumentPosition(descriptions[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('LIVE CONTROL — with no page:header, the page draws its own title, then the description', () => {
    const schema = headerPage();
    schema.regions = [{ name: 'main', components: [tile('revenue')] }];
    renderPage(schema);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Sales Home');
    const description = screen.getByText(DESCRIPTION);
    expect(h1.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.closest('header')).toBeNull();
  });

  it('a page nested in a page does not inherit the outer description', () => {
    const outer = headerPage();
    outer.regions[1].components = [
      {
        type: 'app',
        pageType: 'app',
        name: 'inner',
        label: 'Inner',
        regions: [{ name: 'header', components: [{ type: 'page:header', properties: { title: 'Inner title' } }] }],
      },
    ];
    renderPage(outer);
    expect(screen.getAllByText(DESCRIPTION)).toHaveLength(1);
  });
});
