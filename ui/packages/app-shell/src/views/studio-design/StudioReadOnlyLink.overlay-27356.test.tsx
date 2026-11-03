// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27356 row 13 (hotcrm#2320 Studio S2) — the read-only mark in a Studio item
 * header used to offer an environment overlay where the served registry marks
 * a type `allowEnvironmentOverlay`: "Read-only · Customize with an overlay",
 * linking to that item's overlay page (Setup's once, then that page in
 * Studio's "All metadata" area, ADR-0146 D1).
 *
 * objectstack#28562 (ADR-0146 D2) took a view, a dashboard and a report off
 * that link: Studio customizes those itself, into the base's paired
 * customization package.
 *
 * objectstack#28576 (ADR-0146 D11) — and now no item keeps it: that page's
 * save names no package, and the server refuses that write onto a packaged item.
 * Every case gets a plain "Read-only" that links nowhere, an overlay-able
 * type (`email_template`, `translation`) included, whatever the registry says.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const registry = { entries: [] as Array<{ type: string; allowEnvironmentOverlay?: boolean }> };

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => ({}),
    useMetadataTypes: () => ({ loading: false, error: null, entries: registry.entries }),
  };
});

import { StudioReadOnlyLink } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const LINK = t('engine.studio.pkg.readonlyLink', 'en');
const READ_ONLY = t('engine.studio.pkg.readonly', 'en');
const SERVED = [
  { type: 'view', allowEnvironmentOverlay: true },
  { type: 'dashboard', allowEnvironmentOverlay: true },
  { type: 'report', allowEnvironmentOverlay: true },
  { type: 'email_template', allowEnvironmentOverlay: true },
  { type: 'page', allowEnvironmentOverlay: false },
  { type: 'object', allowEnvironmentOverlay: false },
];

function renderMark(item: { type: string; name: string } | null) {
  render(
    <MemoryRouter>
      <StudioReadOnlyLink item={item} title="hint" locale="en" />
    </MemoryRouter>,
  );
  return screen.getByTestId('studio-readonly-link');
}

afterEach(() => {
  cleanup();
  registry.entries = [];
});

describe('the read-only mark offers no overlay on any packaged item (objectstack#28576)', () => {
  it.each([
    ['an open email template (overlay-able, Studio does not customize it)', { type: 'email_template', name: 'welcome' }],
    ['an open view (Studio customizes it, objectstack#28562)', { type: 'view', name: 'open_tickets' }],
    ['an open dashboard (Studio customizes it, objectstack#28562)', { type: 'dashboard', name: 'pipeline' }],
    ['an open report (Studio customizes it, objectstack#28562)', { type: 'report', name: 'won_deals' }],
    ['an open page (no overlay)', { type: 'page', name: 'home' }],
    ['an open object (no overlay)', { type: 'object', name: 'account' }],
    ['no open item', null],
  ] as const)('%s: a plain "Read-only" that links nowhere', (_case, item) => {
    registry.entries = SERVED;
    const mark = renderMark(item);
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveTextContent(READ_ONLY);
    expect(mark).not.toHaveTextContent(LINK);
    expect(mark).not.toHaveAttribute('href');
    expect(screen.queryByRole('link')).toBeNull();
    expect(mark).toHaveAttribute('title', 'hint');
  });

  it('a registry not read yet: a plain "Read-only" too', () => {
    const mark = renderMark({ type: 'email_template', name: 'welcome' });
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveTextContent(READ_ONLY);
  });
});
