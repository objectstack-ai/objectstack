// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 (#28130 child 2a) — the read-only mark in a Studio item header
 * links nowhere. #27356 row 13 made it a link to the item's Setup page for an
 * overlay type, the transitional form ADR-0146 retires with phase 2: an item
 * a read-only package lets this environment customize is edited in place in
 * its pillar (`InterfacesPillar.overlayInPlace-28147.test.tsx`), so there is
 * no second editor to send the reader to.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { StudioReadOnlyLink } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

describe('the read-only mark is a plain mark (ADR-0146 D2)', () => {
  it('reads "Read-only", carries its title, and is no link', () => {
    render(
      <MemoryRouter>
        <StudioReadOnlyLink title="hint" locale="en" />
      </MemoryRouter>,
    );
    const mark = screen.getByTestId('studio-readonly-link');
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveTextContent(t('engine.studio.pkg.readonly', 'en'));
    expect(mark).not.toHaveAttribute('href');
    expect(mark).toHaveAttribute('title', 'hint');
    expect(document.querySelector('a')).toBeNull();
  });
});
