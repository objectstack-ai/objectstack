// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27356 row 13 (hotcrm#2320 Studio S2) — the read-only mark in a Studio item
 * header offers an environment overlay only where one exists: an open item
 * whose type the served registry marks `allowEnvironmentOverlay` gets
 * "Read-only · Customize with an overlay", linking to that item's Setup page.
 * Every other case (a type that takes no overlay, no open item, a registry not
 * read) gets a plain "Read-only" that links nowhere.
 *
 * objectstack#28562 (ADR-0146 D2) — so do a view, a dashboard and a report,
 * overlay-able or not: Studio customizes those itself, into the base's paired
 * customization package, so Setup's overlay page is not their editor.
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

describe('the read-only mark offers an overlay only for a type that takes one (#27356 row 13)', () => {
  it('an open overlay-able item Studio does not customize: the overlay link, landing on that item’s Setup page', () => {
    registry.entries = SERVED;
    const mark = renderMark({ type: 'email_template', name: 'welcome' });
    expect(mark.tagName).toBe('A');
    expect(mark).toHaveTextContent(LINK);
    expect(mark).toHaveAttribute('href', '/apps/setup/metadata/email_template/welcome');
    expect(mark).toHaveAttribute('title', 'hint');
  });

  it.each([
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
    expect(mark).toHaveAttribute('title', 'hint');
  });

  it('a registry not read yet: no overlay promised, even for an overlay-able type', () => {
    const mark = renderMark({ type: 'email_template', name: 'welcome' });
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveTextContent(READ_ONLY);
  });
});
