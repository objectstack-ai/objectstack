/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BookSidebar } from './BookSidebar';
import type { ResolvedBook } from './book-nav';

afterEach(cleanup);

const book: ResolvedBook = {
  name: 'crm_manual',
  label: 'CRM Manual',
  groups: [
    {
      key: 'start',
      label: 'Getting started',
      entries: [
        { doc: 'crm_intro', label: 'Intro' },
        { separator: true },
        { href: 'https://example.com', label: 'External' },
      ],
    },
    { key: 'extra', label: 'Extra', synthetic: true, entries: [{ doc: 'misc_note', label: 'Note' }] },
  ],
};

function renderSidebar(activeDoc?: string) {
  return render(
    <MemoryRouter>
      <BookSidebar book={book} activeDoc={activeDoc} docHref={(n) => `/docs/${n}`} />
    </MemoryRouter>,
  );
}

describe('BookSidebar', () => {
  it('renders the book label and group headings', () => {
    renderSidebar();
    expect(screen.getByText('CRM Manual')).toBeInTheDocument();
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('Extra')).toBeInTheDocument();
  });

  it('renders doc links to the resolved href', () => {
    renderSidebar();
    const link = screen.getByRole('link', { name: 'Intro' });
    expect(link).toHaveAttribute('href', '/docs/crm_intro');
  });

  it('marks the active doc with aria-current', () => {
    renderSidebar('crm_intro');
    expect(screen.getByRole('link', { name: 'Intro' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Note' })).not.toHaveAttribute('aria-current');
  });

  it('renders external links with target=_blank', () => {
    renderSidebar();
    const ext = screen.getByRole('link', { name: /External/ });
    expect(ext).toHaveAttribute('href', 'https://example.com');
    expect(ext).toHaveAttribute('target', '_blank');
  });

  it('renders a separator as a non-interactive divider', () => {
    renderSidebar();
    // The "Getting started" group has 2 links (Intro + External) and 1 separator.
    const startNav = screen.getByLabelText('CRM Manual');
    expect(within(startNav).getAllByRole('link').length).toBe(3); // Intro, External, Note
  });
});
