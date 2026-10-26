// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12791 — a long api-name chip gives way before the Studio item
 * title: it truncates first, its full name in its tooltip, and the title
 * keeps 200 px.
 *
 * jsdom has no layout, so the widths are measured in Chromium by
 * `e2e/studio-item-header-title-width.spec.ts`. This file pins what the
 * widths rest on and what jsdom can read: the chip still carries the whole
 * name (a cut chip is cut by CSS, not by its text), its tooltip says that
 * name through the status chip's mechanism (a focusable trigger), and the
 * identity keeps its order (title, api chip, chips) and its place.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workflow } from 'lucide-react';
import { StudioItemHeader } from './StudioItemHeader';
import { STUDIO_API_CHIP, STUDIO_KIND_CHIP } from './studio-tokens';

afterEach(() => {
  cleanup();
});

/** The card's draft object, with a 38-character api name. */
const TITLE = 'Service Territory Assignment 105';
const API_NAME = 'probe_service_territory_assignment_105';

function Header({ apiName = API_NAME }: { apiName?: string }) {
  return (
    <StudioItemHeader
      testId="hdr"
      icon={Workflow}
      title={TITLE}
      titleProps={{ 'data-testid': 'hdr-title' }}
      apiName={apiName}
      chips={
        <span className={STUDIO_KIND_CHIP} data-testid="hdr-kind-chip">
          Custom
        </span>
      }
      status={{ label: 'Unpublished draft' }}
      meta={<span>12 fields</span>}
      actions={<button type="button">Publish</button>}
    />
  );
}

describe('the api-name chip gives way before the item title (objectui#12791)', () => {
  it('the chip carries the whole api name, and its tooltip says it', async () => {
    render(<Header />);
    const chip = screen.getByTestId('studio-item-api-name');
    expect(chip.tagName).toBe('CODE');
    // The text is never shortened: the cut is the chip's `truncate`, so a
    // reader and the tooltip both get the whole name.
    expect(chip.textContent).toBe(API_NAME);
    expect(chip).toHaveClass(...STUDIO_API_CHIP.split(' '));
    expect(chip).toHaveClass('truncate');
    // The status chip's mechanism (objectui#12611): a focusable trigger.
    expect(chip).toHaveAttribute('tabindex', '0');
    await userEvent.setup().hover(chip);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(API_NAME);
  });

  it('keyboard focus opens the same tooltip', async () => {
    render(<Header />);
    const user = userEvent.setup();
    // The api chip is the header's first tab stop: it comes before the status chip.
    await user.tab();
    expect(screen.getByTestId('studio-item-api-name')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(API_NAME);
  });

  it('the identity keeps its order and place: the title, then the api chip, then the chips, before the status', () => {
    render(<Header />);
    const title = screen.getByTestId('hdr-title');
    const row = title.parentElement as HTMLElement;
    const identity = row.querySelector('[data-slot="identity-chips"]') as HTMLElement;
    const chip = screen.getByTestId('studio-item-api-name');
    const kind = screen.getByTestId('hdr-kind-chip');
    // The title stays a direct child of the row, and the chips sit in the
    // `contents` wrapper right after it (objectui#12524).
    expect(title.tagName).toBe('H1');
    expect(identity).toHaveClass('contents');
    expect(Array.from(row.children).indexOf(identity)).toBe(Array.from(row.children).indexOf(title) + 1);
    // The api chip first in the wrapper, then the chips (objectui#11665, objectui#7254).
    expect(Array.from(identity.children)).toEqual([chip, kind]);
    expect(row.children[Array.from(row.children).indexOf(identity) + 1]).toBe(screen.getByTestId('studio-item-status'));
  });

  it('CONTROL: the chips after the api chip keep their own token, which does not shrink', () => {
    render(<Header />);
    expect(screen.getByTestId('hdr-kind-chip')).toHaveClass('shrink-0');
  });

  it('CONTROL: without an api name there is no chip and no tooltip trigger', () => {
    render(<Header apiName="" />);
    expect(screen.queryByTestId('studio-item-api-name')).toBeNull();
    expect(screen.getByTestId('hdr').querySelector('code')).toBeNull();
  });
});
