// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12463 — the console inset's half of the list page's bounded height
 * chain, and the pages that keep scrolling the inset.
 *
 * Measured in a real browser before the change (the PR carries the
 * readings): with any banner above the route (a preview bar, a notification
 * banner), the object list page — `h-full`, scrolling inside its own table
 * box — was 100% of the inset PLUS the banner, so the inset overflowed by the
 * banner's height: a second scroller over the table's own, the record-count
 * footer below the fold, and the page header scrolling away once the table
 * reached its end. From `lg` up the inset is now a flex column: the banners
 * in one non-shrinking box, and the route content in ONE route slot, the only
 * child allowed below its content height (`min-h-0`), so a bounded page takes
 * the height left after the banners.
 *
 * Pages that rely on the inset scroll — natural-height pages such as search
 * results and the marketplace — sit inside the block route slot, keep their
 * full height (not squeezed to the inset's) and keep the inset scrolling with
 * the same scroll height; a `sticky` element inside them stays stuck past the
 * first viewport (browser reading on the PR). Forcing `min-h-0` on EVERY inset
 * child instead would squeeze a page root placed directly in the column, so
 * the inset must not carry such a class. jsdom does no layout, so what is
 * pinned here is the class contract the browser reading rests on.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell`; the chrome it mounts and this card
 * does not touch is stubbed, the banners as markers.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => <div data-testid="app-header-stub" /> }));
vi.mock('../ConsoleNotificationBanners', () => ({
  ConsoleNotificationBanners: () => <div data-testid="notification-banner" />,
}));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => <div data-testid="draft-preview-bar" /> }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function mountConsole(page: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          {page}
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe('the console inset bounds a self-scrolling page below the banners (objectui#12463)', () => {
  it('from lg up the inset is a flex column; the route sits in ONE slot that may shrink; it still scrolls on y', () => {
    mountConsole(<div data-testid="route-content" className="h-full">list page</div>);
    const page = screen.getByTestId('route-content');
    const slot = page.parentElement as HTMLElement;
    expect(slot).toHaveAttribute('data-testid', 'console-route');
    expect(slot).toHaveClass('h-full', 'lg:min-h-0');
    const inset = slot.parentElement as HTMLElement;
    // A plain element inside the shell's one `main` landmark (objectui#13334).
    expect(inset.tagName).toBe('DIV');
    expect(inset.closest('main')).not.toBeNull();
    expect(inset).toHaveClass('lg:flex', 'lg:flex-col');
    expect(inset).toHaveClass('overflow-y-auto', 'overflow-x-hidden');
    // The phone keeps block layout: no unprefixed flex on the inset.
    expect(inset).not.toHaveClass('flex');
  });

  it('the banners sit in ONE non-shrinking box, above the route page, both children of the inset', () => {
    mountConsole(<div data-testid="route-content" className="h-full">list page</div>);
    const banners = screen.getByTestId('console-banners');
    const page = screen.getByTestId('route-content');
    expect(banners).toHaveClass('shrink-0');
    expect(banners).toContainElement(screen.getByTestId('draft-preview-bar'));
    expect(banners).toContainElement(screen.getByTestId('notification-banner'));
    const slot = screen.getByTestId('console-route');
    expect(slot).toContainElement(page);
    expect(banners.parentElement).toBe(slot.parentElement);
    expect(banners.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a natural-height page (relies on the inset scroll) is not squeezed: no class forces min-height on the inset children, and the page sits in the block route slot', () => {
    mountConsole(
      <div data-testid="natural-page" className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="h-[2000px]">search results</div>
      </div>,
    );
    const page = screen.getByTestId('natural-page');
    const slot = page.parentElement as HTMLElement;
    expect(slot).toHaveAttribute('data-testid', 'console-route');
    const inset = slot.parentElement as HTMLElement;
    // A plain element inside the shell's one `main` landmark (objectui#13334).
    expect(inset.tagName).toBe('DIV');
    expect(inset.closest('main')).not.toBeNull();
    expect(inset).toHaveClass('overflow-y-auto');
    // No arbitrary child variant on the inset (`[&>*]:min-h-0`, `[&>*]:shrink`,
    // …): a natural-height page root placed in the column would be squeezed.
    const childVariants = Array.from(inset.classList).filter((c) => c.includes('[&>'));
    expect(childVariants).toEqual([]);
    // The slot is a block box: it is not a flex container that would make the
    // page a shrinkable flex item.
    expect(slot.className).not.toMatch(/(^|\s)(lg:)?(flex|grid)(\s|$)/);
    // Nothing the inset adds caps the page's own height or clips it.
    expect(page.className).not.toMatch(/overflow-hidden|h-full|max-h/);
  });
});
