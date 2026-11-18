/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35019 — an AUTHORED record page's `record:details` body folds
 * its entirely empty sections into the same one closing line the synthesized
 * default page draws (`EmptySectionsLine`, objectstack#27055 Target 2), instead
 * of one bordered card per empty group.
 *
 * The fixture is the HotCRM opportunity's 「明细」 tab: a filled
 * Classification, a partly-filled Qualification (three values, five empty
 * fields), and two groups the page keeps with `hideEmpty: false` that a new
 * deal leaves empty — Deal Narrative (four fields) and Notes & Next Steps (two).
 * Nothing here mounts `DefaultRecordPageContext`: this is the authored page.
 *
 * What it pins, each beside its control:
 *
 * - one line names the two empty groups and counts them, and neither draws a
 *   card of its own; the filled groups draw their cards as before;
 * - a group with content keeps its own 「显示 N 个空字段」 row, line or not;
 * - expanding the line draws both groups in their places, each as its heading
 *   plus one fold row (ruling C, objectui#13386), whose fields are one click
 *   further and editable in place;
 * - a body whose every group is empty draws the line naming them all, where the
 *   whole-body fold (objectui#13386 item 2) used to draw one unnamed row;
 * - edit mode and a print page draw every group (the line's own boundary);
 * - CONTROL: a standalone `DetailView` (the `detail-view` node) keeps the card
 *   per group and the whole-body fold.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineEditProvider, PrintPageProvider, RecordContextProvider } from '@object-ui/react';
import type { DetailViewSchema, DetailViewSection } from '@object-ui/types';
import { RecordDetailsRenderer } from '../renderers/record-details';
import { DetailView } from '../DetailView';

/** `useRecordEditable`'s explain probe, answered with its fail-open 501 (the binding suites do the same). */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

afterEach(() => cleanup());

const objectSchema = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    type: { type: 'text', label: 'Type' },
    lead_source: { type: 'text', label: 'Lead Source' },
    bid_decision: { type: 'text', label: 'Bid Decision' },
    controllability: { type: 'text', label: 'Controllability' },
    priority: { type: 'text', label: 'Priority' },
    deal_level: { type: 'text', label: 'Deal Level' },
    subcontracting: { type: 'text', label: 'Subcontracting' },
    competitor: { type: 'text', label: 'Competitor' },
    budget_confirmed: { type: 'text', label: 'Budget Confirmed' },
    decision_maker: { type: 'text', label: 'Decision Maker' },
    customer_background: { type: 'textarea', label: 'Customer Background' },
    project_background: { type: 'textarea', label: 'Project Background' },
    risk_analysis: { type: 'textarea', label: 'Risk Analysis' },
    payment_terms: { type: 'textarea', label: 'Payment Terms' },
    description: { type: 'textarea', label: 'Description' },
    next_step: { type: 'text', label: 'Next Step' },
  },
};

const QUALIFICATION_FIELDS = [
  'bid_decision',
  'controllability',
  'priority',
  'deal_level',
  'subcontracting',
  'competitor',
  'budget_confirmed',
  'decision_maker',
];
const NARRATIVE_FIELDS = ['customer_background', 'project_background', 'risk_analysis', 'payment_terms'];

/** The page's sections, in its order — the two empty groups sit between filled ones. */
const authoredSections = [
  { name: 'classification', label: 'Classification', fields: ['type', 'lead_source'] },
  { name: 'qualification', label: 'Qualification', fields: QUALIFICATION_FIELDS, hideEmpty: false },
  { name: 'narrative', label: 'Deal Narrative', fields: NARRATIVE_FIELDS, hideEmpty: false },
  { name: 'notes', label: 'Notes & Next Steps', fields: ['description', 'next_step'], hideEmpty: false },
];

/** A deal with its classification and three qualification answers written. */
const DEAL = {
  id: 'opp-1',
  type: 'New Business',
  lead_source: 'Partner',
  bid_decision: 'Bid',
  controllability: 'High',
  priority: 'P1',
};

/** What `RecordDetailView` mounts around an authored page: the record context, no default-page face. */
function renderAuthoredPage(
  sections: Array<Record<string, unknown>> = authoredSections,
  data: Record<string, unknown> = DEAL,
  wrap: (node: React.ReactNode) => React.ReactNode = (node) => node,
) {
  return render(
    <>
      {wrap(
        <RecordContextProvider objectName="crm_opportunity" recordId="opp-1" data={data} objectSchema={objectSchema}>
          <RecordDetailsRenderer schema={{ sections } as never} />
        </RecordContextProvider>,
      )}
    </>,
  );
}

const emptySectionsLine = () => document.querySelector('[data-empty-sections-line]') as HTMLElement | null;
const lineToggle = () => emptySectionsLine()!.querySelector('button[aria-expanded]') as HTMLButtonElement;
/** Every drawn section card — the card face's root. */
const cards = () => Array.from(document.querySelectorAll('div.bg-card.shadow-sm'));
const cardTitled = (title: string) => cards().find((card) => card.textContent?.includes(title)) ?? null;

describe('objectstack#35019 — an authored record page folds its empty groups into one line', () => {
  it('names the two empty groups in one line, and neither draws a card', () => {
    renderAuthoredPage();

    const line = emptySectionsLine();
    expect(line).toBeTruthy();
    expect(line!.getAttribute('data-empty-sections-count')).toBe('2');
    expect(line!.textContent).toContain('Deal Narrative · Notes & Next Steps');
    expect(lineToggle().getAttribute('aria-expanded')).toBe('false');

    // The two filled groups are the only cards; the empty ones have none.
    expect(cards()).toHaveLength(2);
    expect(cardTitled('Classification')).toBeTruthy();
    expect(cardTitled('Qualification')).toBeTruthy();
    expect(cardTitled('Deal Narrative')).toBeNull();
    expect(cardTitled('Notes & Next Steps')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show 4 empty fields/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show 2 empty fields/ })).toBeNull();
  });

  it('the line closes the body: it follows every drawn group', () => {
    renderAuthoredPage();

    const line = emptySectionsLine()!;
    for (const card of cards()) {
      // DOCUMENT_POSITION_FOLLOWING: the line comes after the card.
      expect(card.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('a group with content keeps its own "Show N empty fields" row, before and after expanding', () => {
    renderAuthoredPage();

    const qualification = cardTitled('Qualification')!;
    expect(within(qualification as HTMLElement).getByRole('button', { name: /Show 5 empty fields/ })).toBeInTheDocument();
    expect(within(qualification as HTMLElement).getByText('Bid')).toBeInTheDocument();

    fireEvent.click(lineToggle());
    const after = cardTitled('Qualification')!;
    expect(within(after as HTMLElement).getByRole('button', { name: /Show 5 empty fields/ })).toBeInTheDocument();
  });

  it('expanding draws both groups in their places, each as its heading plus one fold row, and collapses again', () => {
    renderAuthoredPage();

    fireEvent.click(lineToggle());
    expect(lineToggle().getAttribute('aria-expanded')).toBe('true');
    expect(cards()).toHaveLength(4);
    // In their authored places, not appended after the filled groups.
    const TITLES = ['Classification', 'Qualification', 'Deal Narrative', 'Notes & Next Steps'];
    expect(
      cards().map((card) => TITLES.find((title) => card.querySelector('.tracking-tight')?.textContent?.includes(title))),
    ).toEqual(TITLES);
    const narrative = cardTitled('Deal Narrative') as HTMLElement;
    const notes = cardTitled('Notes & Next Steps') as HTMLElement;
    expect(within(narrative).getByRole('button', { name: /Show 4 empty fields/ })).toBeInTheDocument();
    expect(within(notes).getByRole('button', { name: /Show 2 empty fields/ })).toBeInTheDocument();

    fireEvent.click(lineToggle());
    expect(cardTitled('Deal Narrative')).toBeNull();
    expect(cardTitled('Notes & Next Steps')).toBeNull();
    expect(emptySectionsLine()!.textContent).toContain('Deal Narrative · Notes & Next Steps');
  });

  it('every empty field is one click further, and editable in place', () => {
    renderAuthoredPage(authoredSections, DEAL, (node) => <InlineEditProvider canEdit>{node}</InlineEditProvider>);

    fireEvent.click(lineToggle());
    const narrative = cardTitled('Deal Narrative') as HTMLElement;
    fireEvent.click(within(narrative).getByRole('button', { name: /Show 4 empty fields/ }));
    for (const label of ['Customer Background', 'Project Background', 'Risk Analysis', 'Payment Terms']) {
      expect(within(cardTitled('Deal Narrative') as HTMLElement).getByText(label)).toBeInTheDocument();
    }

    // Double-click an empty value: the page enters inline edit, and edit mode
    // draws every group with its fields as inputs — the line steps aside.
    const placeholder = within(cardTitled('Deal Narrative') as HTMLElement).getAllByTitle('No value')[0];
    fireEvent.doubleClick(placeholder);
    expect(emptySectionsLine()).toBeNull();
    expect(cards()).toHaveLength(4);
    expect(within(cardTitled('Deal Narrative') as HTMLElement).getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('a body whose every group is empty draws the line naming them all, not the unnamed whole-body row', () => {
    renderAuthoredPage(
      [
        { name: 'narrative', label: 'Deal Narrative', fields: NARRATIVE_FIELDS, hideEmpty: false },
        { name: 'notes', label: 'Notes & Next Steps', fields: ['description', 'next_step'], hideEmpty: false },
      ],
      { id: 'opp-2' },
    );

    const line = emptySectionsLine()!;
    expect(line.getAttribute('data-empty-sections-count')).toBe('2');
    expect(line.textContent).toContain('Deal Narrative · Notes & Next Steps');
    expect(cards()).toHaveLength(0);
    // The whole-body fold's "Show 6 empty fields" row is not drawn beside it.
    expect(screen.queryByRole('button', { name: /empty field/i })).toBeNull();
  });

  it('a hideEmpty group the renderer hides is never named in the line', () => {
    renderAuthoredPage([
      ...authoredSections.slice(0, 2),
      { name: 'narrative', label: 'Deal Narrative', fields: NARRATIVE_FIELDS },
      { name: 'notes', label: 'Notes & Next Steps', fields: ['description', 'next_step'], hideEmpty: false },
    ]);

    const line = emptySectionsLine()!;
    expect(line.getAttribute('data-empty-sections-count')).toBe('1');
    expect(line.textContent).not.toContain('Deal Narrative');
    expect(line.textContent).toContain('Notes & Next Steps');
  });

  it('a print page draws every group, with no line', () => {
    renderAuthoredPage(authoredSections, DEAL, (node) => (
      <PrintPageProvider value={{ paperSize: 'A4' } as never}>{node}</PrintPageProvider>
    ));

    expect(emptySectionsLine()).toBeNull();
    expect(cardTitled('Deal Narrative')).toBeTruthy();
    expect(cardTitled('Notes & Next Steps')).toBeTruthy();
  });
});

describe('objectstack#35019 — CONTROL: a standalone DetailView keeps a card per group and the whole-body fold', () => {
  const detailSections = (titles: Array<[string, string[]]>): DetailViewSection[] =>
    titles.map(([title, names]) => ({
      title,
      showBorder: true,
      hideEmpty: false,
      fields: names.map((name) => ({ name, label: (objectSchema.fields as Record<string, { label: string }>)[name].label })),
    }));
  const schemaOf = (sections: DetailViewSection[], data: Record<string, unknown>): DetailViewSchema => ({
    type: 'detail-view',
    data,
    sections,
  });

  it('beside a filled group, each empty group keeps its card with its own fold row', () => {
    const sections = detailSections([
      ['Classification', ['type', 'lead_source']],
      ['Deal Narrative', NARRATIVE_FIELDS],
      ['Notes & Next Steps', ['description', 'next_step']],
    ]);
    render(<DetailView schema={schemaOf(sections, DEAL)} />);

    expect(emptySectionsLine()).toBeNull();
    expect(within(cardTitled('Deal Narrative') as HTMLElement).getByRole('button', { name: /Show 4 empty fields/ })).toBeInTheDocument();
    expect(within(cardTitled('Notes & Next Steps') as HTMLElement).getByRole('button', { name: /Show 2 empty fields/ })).toBeInTheDocument();
  });

  it('every group empty: the whole-body fold draws its one row', () => {
    const sections = detailSections([
      ['Deal Narrative', NARRATIVE_FIELDS],
      ['Notes & Next Steps', ['description', 'next_step']],
    ]);
    render(<DetailView schema={schemaOf(sections, { id: 'opp-2' })} />);

    expect(emptySectionsLine()).toBeNull();
    expect(screen.getByRole('button', { name: /Show 6 empty fields/ })).toBeInTheDocument();
  });
});
