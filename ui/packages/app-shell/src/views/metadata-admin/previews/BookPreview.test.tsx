// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { BookPreview } from './BookPreview';

afterEach(cleanup);

/** Minimal helper — BookPreview only reads `name` + `draft`. */
function renderBook(draft: Record<string, unknown>, name = '') {
  return render(<BookPreview type="book" name={name} draft={draft} />);
}

describe('BookPreview', () => {
  it('prompts for a name before anything is authored', () => {
    renderBook({});
    expect(screen.getByText('Name your book')).toBeInTheDocument();
  });

  it('warns when a named book has no groups', () => {
    renderBook({ name: 'crm_manual', label: 'CRM Manual' });
    expect(screen.getByText('CRM Manual')).toBeInTheDocument();
    expect(screen.getByText('No groups yet')).toBeInTheDocument();
  });

  it('renders identity + a derived-membership group with its include glob', () => {
    renderBook({
      name: 'crm_manual',
      label: 'CRM Manual',
      slug: 'manual',
      audience: 'public',
      groups: [{ key: 'guides', label: 'Guides', include: 'crm_guide_*' }],
    });
    expect(screen.getByText('CRM Manual')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument(); // audience chip
    expect(screen.getByText('Guides')).toBeInTheDocument();
    expect(screen.getByText('crm_guide_*')).toBeInTheDocument(); // include glob chip
    expect(screen.getByText(/Members derived from the rule/)).toBeInTheDocument();
  });

  it('renders a tag include rule', () => {
    renderBook({
      name: 'crm_manual',
      groups: [{ key: 'start', label: 'Getting started', include: { tag: 'getting-started' } }],
    });
    expect(screen.getByText('getting-started')).toBeInTheDocument();
  });

  it('renders an explicit pages override incl. separator, rest, badge and external link', () => {
    renderBook({
      name: 'crm_manual',
      groups: [
        {
          key: 'curated',
          label: 'Curated',
          pages: [
            'crm_intro',
            '---',
            { doc: 'crm_advanced', label: 'Advanced', badge: 'beta' },
            { href: 'https://example.com/api', label: 'API ref' },
            '...',
          ],
        },
      ],
    });
    expect(screen.getByText('crm_intro')).toBeInTheDocument();
    expect(screen.getByText('separator')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('API ref')).toBeInTheDocument();
    expect(screen.getByText(/…rest/)).toBeInTheDocument();
  });

  it('flags a group that can never match (no include, no pages)', () => {
    renderBook({
      name: 'crm_manual',
      groups: [{ key: 'orphan', label: 'Orphan' }],
    });
    expect(screen.getByText(/matches\s*nothing/)).toBeInTheDocument();
  });

  it('orders groups by their `order` then authored index', () => {
    renderBook({
      name: 'crm_manual',
      groups: [
        { key: 'second', label: 'Second', order: 2, include: 'b_*' },
        { key: 'first', label: 'First', order: 1, include: 'a_*' },
      ],
    });
    const labels = screen.getAllByText(/First|Second/).map((el) => el.textContent);
    expect(labels[0]).toBe('First');
    expect(labels[1]).toBe('Second');
  });

  it('degrades gracefully on a malformed draft instead of throwing', () => {
    expect(() =>
      renderBook({ name: 'crm_manual', groups: 'not-an-array' as unknown }),
    ).not.toThrow();
    expect(screen.getByText('No groups yet')).toBeInTheDocument();
  });
});
