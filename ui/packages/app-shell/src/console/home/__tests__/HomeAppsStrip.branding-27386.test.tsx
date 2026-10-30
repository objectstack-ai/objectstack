// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27386 row 4 — a launcher tile draws the app's own branding.
 *
 * The 56 px icon square on Home (and the `app:launcher` block, which mounts the
 * same strip) follows the ladder `AppMark` uses in the top bar and the app
 * switcher: `branding.logo` when declared, else the app's `icon` on its
 * `branding.primaryColor` when that is a hex, else the `icon` on the name-keyed
 * gradient. A logo that fails to load falls back to the tile.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeAppsStrip } from '../HomeAppsStrip';
import { launcherIconGradient } from '../launcherTile';
import { appTileColors } from '../../../layout/appTileColors';

function renderStrip(apps: Record<string, unknown>[], favorites: { id: string }[] = []) {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <HomeAppsStrip
        apps={apps}
        favorites={favorites as any}
        onBrowseMarketplace={() => {}}
        isAdmin={false}
      />
    </MemoryRouter>,
  );
}

describe('HomeAppsStrip — tile branding (objectstack#27386 row 4)', () => {
  afterEach(cleanup);

  it('draws a declared hex primaryColor instead of the name-keyed gradient', () => {
    renderStrip([{ name: 'hotcrm', label: 'HotCRM', icon: 'Flame', branding: { primaryColor: '#ea580c' } }]);
    const icon = screen.getByTestId('app-tile-icon-hotcrm');
    expect(icon).toHaveAttribute('data-branded', 'true');
    expect(icon.className).not.toContain('bg-gradient-to-br');
    for (const cls of launcherIconGradient('hotcrm').split(' ')) expect(icon.className).not.toContain(cls);
    const colors = appTileColors('#ea580c')!;
    expect(icon.style.getPropertyValue('--os-app-tile-bg')).toBe(colors.bg);
    expect(icon.style.getPropertyValue('--os-app-tile-fg')).toBe(colors.fg);
    expect(icon.style.getPropertyValue('--os-app-tile-bg-dark')).toBe(colors.bgDark);
    expect(icon.style.getPropertyValue('--os-app-tile-fg-dark')).toBe(colors.fgDark);
  });

  it('keeps the name-keyed gradient when no usable colour is declared', () => {
    renderStrip([
      { name: 'plain', label: 'Plain', icon: 'Box' },
      // Not a hex: the spec's colour is a hex code, and `AppMark` reads only that.
      { name: 'named', label: 'Named', icon: 'Box', branding: { primaryColor: 'orange' } },
    ]);
    for (const name of ['plain', 'named']) {
      const icon = screen.getByTestId(`app-tile-icon-${name}`);
      expect(icon).not.toHaveAttribute('data-branded');
      expect(icon.className).toContain('bg-gradient-to-br');
      for (const cls of launcherIconGradient(name).split(' ')) expect(icon.className).toContain(cls);
      expect(icon.getAttribute('style')).toBeNull();
    }
  });

  it('draws a declared logo, and falls back to the coloured tile when it fails to load', () => {
    renderStrip(
      [{ name: 'hotcrm', label: 'HotCRM', icon: 'Flame', branding: { logo: '/logo.png', primaryColor: '#ea580c' } }],
      [{ id: 'app:hotcrm' }],
    );
    const logoBox = screen.getByTestId('app-tile-logo-hotcrm');
    const img = logoBox.querySelector('img');
    expect(img).toHaveAttribute('src', '/logo.png');
    expect(screen.queryByTestId('app-tile-icon-hotcrm')).toBeNull();
    // The favourite badge rides on the logo face too.
    expect(logoBox.querySelector('.bg-amber-400')).not.toBeNull();

    fireEvent.error(img!);
    expect(screen.queryByTestId('app-tile-logo-hotcrm')).toBeNull();
    const icon = screen.getByTestId('app-tile-icon-hotcrm');
    expect(icon).toHaveAttribute('data-branded', 'true');
    expect(icon.querySelector('.bg-amber-400')).not.toBeNull();
  });
});
