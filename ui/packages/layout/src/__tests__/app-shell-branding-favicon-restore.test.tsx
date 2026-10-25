/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useAppShellBranding` gives the favicon back when the shell goes away
 * (objectui#10040), the way it gives the title back (objectui#8637).
 *
 * ## Why this is the favicon half of the title restore
 *
 * The hook's one effect makes two branded writes to the document: the tab
 * title and the icon link's `href`. objectui#8637 scoped the title write to the
 * mount — capture, write, put back on cleanup — and removed the console's
 * route-keyed title reset, which had been the only thing taking a shell's title
 * back off the tab. The favicon write kept the old shape: written, never put
 * back. What still re-applies a favicon on navigation is the console's
 * `FaviconSync`, and it only writes when an operator favicon is configured, so
 * on a deployment without one a branded app's icon stayed on the tab after the
 * user left the app. The restore pinned here is the favicon's own
 * `app-shell-branding-title-restore.test.tsx`.
 *
 * ## Shape
 *
 * Every test starts from a known icon link in `document.head`, mounts the hook
 * alone (it is the writer; the shell chrome is irrelevant), and reads the
 * link's `href` ATTRIBUTE back — the bytes a page author wrote, not the URL the
 * `href` property resolves them to. The first block is the environment control
 * that makes the attribute/property distinction a measured fact in this DOM
 * rather than an assumption; without it the empty-`href` pin could not tell a
 * faithful restore from one that writes the resolved page URL back.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useAppShellBranding, type AppShellBranding } from '../AppShell';

const SENTINEL_HREF = '/sentinel-icon-before-the-shell-mounted.png';
const BRANDED_A = 'https://cdn.example.com/brand-a.svg';
const BRANDED_B = 'https://cdn.example.com/brand-b.svg';

/** Mounts only the hook — the actual favicon writer — with no shell chrome. */
function HookOnly({ branding, title }: { branding?: AppShellBranding; title?: string }) {
  useAppShellBranding(branding, title);
  return null;
}

/** Adds an icon link to `document.head`; `href: null` leaves the attribute out entirely. */
function addIconLink({ id, href }: { id?: string; href: string | null }): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'icon';
  if (id) link.id = id;
  if (href !== null) link.setAttribute('href', href);
  document.head.appendChild(link);
  return link;
}

function removeIconLinks() {
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
}

beforeEach(() => {
  removeIconLinks();
});

afterEach(() => {
  cleanup();
  removeIconLinks();
});

describe('environment control', () => {
  it('happy-dom reflects `link.href` writes into the attribute, and resolves an empty attribute to the page URL', () => {
    const link = addIconLink({ id: 'favicon', href: '' });
    // The console's own icon link ships `href=""`. Reading it through the
    // property hands back the resolved page URL, not the empty string — which
    // is why the restore must capture the attribute.
    expect(link.getAttribute('href')).toBe('');
    expect(link.href).not.toBe('');
    expect(link.href).toBe(document.location.href);

    link.href = BRANDED_A;
    expect(link.getAttribute('href')).toBe(BRANDED_A);
  });
});

describe('`useAppShellBranding` scopes the favicon to the mount (objectui#10040)', () => {
  it('writes `branding.favicon` to the icon link while the shell is mounted', () => {
    const link = addIconLink({ id: 'favicon', href: SENTINEL_HREF });
    render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    expect(link.getAttribute('href')).toBe(BRANDED_A);
  });

  it('unmounting puts back the icon that was there before the shell mounted', () => {
    const link = addIconLink({ id: 'favicon', href: SENTINEL_HREF });
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);

    view.unmount();

    expect(
      link.getAttribute('href'),
      [
        'The shell unmounted and left its branded favicon on the tab. The title half of the',
        'same effect is restored on cleanup (objectui#8637); the favicon half must be too, or a',
        "branded app's icon outlives the app wherever no route-keyed writer happens to re-apply",
        "one — the console's FaviconSync only writes when an operator favicon is configured.",
      ].join('\n'),
    ).toBe(SENTINEL_HREF);
  });

  it('switching branding A → B shows B, and the final unmount restores the pre-A icon, not A', () => {
    const link = addIconLink({ id: 'favicon', href: SENTINEL_HREF });
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    view.rerender(<HookOnly branding={{ favicon: BRANDED_B }} />);
    expect(link.getAttribute('href')).toBe(BRANDED_B);

    view.unmount();

    // The restore replays the value captured before the FIRST branded write,
    // not the one the shell itself put up a moment ago.
    expect(link.getAttribute('href')).toBe(SENTINEL_HREF);
  });

  it('a shell with no `favicon` writes no icon and restores nothing', () => {
    // The mirror of the title's "no `title` restores nothing": an absent
    // favicon must not turn the cleanup into a writer. Something else changes
    // the icon while this shell is mounted, and the shell leaves it be.
    const link = addIconLink({ id: 'favicon', href: SENTINEL_HREF });
    const view = render(<HookOnly branding={{ primaryColor: '#3B82F6' }} title="Sales CRM — ObjectStack" />);
    expect(link.getAttribute('href')).toBe(SENTINEL_HREF);

    link.setAttribute('href', '/written-by-someone-else.png');
    view.unmount();

    expect(link.getAttribute('href')).toBe('/written-by-someone-else.png');
  });
});

describe('the restore puts back the attribute bytes it found', () => {
  it('an empty `href` (the console icon link before an operator favicon exists) comes back empty, not as the page URL', () => {
    const link = addIconLink({ id: 'favicon', href: '' });
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    expect(link.getAttribute('href')).toBe(BRANDED_A);

    view.unmount();

    expect(
      link.getAttribute('href'),
      [
        'The restore wrote a different value than the one it replaced. Capturing through the',
        '`href` PROPERTY reads an empty attribute back as the resolved page URL, and restoring',
        'that points the tab icon at the page itself.',
      ].join('\n'),
    ).toBe('');
  });

  it('an icon link with no `href` attribute is left with none, rather than an invented empty one', () => {
    const link = addIconLink({ id: 'favicon', href: null });
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    expect(link.getAttribute('href')).toBe(BRANDED_A);

    view.unmount();

    expect(link.hasAttribute('href')).toBe(false);
  });

  it('restores the link it wrote when the page has only a `link[rel="icon"]` (no `#favicon`)', () => {
    const link = addIconLink({ href: SENTINEL_HREF });
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    expect(link.getAttribute('href')).toBe(BRANDED_A);

    view.unmount();

    expect(link.getAttribute('href')).toBe(SENTINEL_HREF);
  });

  it('a page with no icon link gets none — neither on mount nor on unmount', () => {
    const view = render(<HookOnly branding={{ favicon: BRANDED_A }} />);
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull();

    view.unmount();

    expect(document.head.querySelector('link[rel="icon"]')).toBeNull();
  });
});
