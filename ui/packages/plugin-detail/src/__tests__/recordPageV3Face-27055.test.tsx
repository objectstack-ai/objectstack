/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Targets 1 and 2 — the record page v3 face of the
 * synthesized default page, drawn when `DefaultRecordPageContext` is on:
 *
 * - a detail section is frameless: a title row over a hairline, then the
 *   field grid, no card; 1–3 columns by the fields it shows; collapsible
 *   from its title;
 * - entirely empty sections leave their place and fold into ONE line naming
 *   them (「地址 · 转化 · 附加信息 · 3 个空分区 · 展开」), which expands them
 *   back in place;
 * - the highlight strip is an equal-width grid;
 * - the provenance line names the owner and the record id.
 *
 * Every assertion has its control: the same block outside the context keeps
 * the face it had (the card, the whole-body fold, the flex strip, no owner).
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PrintPageProvider } from '@object-ui/react';
import type { DetailViewSchema, DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { DetailView } from '../DetailView';
import { HeaderHighlight } from '../HeaderHighlight';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { DefaultRecordPageContext, framelessSectionColumns } from '../defaultRecordPage';
import { isFoldableEmptySection } from '../EmptySectionsFold';

afterEach(cleanup);

const onDefaultPage = (node: React.ReactNode) => (
  <DefaultRecordPageContext.Provider value>{node}</DefaultRecordPageContext.Provider>
);

const field = (name: string) => ({ name, label: name.replace(/_/g, ' ') });
const section = (title: string, names: string[], extra: Partial<DetailViewSection> = {}): DetailViewSection => ({
  title,
  fields: names.map(field),
  ...extra,
});

const gridOf = (container: HTMLElement) =>
  container.querySelector('[data-detail-section-face="frameless"] .grid') as HTMLElement | null;

describe('framelessSectionColumns — 1–3 columns by the fields a section shows', () => {
  it('one field one column, two to five two, six and more three', () => {
    expect([0, 1, 2, 5, 6, 12].map(framelessSectionColumns)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('DetailSection — the frameless face (objectstack#27055)', () => {
  const identity = section('Identity', ['first_name', 'last_name', 'email', 'phone', 'title']);
  const data = { first_name: 'Mira', last_name: 'Costa', email: 'm@x.io', phone: '1', title: 'Dir' };

  it('draws a title row over a hairline and the grid — no card', () => {
    const { container } = render(onDefaultPage(<DetailSection section={identity} data={data} />));
    const root = container.querySelector('[data-detail-section-face="frameless"]');
    expect(root).toBeTruthy();
    expect(root!.tagName).toBe('SECTION');
    // No card chrome: the card face's root is a bordered, shadowed box.
    expect(container.querySelector('.shadow-sm, .rounded-xl')).toBeNull();
    const title = screen.getByRole('button', { name: 'Identity' });
    expect(title.parentElement!.className).toContain('border-b');
  });

  it('lays five fields in two columns and six in three', () => {
    const five = render(onDefaultPage(<DetailSection section={identity} data={data} />));
    expect(gridOf(five.container)!.className).toContain('@sm:grid-cols-2');
    expect(gridOf(five.container)!.className).not.toContain('@lg:grid-cols-3');
    cleanup();
    const six = section('Company', ['company', 'job', 'industry', 'site', 'revenue', 'staff']);
    const sixData = { company: 'A', job: 'B', industry: 'C', site: 'D', revenue: 1, staff: 2 };
    const { container } = render(onDefaultPage(<DetailSection section={six} data={sixData} />));
    expect(gridOf(container)!.className).toContain('@lg:grid-cols-3');
  });

  it('collapses from its title row', () => {
    const { container } = render(onDefaultPage(<DetailSection section={identity} data={data} />));
    const title = screen.getByRole('button', { name: 'Identity' });
    expect(title.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(gridOf(container)).toBeNull();
  });

  it('CONTROL — outside the default page the card face draws', () => {
    const { container } = render(<DetailSection section={identity} data={data} />);
    expect(container.querySelector('[data-detail-section-face="frameless"]')).toBeNull();
  });

  it('CONTROL — a print page keeps the card face', () => {
    const { container } = render(
      onDefaultPage(
        <PrintPageProvider value={{ paperSize: 'A4' } as never}>
          <DetailSection section={identity} data={data} />
        </PrintPageProvider>,
      ),
    );
    expect(container.querySelector('[data-detail-section-face="frameless"]')).toBeNull();
  });
});

describe('EmptySectionsLine — entirely empty sections fold into one line (objectstack#27055)', () => {
  const sections: DetailViewSection[] = [
    section('Basic', ['name', 'email']),
    section('Address', ['street', 'city'], { hideEmpty: false }),
    section('Conversion', ['converted_at'], { hideEmpty: false }),
    section('Extra', ['notes'], { hideEmpty: false }),
  ];
  const data = { id: 'L-1', name: 'Mira', email: 'm@x.io' };
  const schema: DetailViewSchema = { type: 'detail-view', data, sections } as any;

  it('names the empty sections, counts them, and draws only the sections with a value', () => {
    const { container } = render(onDefaultPage(<DetailView schema={schema} />));
    const line = container.querySelector('[data-empty-sections-line]') as HTMLElement;
    expect(line).toBeTruthy();
    expect(line.getAttribute('data-empty-sections-count')).toBe('3');
    expect(line.textContent).toContain('Address · Conversion · Extra');
    expect(screen.getByRole('button', { name: 'Basic' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Address' })).toBeNull();
  });

  it('expands them back in place, and collapses again', () => {
    const { container } = render(onDefaultPage(<DetailView schema={schema} />));
    const toggle = container.querySelector('[data-empty-sections-line] button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const titles = Array.from(container.querySelectorAll('[data-detail-section-face="frameless"] button[aria-expanded]')).map(
      (b) => b.textContent,
    );
    expect(titles).toEqual(['Basic', 'Address', 'Conversion', 'Extra']);
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Address' })).toBeNull();
  });

  it('draws every section while editing (the fields are the inputs)', () => {
    expect(isFoldableEmptySection(sections[1], data)).toBe(true);
    expect(isFoldableEmptySection(sections[0], data)).toBe(false);
    // A hideEmpty section hides itself — never named in the line.
    expect(isFoldableEmptySection(section('Gone', ['x'], { hideEmpty: true }), data)).toBe(false);
  });

  it('CONTROL — outside the default page no line draws (the whole-body fold keeps its rule)', () => {
    const { container } = render(<DetailView schema={schema} />);
    expect(container.querySelector('[data-empty-sections-line]')).toBeNull();
  });
});

describe('HeaderHighlight — the equal-width grid (objectstack#27055)', () => {
  const fields = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, label: name.toUpperCase() }));
  const data = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };

  it('draws the strip as a grid of equal cells on the default page', () => {
    const { container } = render(onDefaultPage(<HeaderHighlight fields={fields} data={data} />));
    const grid = container.querySelector('[data-highlights-face="grid"]') as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.className).toContain('@3xl:grid-cols-6');
    expect(grid.children).toHaveLength(6);
  });

  it('CONTROL — elsewhere it keeps the wrapping row', () => {
    const { container } = render(<HeaderHighlight fields={fields} data={data} />);
    expect(container.querySelector('[data-highlights-face="grid"]')).toBeNull();
  });
});

describe('RecordMetaFooter — the v3 meta line names the owner and the id (objectstack#27055)', () => {
  const data = { id: 'L-1001', created_at: '2026-10-16T00:00:00Z', owner_id: 'Dev Admin' };

  it('adds the owner and the record id on the default page', () => {
    const { container } = render(onDefaultPage(<RecordMetaFooter data={data} />));
    expect(container.querySelector('[data-record-meta-owner]')).toBeTruthy();
    expect(container.querySelector('[data-record-meta-id]')!.textContent).toBe('L-1001');
  });

  it('CONTROL — elsewhere the line is created / updated only', () => {
    const { container } = render(<RecordMetaFooter data={data} />);
    expect(container.querySelector('[data-record-meta-owner]')).toBeNull();
    expect(container.querySelector('[data-record-meta-id]')).toBeNull();
  });
});
