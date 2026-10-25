// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11791 — the Studio Interfaces rail draws a `separator` and a leaf's
 * `badge` / `badgeVariant` as the running app's sidebar draws them.
 *
 * The sidebar this mirrors is `NavigationRenderer` in
 * `packages/layout/src/NavigationRenderer.tsx`, the renderer the console's
 * `UnifiedSidebar` mounts. Its decisions, read there when this card landed:
 *
 *  - a `separator` is a rule, not an entry: a decorative `Separator`, hidden
 *    from assistive tech (objectui#11690), no row and no link;
 *  - a present `badge` (`!= null`, so a count `0` too) is a `Badge` in the
 *    entry's row, its variant the entry's `badgeVariant`, an absent one
 *    `Badge`'s own default.
 *
 * The rail's `NavTree` had a group branch and a leaf branch only, so a
 * separator fell into the leaf branch: `resolveSurface` answers `null` for it,
 * and the row drew as a disabled, unlabeled button. `badge` was never read.
 *
 * This pin renders BOTH surfaces from one fixture and compares them, so a
 * change to the sidebar's decision turns it red here as well, naming the file
 * to mirror. The rail mirrors the decision, not the sidebar's markup: its rows
 * are buttons, the sidebar's are `SidebarMenu` links.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';
import { SidebarProvider, badgeVariants } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

const PKG = 'com.acme.app';

const NAV = [
  // The first leaf: the pillar opens it on load.
  { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
  // The card's showcase pair: a separator, then a report carrying `NEW`.
  { id: 'nav_sep_reports', type: 'separator' },
  {
    id: 'nav_report_summary',
    type: 'report',
    label: 'Hours by Status',
    reportName: 'hours_by_status',
    icon: 'sigma',
    badge: 'NEW',
    badgeVariant: 'secondary',
  },
  // A count with no variant: `Badge`'s own default on both surfaces.
  { id: 'nav_tasks', type: 'page', label: 'Tasks', pageName: 'tasks', badge: 3 },
  // A count of zero is a present badge.
  { id: 'nav_inbox', type: 'page', label: 'Inbox', pageName: 'inbox', badge: 0, badgeVariant: 'destructive' },
  {
    id: 'nav_more',
    type: 'group',
    label: 'More',
    children: [
      // Control: no badge, none drawn.
      { id: 'nav_alpha', type: 'page', label: 'Alpha', pageName: 'alpha' },
      { id: 'nav_sep_more', type: 'separator' },
      // No design surface, so a disabled rail row; it keeps its badge.
      { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com/docs', badge: 'ext', badgeVariant: 'outline' },
    ],
  },
];

/** The rows that carry a badge, by label, with the variant the sidebar must draw. */
const BADGED: ReadonlyArray<{ label: string; text: string; variant: string }> = [
  { label: 'Hours by Status', text: 'NEW', variant: 'secondary' },
  { label: 'Tasks', text: '3', variant: 'default' },
  { label: 'Inbox', text: '0', variant: 'destructive' },
  { label: 'Docs', text: 'ext', variant: 'outline' },
];

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'page') return { effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

afterEach(cleanup);

/** The Studio rail, once its rows have rendered; returns the rail's `nav`. */
async function renderRail(): Promise<HTMLElement> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
  // objectui#12455 — a page row is named by its label and its kind tag.
  const home = await screen.findByRole('button', { name: 'Home Page' }, { timeout: 8000 });
  const rail = home.closest('nav');
  expect(rail).not.toBeNull();
  return rail as HTMLElement;
}

/** The running app's sidebar over the same entries. */
function renderSidebar(): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={['/apps/acme_app']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={NAV as NavigationItem[]} basePath="/apps/acme_app" />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return container;
}

/** The row named by `label`: a rail button, or a sidebar link. */
const railRow = (rail: HTMLElement, label: string) =>
  within(rail).getByRole('button', { name: new RegExp(`^${label}\\b`) });
const sidebarRow = (sidebar: HTMLElement, label: string) =>
  within(sidebar).getByRole('link', { name: new RegExp(`^${label}\\b`) });

/**
 * The class tokens that tell each `Badge` variant apart, derived from
 * `badgeVariants` itself, so the classification follows the primitive.
 */
const VARIANTS = ['default', 'secondary', 'destructive', 'outline'] as const;
const tokensOf = (variant: (typeof VARIANTS)[number]) => new Set(badgeVariants({ variant }).split(/\s+/));
const DISTINCT: Record<string, string[]> = Object.fromEntries(
  VARIANTS.map((v) => {
    const others = VARIANTS.filter((o) => o !== v).flatMap((o) => [...tokensOf(o)]);
    return [v, [...tokensOf(v)].filter((tok) => !others.includes(tok))];
  }),
);

/** The one `Badge` inside `row` (a `div`: neither surface draws another in a row), and its variant. */
function badgeIn(row: HTMLElement): { text: string; variant: string } | null {
  const badges = Array.from(row.querySelectorAll('div'));
  expect(badges.length).toBeLessThanOrEqual(1);
  const badge = badges[0];
  if (!badge) return null;
  const matched = VARIANTS.filter((v) => DISTINCT[v].length > 0 && DISTINCT[v].every((tok) => badge.classList.contains(tok)));
  expect(matched).toHaveLength(1);
  return { text: badge.textContent ?? '', variant: matched[0] };
}

/** The drawn rules: the decorative `Separator` primitive's element. */
const rulesIn = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-orientation="horizontal"]'));

describe('the objectui#11791 fixture is what the spec accepts', () => {
  it('every nav item, separators and badges included, parses against NavigationItemSchema', () => {
    for (const item of NAV) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
  });

  it('the variant classification can tell all four variants apart', () => {
    for (const v of VARIANTS) expect(DISTINCT[v].length).toBeGreaterThan(0);
  });
});

describe('objectui#11791 — the rail draws a separator as the sidebar does (packages/layout/src/NavigationRenderer.tsx)', () => {
  it('a separator is a decorative rule in both, never a row, a link or an announced separator', async () => {
    const sidebar = renderSidebar();
    const sidebarRules = rulesIn(sidebar);
    // Measured on the sidebar first: one rule per separator, decorative.
    expect(sidebarRules).toHaveLength(2);
    for (const rule of sidebarRules) expect(rule).toHaveAttribute('role', 'none');
    expect(within(sidebar).queryAllByRole('separator')).toEqual([]);

    const rail = await renderRail();
    const railRules = rulesIn(rail);
    expect(railRules).toHaveLength(sidebarRules.length);
    for (const [i, rule] of railRules.entries()) {
      expect(rule.tagName).toBe(sidebarRules[i].tagName);
      expect(rule.getAttribute('role')).toBe(sidebarRules[i].getAttribute('role'));
      // Not a stop for the keyboard, and not inside a row.
      expect(rule).not.toHaveAttribute('tabindex');
      expect(rule.closest('button')).toBeNull();
    }
    expect(within(rail).queryAllByRole('separator')).toEqual([]);
  });

  it('the rail draws no unlabeled row: every button in it has a name, and only the url entry is disabled', async () => {
    const rail = await renderRail();
    const buttons = within(rail).getAllByRole('button') as HTMLButtonElement[];
    for (const button of buttons) expect(button).not.toHaveAccessibleName('');
    // The two separators drew as two more disabled, nameless buttons.
    expect(buttons.filter((b) => b.disabled)).toEqual([railRow(rail, 'Docs')]);
    // Every entry that is not a separator is still a row.
    for (const label of ['Home', 'Hours by Status', 'Tasks', 'Inbox', 'Alpha', 'Docs']) {
      expect(railRow(rail, label)).toBeInTheDocument();
    }
  });

  it('a rule is not selectable: clicking it leaves the open surface where it was', async () => {
    const rail = await renderRail();
    const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 8000 });
    expect(caption).toHaveTextContent('Home');
    fireEvent.click(rulesIn(rail)[0]);
    expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home');
  });
});

describe('objectui#11791 — the rail draws `badge` / `badgeVariant` as the sidebar does (packages/layout/src/NavigationRenderer.tsx)', () => {
  it('each badged entry: the same text, and the same variant the sidebar row draws', async () => {
    const sidebar = renderSidebar();
    const fromSidebar = BADGED.map(({ label }) => badgeIn(sidebarRow(sidebar, label)));
    // Measured on the sidebar first, so the comparison below can fail.
    expect(fromSidebar).toEqual(BADGED.map(({ text, variant }) => ({ text, variant })));

    const rail = await renderRail();
    expect(BADGED.map(({ label }) => badgeIn(railRow(rail, label)))).toEqual(fromSidebar);
  });

  it('control: an entry with no badge draws none on either surface', async () => {
    const sidebar = renderSidebar();
    expect(badgeIn(sidebarRow(sidebar, 'Alpha'))).toBeNull();
    expect(badgeIn(sidebarRow(sidebar, 'Home'))).toBeNull();

    const rail = await renderRail();
    expect(badgeIn(railRow(rail, 'Alpha'))).toBeNull();
    expect(badgeIn(railRow(rail, 'Home'))).toBeNull();
  });
});
