/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12523: the record page's highlight strip cut its last values at
 * 1440 ("+1-555-0", "mira.costa@atlasconstruction") and, at 390, laid out two
 * chips side by side above an indented list.
 *
 * What a Chromium reading of this component found (the pull request that
 * landed this file has the before/after readings):
 *  - No chip was ever wider than its line. The six floors summed to exactly the
 *    1088px row (four 9rem chips, two 16rem chips), so nothing grew. The
 *    PHONE chip was one of the 9rem chips, because HotCRM declares its phone as
 *    `text` with `format: 'phone'` and the wide-basis rule read the declared
 *    type while the renderer read the format.
 *  - The value span did clip, but its child was one atomic inline-flex box (the
 *    link cell), and the first atomic inline on a line is clipped, never
 *    ellipsed. So no ellipsis could appear. That half is fixed in
 *    `@object-ui/fields` and pinned there
 *    (`cellRenderers.linkEllipsis-12523.test.tsx`).
 *  - A wrapped line started with a chip that kept its left border and padding.
 *    At 390 that read as an indented list under a two-chip first line.
 *
 * happy-dom has no layout engine and loads no stylesheet, so these are
 * class-semantics pins, the same approach as the objectui#11684 and
 * objectui#11659 pins beside this file. Stubbing `scrollWidth` / `clientWidth`
 * would only measure the stub.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import type { HighlightField } from '@object-ui/types';
import { InlineEditProvider } from '@object-ui/react';
import { HeaderHighlight } from '../HeaderHighlight';

/** The HotCRM lead the audit measured, with its own field shapes. */
const leadSchema = {
  fields: {
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Contacted', value: 'contacted', color: '#FFA500' }],
    },
    rating: { type: 'rating', label: 'Lead Score' },
    lead_source: {
      type: 'select',
      label: 'Lead Source',
      options: [{ label: 'Cold Call', value: 'cold_call' }],
    },
    owner_id: { type: 'lookup', label: 'Lead Owner', reference: 'sys_user' },
    email: { type: 'email', label: 'Email' },
    // HotCRM's `Field.text({ format: 'phone' })`: declared `text`, drawn as a
    // phone.
    phone: { type: 'text', format: 'phone', label: 'Phone' },
  },
};

const EMAIL = 'mira.costa@atlasconstruction.example.com';
const PHONE = '+1-555-0117-1119';

const leadData = {
  status: 'contacted',
  rating: 5,
  lead_source: 'cold_call',
  owner_id: { id: 'u1', name: 'Dev Admin' },
  email: EMAIL,
  phone: PHONE,
};

const leadFields: HighlightField[] = [
  { name: 'status', label: 'Status' },
  { name: 'rating', label: 'Lead Score' },
  { name: 'lead_source', label: 'Lead Source' },
  { name: 'owner_id', label: 'Lead Owner' },
  { name: 'email', label: 'Email' },
  { name: 'phone', label: 'Phone' },
];

const renderLead = () =>
  render(
    <HeaderHighlight fields={leadFields} data={leadData} objectSchema={leadSchema} objectName="lead" />,
  );

/** The chip column (`group flex flex-col …`) around an element. */
const chipAround = (el: Element) => el.closest('div.group') as HTMLElement;
const chipsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('section > div > div.group')) as HTMLElement[];

/** Below `sm`, every chip is one full-width line with no separator. */
const PHONE_LAYOUT = ['max-sm:basis-full', 'max-sm:max-w-full', 'max-sm:border-l-0', 'max-sm:px-0'];

describe('a phone drawn from a format gets the phone basis (objectui#12523)', () => {
  it('gives the `text` + `format: phone` chip the 16rem floor objectui#11659 gave phones', () => {
    renderLead();

    const chip = chipAround(screen.getByText(PHONE));
    expect(chip).toHaveClass('basis-[16rem]', 'min-w-[min(16rem,100%)]');
    expect(chip).not.toHaveClass('basis-[9rem]');
  });

  it('gives a `text` + `format: email` chip the same floor as an `email` chip', () => {
    render(
      <HeaderHighlight
        fields={[{ name: 'contact', label: 'Contact' }]}
        data={{ contact: EMAIL }}
        objectSchema={{ fields: { contact: { type: 'text', format: 'email' } } }}
      />,
    );

    expect(chipAround(screen.getByText(EMAIL))).toHaveClass('basis-[16rem]');
  });

  it('keeps a plain `text` chip on the 9rem floor (the format is the trigger)', () => {
    render(
      <HeaderHighlight
        fields={[{ name: 'code', label: 'Code' }]}
        data={{ code: 'A-1' }}
        objectSchema={{ fields: { code: { type: 'text' } } }}
      />,
    );

    const chip = chipAround(screen.getByText('A-1'));
    expect(chip).toHaveClass('basis-[9rem]');
    expect(chip).not.toHaveClass('basis-[16rem]');
  });
});

describe('a cut value says so, and carries the whole value (objectui#12523)', () => {
  it('puts each link value in a clip box titled with the whole value', () => {
    renderLead();

    for (const text of [EMAIL, PHONE]) {
      const clipBox = chipAround(screen.getByText(text)).querySelector('span.truncate');
      expect(clipBox).not.toBeNull();
      expect(clipBox).toHaveClass('block', 'min-w-0', 'truncate');
      expect(clipBox).toHaveAttribute('title', text);
    }
  });

  it('keeps every chip on the content cap that hands free width to the chips that need it', () => {
    const { container } = renderLead();

    const chips = chipsOf(container);
    expect(chips).toHaveLength(6);
    for (const chip of chips) expect(chip).toHaveClass('grow', 'max-w-max');
  });
});

describe('a wrapped line starts flush, like the first (objectui#12523)', () => {
  it('gives EVERY chip the separator, the first one included', () => {
    const { container } = renderLead();

    for (const chip of chipsOf(container)) {
      expect(chip).toHaveClass('border-l', 'px-5');
      expect(chip).not.toHaveClass('first:border-l-0');
      expect(chip).not.toHaveClass('first:pl-0');
    }
  });

  it('pulls the row left by one separator and clips only the left edge, from `sm` up', () => {
    const { container } = renderLead();

    const row = chipsOf(container)[0].parentElement;
    expect(row).toHaveClass('flex', 'flex-wrap');
    expect(row).toHaveClass('sm:-ml-[calc(var(--spacing)*5+1px)]');
    expect(row).toHaveClass(
      'sm:[clip-path:inset(-100vmax_-100vmax_-100vmax_calc(var(--spacing)*3.5+1px))]',
    );
  });
});

describe('below `sm` the strip is one layout (objectui#12523)', () => {
  it('gives all six chips of the measured lead the same full-width line', () => {
    const { container } = renderLead();

    const chips = chipsOf(container);
    expect(chips).toHaveLength(6);
    for (const chip of chips) expect(chip).toHaveClass(...PHONE_LAYOUT);
  });

  it('keeps that layout on a chip that widened to edit', () => {
    render(
      <InlineEditProvider canEdit>
        <HeaderHighlight
          fields={[
            { name: 'name', label: 'Name', type: 'text' },
            { name: 'code', label: 'Code', type: 'text' },
          ]}
          data={{ name: 'Alice', code: 'A-1' }}
        />
      </InlineEditProvider>,
    );

    fireEvent.doubleClick(screen.getByText('Alice'));

    const editChip = chipAround(screen.getByDisplayValue('Alice'));
    expect(editChip).toHaveClass('basis-[16rem]');
    expect(editChip).toHaveClass(...PHONE_LAYOUT);
    expect(chipAround(screen.getByDisplayValue('A-1'))).toHaveClass(...PHONE_LAYOUT);
  });
});
