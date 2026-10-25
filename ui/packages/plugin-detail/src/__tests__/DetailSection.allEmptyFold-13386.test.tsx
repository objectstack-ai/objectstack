/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13386 (ruling C, batch #7 item 4, maintainer 2026-10-23) — a KEPT
 * all-empty section folds like a partly-filled one, and a body whose sections
 * are all empty folds once more (item 2 of objectui#12618).
 *
 * The ruling's done-when, case by case:
 *
 * - read-only, an all-empty `hideEmpty: false` section draws its heading plus
 *   ONE "Show N empty fields" row — the toggle the mixed sections use — and no
 *   em-dash; the row reveals every field and folds them back;
 * - edit mode is unchanged: every field is an editable row, no fold;
 * - a mixed section is unchanged (objectui#7129 Q2-C);
 * - a body whose sections are all empty draws ONE row for the whole body.
 *
 * The fixture is the HotCRM opportunity's 「交易说明」 (Deal Narrative) section,
 * four prose fields a new deal leaves empty, beside its siblings.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PrintPageProvider } from '@object-ui/react';
import type { DetailViewSchema, DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { DetailView } from '../DetailView';
import { EmptySectionsFold, emptySectionsFoldCount } from '../EmptySectionsFold';

const objectSchema = {
  fields: {
    customer_background: { type: 'textarea', label: 'Customer Background' },
    project_background: { type: 'textarea', label: 'Project Background' },
    risk_analysis: { type: 'textarea', label: 'Risk Analysis' },
    payment_terms: { type: 'textarea', label: 'Payment Terms' },
    description: { type: 'textarea', label: 'Description' },
    next_step: { type: 'text', label: 'Next Step' },
    type: { type: 'text', label: 'Type' },
    lead_source: { type: 'text', label: 'Lead Source' },
  },
};

const NARRATIVE_LABELS = ['Customer Background', 'Project Background', 'Risk Analysis', 'Payment Terms'];

const narrative = (overrides: Partial<DetailViewSection> = {}): DetailViewSection => ({
  title: 'Deal Narrative',
  hideEmpty: false,
  fields: [
    { name: 'customer_background', label: 'Customer Background' },
    { name: 'project_background', label: 'Project Background' },
    { name: 'risk_analysis', label: 'Risk Analysis' },
    { name: 'payment_terms', label: 'Payment Terms' },
  ],
  ...overrides,
});

const notes = (overrides: Partial<DetailViewSection> = {}): DetailViewSection => ({
  title: 'Notes & Next Steps',
  hideEmpty: false,
  fields: [
    { name: 'description', label: 'Description' },
    { name: 'next_step', label: 'Next Step' },
  ],
  ...overrides,
});

const classification: DetailViewSection = {
  title: 'Classification',
  fields: [
    { name: 'type', label: 'Type' },
    { name: 'lead_source', label: 'Lead Source' },
  ],
};

const placeholders = () => screen.queryAllByTitle('No value');
const foldButton = () => screen.queryByRole('button', { name: /empty field/i });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#13386 — a kept all-empty section folds (read-only)', () => {
  it('draws its heading plus ONE "Show 4 empty fields" row, and no em-dash', () => {
    render(<DetailSection section={narrative()} data={{}} objectSchema={objectSchema} />);

    expect(screen.getByText('Deal Narrative')).toBeInTheDocument();
    expect(foldButton()?.textContent).toMatch(/Show 4 empty fields/);
    expect(screen.getAllByRole('button', { name: /empty field/i })).toHaveLength(1);
    expect(placeholders()).toHaveLength(0);
    for (const label of NARRATIVE_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('the row reveals every field, and folds them back', () => {
    render(<DetailSection section={narrative()} data={{}} objectSchema={objectSchema} />);

    fireEvent.click(screen.getByRole('button', { name: /Show 4 empty fields/ }));
    for (const label of NARRATIVE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(placeholders()).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: /Hide empty fields/ }));
    expect(placeholders()).toHaveLength(0);
    expect(foldButton()?.textContent).toMatch(/Show 4 empty fields/);
  });

  it('folds an untitled, borderless section too: the row is the whole section', () => {
    render(
      <DetailSection
        section={narrative({ title: undefined, showBorder: false })}
        data={{}}
        objectSchema={objectSchema}
      />,
    );
    expect(foldButton()?.textContent).toMatch(/Show 4 empty fields/);
    expect(placeholders()).toHaveLength(0);
  });

  it('CONTROL — `hideEmpty: true` still hides the all-empty section outright', () => {
    const { container } = render(
      <DetailSection section={narrative({ hideEmpty: true })} data={{}} objectSchema={objectSchema} />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('objectui#13386 — edit mode is unchanged', () => {
  it('every field of an all-empty section is an editable row, with no fold', () => {
    render(
      <DetailSection
        section={narrative()}
        data={{}}
        objectSchema={objectSchema}
        isEditing
        onFieldChange={() => {}}
      />,
    );

    expect(foldButton()).toBeNull();
    for (const label of NARRATIVE_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });
});

describe('objectui#13386 — a print page prints every row (objectui#12717)', () => {
  it('a kept all-empty section prints every declared row, with no toggle', () => {
    render(
      <PrintPageProvider value={{ paperSize: 'A4' } as never}>
        <DetailSection section={narrative()} data={{}} objectSchema={objectSchema} />
      </PrintPageProvider>,
    );
    expect(foldButton()).toBeNull();
    expect(placeholders()).toHaveLength(4);
  });
});

describe('objectui#13386 — a mixed section is unchanged (objectui#7129 Q2-C)', () => {
  it('a small partly-filled section keeps its empty row in place', () => {
    render(
      <DetailSection
        section={notes()}
        data={{ description: 'Expansion deal' }}
        objectSchema={objectSchema}
      />,
    );
    expect(screen.getByText('Expansion deal')).toBeInTheDocument();
    expect(screen.getByText('Next Step')).toBeInTheDocument();
    expect(placeholders()).toHaveLength(1);
    expect(foldButton()).toBeNull();
  });

  it('a large partly-filled section folds its empty rows behind the toggle, as before', () => {
    render(
      <DetailSection
        section={narrative()}
        data={{ customer_background: 'Long-time account' }}
        objectSchema={objectSchema}
      />,
    );
    expect(screen.getByText('Long-time account')).toBeInTheDocument();
    expect(foldButton()?.textContent).toMatch(/Show 3 empty fields/);
    expect(placeholders()).toHaveLength(0);
  });
});

describe('objectui#13386 — a body whose sections are all empty folds once more (#12618 item 2)', () => {
  const detailView = (sections: DetailViewSection[], data: Record<string, unknown>): DetailViewSchema => ({
    type: 'detail-view',
    data: { id: 'opp-1', ...data },
    sections,
  });

  it('draws ONE row for the whole body, counting every kept empty field', () => {
    render(
      <DetailView
        schema={detailView([narrative(), notes(), { ...classification, hideEmpty: false }], {})}
      />,
    );

    expect(screen.getAllByRole('button', { name: /empty field/i })).toHaveLength(1);
    expect(foldButton()?.textContent).toMatch(/Show 8 empty fields/);
    for (const heading of ['Deal Narrative', 'Notes & Next Steps', 'Classification']) {
      expect(screen.queryByText(heading)).toBeNull();
    }
    expect(placeholders()).toHaveLength(0);
  });

  it('revealing it draws each section folded on its own, and a row folds the body back', () => {
    render(<DetailView schema={detailView([narrative(), notes()], {})} />);

    fireEvent.click(screen.getByRole('button', { name: /Show 6 empty fields/ }));
    expect(screen.getByText('Deal Narrative')).toBeInTheDocument();
    expect(screen.getByText('Notes & Next Steps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show 4 empty fields/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show 2 empty fields/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide empty fields/ }));
    expect(screen.queryByText('Deal Narrative')).toBeNull();
    expect(foldButton()?.textContent).toMatch(/Show 6 empty fields/);
  });

  it('CONTROL — one filled field anywhere in the body and every section draws as before', () => {
    render(
      <DetailView
        schema={detailView([narrative(), notes(), classification], { type: 'New Business' })}
      />,
    );

    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('New Business')).toBeInTheDocument();
    expect(screen.getByText('Deal Narrative')).toBeInTheDocument();
    expect(screen.getByText('Notes & Next Steps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show 4 empty fields/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show 2 empty fields/ })).toBeInTheDocument();
  });

  it('CONTROL — a single kept section is already one row: it keeps its heading', () => {
    render(<DetailView schema={detailView([narrative(), { ...notes(), hideEmpty: true }], {})} />);

    expect(screen.getByText('Deal Narrative')).toBeInTheDocument();
    expect(screen.queryByText('Notes & Next Steps')).toBeNull();
    expect(foldButton()?.textContent).toMatch(/Show 4 empty fields/);
  });

  it('edit mode and a print page draw every section', () => {
    const sections = [narrative(), notes()];
    const body = <div data-testid="sections">sections</div>;

    const editing = render(
      <EmptySectionsFold sections={sections} data={{}} isEditing>
        {body}
      </EmptySectionsFold>,
    );
    expect(screen.getByTestId('sections')).toBeInTheDocument();
    expect(foldButton()).toBeNull();
    editing.unmount();

    render(
      <PrintPageProvider value={{ paperSize: 'A4' } as never}>
        <EmptySectionsFold sections={sections} data={{}} isEditing={false}>
          {body}
        </EmptySectionsFold>
      </PrintPageProvider>,
    );
    expect(screen.getByTestId('sections')).toBeInTheDocument();
    expect(foldButton()).toBeNull();
  });

  it('the count: hidden and field-less sections neither count nor block the fold', () => {
    const empty = { title: 'Financials', fields: [] } as DetailViewSection;
    expect(emptySectionsFoldCount([narrative(), notes(), empty, { ...classification, hideEmpty: true }], {})).toBe(6);
    // A filled field in a HIDDEN-when-empty section is still a filled field.
    expect(
      emptySectionsFoldCount([narrative(), notes(), { ...classification, hideEmpty: true }], { type: 'x' }),
    ).toBe(0);
    // Whitespace is empty here, as it is for the section fold (`hasCellValue`).
    expect(emptySectionsFoldCount([narrative(), notes()], { next_step: '   ' })).toBe(6);
  });
});

describe('objectui#13386 — the body fold never blanks the body (objectui#8497)', () => {
  it('a malformed section turns the fold off instead of throwing or hiding its failure', () => {
    const exploding = {
      title: 'Boom',
      fields: [
        {
          name: 'boom_field',
          get value(): never {
            throw new Error('section-local failure');
          },
        },
      ],
    } as unknown as DetailViewSection;
    expect(emptySectionsFoldCount([exploding, narrative(), notes()], {})).toBe(0);
    expect(
      emptySectionsFoldCount([{ title: 'Orphan' } as unknown as DetailViewSection, narrative(), notes()], {}),
    ).toBe(0);
  });
});
