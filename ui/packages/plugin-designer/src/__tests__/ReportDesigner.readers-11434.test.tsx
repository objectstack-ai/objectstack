/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `report-designer` DRAWS the members objectui#11434 ruled READ.
 *
 * The card's measurement found `ReportDesignerElement.dataBinding` and
 * `.format`, `ReportDesignerSection.groupField` and `.pageBreakBefore`, and
 * `ReportDesignerSchema.margins.top` / `.right` / `.bottom` declared on both
 * faces and drawn by nothing. A field element drew the UNDECLARED
 * `properties.field` instead of its declared `dataBinding`. The seat ruled each
 * member READ, and ruled that the renderer moves ONTO `dataBinding` and stops
 * reading `properties.field` — a declared member beats an undeclared bag key.
 *
 * "Read" is measured the way the card measured "unread": a render probe
 * through the real `SchemaRenderer` and the real registry, one document with
 * the member and one without it, compared as drawn markup. On top of that
 * diff, each row names WHAT is drawn. Colour, font and spacing values are
 * asserted through the class that paints them and the custom property that
 * carries them, never through a style value alone.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { ReportDesignerSection } from '@object-ui/types';
import { SchemaRenderer } from '@object-ui/react';
import { ReportDesigner } from '../ReportDesigner';
import '../index';

type Doc = Record<string, unknown>;

afterEach(() => cleanup());

const POSITION = { x: 40, y: 10, width: 200, height: 30 };
const FIELD = { id: 'amount-el', type: 'field', position: POSITION, properties: {} };

function doc(overrides: { element?: Doc; section?: Doc; root?: Doc } = {}): Doc {
  return {
    type: 'report-designer',
    reportName: 'Pipeline',
    objectName: 'opportunity',
    sections: [{ type: 'detail', height: 200, elements: [{ ...FIELD, ...overrides.element }], ...overrides.section }],
    ...overrides.root,
  };
}

function mount(node: Doc): HTMLElement {
  return render(<SchemaRenderer schema={node as never} />).container;
}

/** The drawn markup, with React's generated ids normalised away. */
function drawn(node: Doc): string {
  const html = mount(node).innerHTML.replace(/:r[0-9a-z]+:/g, ':rID:').replace(/«r[0-9a-z]+»/g, '«rID»');
  cleanup();
  return html;
}

const byTestId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('`dataBinding` is what a field element draws; `properties.field` is not read (objectui#11434)', () => {
  it('a field element draws its `dataBinding`', () => {
    expect(drawn(doc({ element: { dataBinding: 'amount' } }))).not.toBe(drawn(doc()));
    expect(byTestId(mount(doc({ element: { dataBinding: 'amount' } })), 'report-element-binding-amount-el')?.textContent).toBe('{amount}');
    cleanup();
    // Unbound, a field element draws the placeholder.
    expect(byTestId(mount(doc()), 'report-element-binding-amount-el')?.textContent).toBe('{field}');
  });

  it('the undeclared `properties.field` is no longer drawn — no fallback reads the bag key', () => {
    expect(drawn(doc({ element: { properties: { field: 'amount' } } }))).toBe(drawn(doc()));
  });

  it('another element type draws its binding beside its own content', () => {
    const chart = { id: 'chart-el', type: 'chart', position: POSITION, properties: {}, dataBinding: 'revenue_by_month' };
    const container = mount(doc({ section: { elements: [chart] } }));
    expect(byTestId(container, 'report-element-binding-chart-el')?.textContent).toBe('{revenue_by_month}');
  });

  it('the property panel edits `dataBinding` on the element, and a new field element is born bound', () => {
    const onSectionsChange = vi.fn();
    const sections = [{ type: 'detail', height: 200, elements: [{ ...FIELD, dataBinding: 'amount' }] }] as ReportDesignerSection[];
    const { container, getByText, getByLabelText } = render(
      <ReportDesigner reportName="p" objectName="o" sections={sections} onSectionsChange={onSectionsChange} />,
    );
    act(() => {
      fireEvent.click(getByText('{amount}'));
    });
    const panel = container.querySelector('[aria-label="Properties panel"]');
    const caption = Array.from(panel?.querySelectorAll('label') ?? []).find((l) => l.textContent === 'Data binding');
    const input = caption?.parentElement?.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('amount');
    act(() => {
      fireEvent.change(input, { target: { value: 'close_date' } });
    });
    const edited = onSectionsChange.mock.calls.at(-1)?.[0] as ReportDesignerSection[];
    expect(edited[0].elements[0].dataBinding).toBe('close_date');
    expect(edited[0].elements[0].properties).toEqual({});

    onSectionsChange.mockClear();
    act(() => {
      fireEvent.click(getByLabelText('Add Field'));
    });
    const added = (onSectionsChange.mock.calls.at(-1)?.[0] as ReportDesignerSection[])[0].elements.at(-1);
    expect(added?.dataBinding).toBe('field_name');
    expect(added?.properties).toEqual({});
  });
});

describe('`format` is drawn on the element content (objectui#11434)', () => {
  // [sub-key, value, the class it adds, the custom property and value it carries]
  const ROWS = [
    ['fontWeight', 'bold', 'font-bold', null],
    ['fontStyle', 'italic', 'italic', null],
    ['alignment', 'right', 'justify-end', null],
    ['verticalAlignment', 'bottom', 'items-end', null],
    ['color', '#aa0000', 'text-[color:var(--report-el-color)]', ['--report-el-color', '#aa0000']],
    ['backgroundColor', '#00aa00', 'bg-[color:var(--report-el-bg)]', ['--report-el-bg', '#00aa00']],
    ['fontSize', 14, 'text-[length:var(--report-el-font-size)]', ['--report-el-font-size', '14px']],
    ['fontFamily', 'Georgia', 'font-[family-name:var(--report-el-font-family)]', ['--report-el-font-family', 'Georgia']],
    ['border', '1px solid', '[border:var(--report-el-border)]', ['--report-el-border', '1px solid']],
    ['padding', '4px', 'p-[var(--report-el-padding)]', ['--report-el-padding', '4px']],
  ] as const;

  it.each(ROWS)('`format.%s` is drawn', (key, value, cls, carried) => {
    const element = { dataBinding: 'amount', format: { [key]: value } };
    expect(drawn(doc({ element }))).not.toBe(drawn(doc({ element: { dataBinding: 'amount' } })));
    const content = byTestId(mount(doc({ element })), 'report-element-content-amount-el');
    expect(content?.className).toContain(cls);
    if (carried) expect(content?.style.getPropertyValue(carried[0])).toBe(carried[1]);
  });

  it.each([
    ['numberFormat', '#,##0.00'],
    ['dateFormat', 'yyyy-MM-dd'],
  ] as const)('`format.%s` is drawn beside the binding', (key, value) => {
    const element = { dataBinding: 'amount', format: { [key]: value } };
    expect(drawn(doc({ element }))).not.toBe(drawn(doc({ element: { dataBinding: 'amount' } })));
    expect(byTestId(mount(doc({ element })), 'report-element-format-amount-el')?.textContent).toBe(value);
  });
});

describe('section and page members are drawn (objectui#11434)', () => {
  it('`groupField` is drawn in the section label', () => {
    expect(drawn(doc({ section: { type: 'group-header', groupField: 'stage' } }))).not.toBe(drawn(doc({ section: { type: 'group-header' } })));
    expect(byTestId(mount(doc({ section: { groupField: 'stage' } })), 'report-section-group-0')?.textContent).toBe(' · by stage');
  });

  it('`pageBreakBefore` is drawn as a page-break rule across the top of the section', () => {
    expect(drawn(doc({ section: { pageBreakBefore: true } }))).not.toBe(drawn(doc()));
    expect(byTestId(mount(doc({ section: { pageBreakBefore: true } })), 'report-section-page-break-0')?.getAttribute('role')).toBe('separator');
    cleanup();
    expect(byTestId(mount(doc({ section: { pageBreakBefore: false } })), 'report-section-page-break-0')).toBeNull();
  });

  it.each(['top', 'right', 'bottom'] as const)('`margins.%s` moves the page\'s margin guide', (side) => {
    const margins = { top: 40, right: 40, bottom: 40, left: 40, [side]: 97 };
    expect(drawn(doc({ root: { margins } }))).not.toBe(drawn(doc()));
    const guide = byTestId(mount(doc({ root: { margins } })), 'report-margin-guide');
    expect(guide?.className).toContain(`${side}-[var(--report-margin-${side})]`);
    expect(guide?.style.getPropertyValue(`--report-margin-${side}`)).toBe('97px');
  });
});
