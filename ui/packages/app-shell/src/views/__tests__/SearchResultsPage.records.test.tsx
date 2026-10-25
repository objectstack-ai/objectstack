/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The full-page search (`/apps/:app/search`) must surface record hits from the
 * global search endpoint — not just metadata nav items — grouped by object,
 * with the object's i18n-resolved label as the heading and a link to the
 * record page (issue #3371 follow-up). We drive it with a stubbed
 * `useRecordSearch` so the assertions cover the page's rendering/wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  useSearchParams: () => [new URLSearchParams('q=wayne'), vi.fn()],
  // Render Link as a plain anchor so we can assert the resolved href.
  Link: ({ to, children, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    // Echo the i18n defaultValue (or key), enough to resolve `{key,defaultValue}`.
    useObjectTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  // Hits are inlined here (not a shared const) so the hoisted factory doesn't
  // reference an uninitialized outer binding.
  const recordHits = [
    {
      objectName: 'crm_account',
      // Deliberately the raw name — the page should display the i18n-resolved
      // label from the object def instead of this.
      objectLabel: 'crm_account',
      recordId: 'a1',
      display: 'Wayne Enterprises',
      subtitle: 'ACC-000005',
      icon: 'Building2',
      score: 80,
      raw: {},
    },
    {
      objectName: 'crm_opportunity',
      objectLabel: 'crm_opportunity',
      recordId: 'o1',
      display: 'Wayne Q1 Expansion',
      icon: 'Target',
      score: 60,
      raw: {},
    },
  ];
  return {
    ...actual,
    useRecordSearch: () => ({ results: recordHits, isSearching: false, error: undefined }),
  };
});

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        navigation: [
          { id: 'n1', type: 'object', objectName: 'crm_account', label: 'Accounts' },
        ],
      },
    ],
    objects: [
      { name: 'crm_account', label: { key: 'object.crm_account', defaultValue: 'Accounts' }, icon: 'Building2' },
      { name: 'crm_opportunity', label: { key: 'object.crm_opportunity', defaultValue: 'Opportunities' }, icon: 'Target' },
    ],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: vi.fn(), searchAll: vi.fn() }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { SearchResultsPage } from '../SearchResultsPage';

describe('SearchResultsPage — record hits', () => {
  it('renders record hits grouped by object with i18n-resolved headings and record links', () => {
    render(<SearchResultsPage />);

    // Record display names are shown.
    expect(screen.getByText('Wayne Enterprises')).toBeInTheDocument();
    expect(screen.getByText('Wayne Q1 Expansion')).toBeInTheDocument();

    // Group headings use the i18n-resolved object label (defaultValue), not the
    // hit's raw `objectLabel` (which was the object name).
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Opportunities')).toBeInTheDocument();

    // The account hit links to the record page under the current app.
    const link = screen.getByText('Wayne Enterprises').closest('a');
    expect(link).toHaveAttribute('href', '/apps/crm/crm_account/record/a1');

    // The snippet renders as a secondary line.
    expect(screen.getByText('ACC-000005')).toBeInTheDocument();
  });
});
