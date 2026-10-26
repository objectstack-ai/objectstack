// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's identity moves into the top bar's app pill (objectui#12201,
 * maintainer ruling of 2026-10-12, items 1, 2, 4 and 6).
 *
 * - The pill draws the active app's `branding.logo` LEFT of the app's name.
 * - Every dropdown row carries its app's glyph: the logo, or — for an app with
 *   no `branding.logo` — its `icon` on a tile, coloured by its own
 *   `branding.primaryColor` when that is a hex, neutral otherwise.
 * - The dropdown ends with the way back to Home, 「All apps」, and, for a
 *   viewer the top bar offers its Studio button to, 「Edit APP in Studio」 to
 *   the button's own target.
 *
 * Real subjects: `AppSwitcher`, `AppMark` and its colour derivation
 * (`appTileColors`), the real
 * route matching and the real `useHomePath`. The dropdown primitives pass
 * through so the menu CONTENT renders without radix's open/close machinery —
 * the idiom of `AppSwitcher.publishState.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

type MockProps = Record<string, unknown> & { children?: ReactNode; onClick?: () => void; className?: string };

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: MockProps) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: MockProps) => <div data-testid="app-switcher-trigger-slot">{p.children}</div>,
  DropdownMenuContent: (p: MockProps) => <div data-testid="app-switcher-menu">{p.children}</div>,
  DropdownMenuItem: ({ onClick, children, asChild: _asChild, className: _c, ...rest }: MockProps) => (
    <div data-menu-row="" onClick={onClick} {...rest}>{children}</div>
  ),
  DropdownMenuLabel: (p: MockProps) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
// `getIcon` wraps lucide's DynamicIcon (a per-icon dynamic import); stub it so
// no unbounded module load races the assertions. The stub names the icon it
// was asked for, so the tile can be read for WHICH glyph it drew.
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => (p: MockProps) => <svg data-icon={name ?? '(none)'} className={p.className} />,
}));

vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string; app?: string }) =>
        (o?.defaultValue ?? key).replace('{{app}}', o?.app ?? ''),
    }),
    useObjectLabel: () => ({
      appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
    }),
  };
});

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps }),
}));

import { AppSwitcher } from '../AppSwitcher';
import { appTileColors } from '../appTileColors';

const LOGO = 'https://cdn.example.test/hotcrm-icon.svg';
const HOTCRM = { name: 'hotcrm', label: 'HotCRM', icon: 'flame', branding: { logo: LOGO, primaryColor: '#ea580c' } };
const PROJECTS = { name: 'projects', label: 'Projects', icon: 'kanban', branding: { primaryColor: '#2563eb' } };
const PLAIN = { name: 'plain', label: 'Plain', icon: 'box' };

function renderSwitcher(active: string, designInStudioPath?: string | null) {
  return render(
    <MemoryRouter>
      <AppSwitcher activeAppName={active} onAppChange={vi.fn()} designInStudioPath={designInStudioPath} />
    </MemoryRouter>,
  );
}

const menu = () => within(screen.getByTestId('app-switcher-menu'));
const pill = () => screen.getByTestId('app-switcher-trigger');

beforeEach(() => {
  apps = [HOTCRM, PROJECTS, PLAIN];
});

describe('the top-bar app pill carries the app icon left of its name (objectui#12201)', () => {
  it('draws the active app\'s `branding.logo` before the label', () => {
    renderSwitcher('hotcrm');
    const trigger = pill();
    const logo = within(trigger).getByTestId('app-mark-logo');
    expect(logo).toHaveAttribute('src', LOGO);
    // 22 px in the pill (ruling item 1).
    expect(logo.className).toContain('size-[22px]');
    const label = within(trigger).getByText('HotCRM');
    // The icon sits LEFT of the name: it precedes the label in document order.
    expect(logo.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the glyph is decorative — the pill is named by the app\'s label alone', () => {
    renderSwitcher('hotcrm');
    expect(within(pill()).getByTestId('app-mark-logo')).toHaveAttribute('alt', '');
    expect(pill()).toHaveTextContent(/^HotCRM$/);
  });

  it('an active app without `branding.logo` gets its `icon` tile in the pill', () => {
    renderSwitcher('projects');
    const tile = within(pill()).getByTestId('app-mark-tile');
    expect(tile.querySelector('svg')).toHaveAttribute('data-icon', 'kanban');
    expect(within(pill()).queryByTestId('app-mark-logo')).not.toBeInTheDocument();
  });
});

describe('every switcher row carries its app\'s glyph (objectui#12201)', () => {
  it('each app row has exactly one glyph — the logo, or the fallback tile', () => {
    renderSwitcher('hotcrm');
    for (const app of [HOTCRM, PROJECTS, PLAIN]) {
      const row = menu().getByTestId(`app-switcher-row-${app.name}`);
      const glyphs = row.querySelectorAll('[data-testid="app-mark-logo"], [data-testid="app-mark-tile"]');
      expect(glyphs, app.name).toHaveLength(1);
    }
    expect(within(menu().getByTestId('app-switcher-row-hotcrm')).getByTestId('app-mark-logo')).toHaveAttribute('src', LOGO);
  });

  it('FALLBACK — an app without a logo shows its `icon` on its OWN `primaryColor` tile', () => {
    renderSwitcher('hotcrm');
    const tile = within(menu().getByTestId('app-switcher-row-projects')).getByTestId('app-mark-tile');
    expect(tile.querySelector('svg')).toHaveAttribute('data-icon', 'kanban');
    // The author's colour reaches the tile only as custom properties that the
    // static utilities read (AGENTS.md section 2); light and dark both declared.
    expect(tile.className).toContain('bg-[color:var(--os-app-tile-bg)]');
    expect(tile.className).toContain('dark:bg-[color:var(--os-app-tile-bg-dark)]');
    expect(tile.style.getPropertyValue('--os-app-tile-bg')).toBe('hsl(221 83% 53%)');
    expect(tile.style.getPropertyValue('--os-app-tile-bg-dark')).not.toBe('');
    // ⛔ never the colour painted straight in.
    expect(tile.style.backgroundColor).toBe('');
    // Not the active app's colour: HotCRM's orange is not this row's.
    expect(tile.style.getPropertyValue('--os-app-tile-bg')).not.toBe(appTileColors(HOTCRM.branding.primaryColor)!.bg);
  });

  it('CONTROL — an app declaring neither a logo nor a colour gets the neutral tile, still with its icon', () => {
    renderSwitcher('hotcrm');
    const tile = within(menu().getByTestId('app-switcher-row-plain')).getByTestId('app-mark-tile');
    expect(tile.querySelector('svg')).toHaveAttribute('data-icon', 'box');
    expect(tile.className).toContain('bg-muted');
    expect(tile.className).not.toContain('--os-app-tile-bg');
    expect(tile.getAttribute('style')).toBeNull();
  });

  it('a logo that fails to load falls back to the icon tile instead of a broken image', () => {
    renderSwitcher('hotcrm');
    const row = menu().getByTestId('app-switcher-row-hotcrm');
    fireEvent.error(within(row).getByTestId('app-mark-logo'));
    const tile = within(row).getByTestId('app-mark-tile');
    expect(tile.querySelector('svg')).toHaveAttribute('data-icon', 'flame');
    expect(within(row).queryByTestId('app-mark-logo')).not.toBeInTheDocument();
  });
});

describe('the dropdown ends with the way back to Home and the admin Studio row (objectui#12201)', () => {
  it('「All apps」 links to the declared home', () => {
    apps = [HOTCRM, { ...PROJECTS, isDefault: true }];
    renderSwitcher('hotcrm');
    const allApps = menu().getByTestId('app-switcher-all-apps');
    expect(allApps).toHaveTextContent('All apps');
    // `useHomePath` — the app declared `isDefault`, not a literal launcher path.
    expect(allApps).toHaveAttribute('href', '/apps/projects');
  });

  it('with the bridge target, the LAST row is 「Edit APP in Studio」 to that very target', () => {
    renderSwitcher('hotcrm', '/studio/com.acme.hotcrm/data');
    const rows = [...screen.getByTestId('app-switcher-menu').querySelectorAll('[data-menu-row]')];
    const last = rows[rows.length - 1];
    const studio = menu().getByTestId('app-switcher-edit-in-studio');
    expect(last).toContainElement(studio);
    expect(studio).toHaveTextContent('Edit HotCRM in Studio');
    expect(studio).toHaveAttribute('href', '/studio/com.acme.hotcrm/data');
    // 「All apps」 sits right before it.
    expect(rows[rows.length - 2]).toContainElement(menu().getByTestId('app-switcher-all-apps'));
  });

  it('without a bridge target (a member, or an app no package owns) there is no Studio row', () => {
    renderSwitcher('hotcrm', null);
    expect(menu().queryByTestId('app-switcher-edit-in-studio')).not.toBeInTheDocument();
    expect(menu().getByTestId('app-switcher-all-apps')).toBeInTheDocument();
  });
});

describe('`appTileColors` — the fallback tile\'s colours from `branding.primaryColor` (objectui#12201)', () => {
  it('declares no colour for a non-hex or absent value — the neutral tile applies', () => {
    expect(appTileColors(undefined)).toBeUndefined();
    expect(appTileColors('orange')).toBeUndefined();
    expect(appTileColors('#zzzzzz')).toBeUndefined();
    expect(appTileColors(42)).toBeUndefined();
  });

  it('light theme: the declared colour, with the foreground that contrasts more', () => {
    // A deep blue reads best with white; a pale yellow with near-black.
    expect(appTileColors('#1e3a8a')).toMatchObject({ bg: 'hsl(224 64% 33%)', fg: '#ffffff' });
    expect(appTileColors('#fde68a')?.fg).toBe('#0f172a');
  });

  it('dark theme: lifted to the lightness floor the console gives `--primary` on dark, near-black glyph', () => {
    expect(appTileColors('#1e3a8a')).toMatchObject({ bgDark: 'hsl(224 64% 65%)', fgDark: '#0f172a' });
    // Already light enough: the lightness is kept (77 %), and its very
    // saturated hue (97 %) is eased back, as is pure red's.
    expect(appTileColors('#fde68a')?.bgDark).toBe('hsl(48 87% 77%)');
    expect(appTileColors('#ff0000')?.bgDark).toBe('hsl(0 90% 65%)');
  });
});
