/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * kind:'html' anchor navigation (objectui#2638).
 *
 * Authored pages write app-root-relative hrefs (`apps/<app>/<object>`). A raw
 * `<a>` resolves those against `document.baseURI`, which 404s on deployments
 * without a host-injected `<base>` tag. The anchor renderer therefore routes
 * internal links through the SPA's navigation handler (url action) and leaves
 * external / fragment / new-tab / modified-click navigation to the browser.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { SchemaRenderer, ActionProvider } from '@object-ui/react';
import type { NavigationHandler } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

function renderAnchor(
  schema: { href: string; target?: string; children: string },
  onNavigate?: NavigationHandler,
) {
  const tree = <SchemaRenderer schema={{ type: 'a', ...schema }} />;
  return render(
    onNavigate ? (
      <ActionProvider onNavigate={onNavigate}>{tree}</ActionProvider>
    ) : (
      tree
    ),
  );
}

describe('html anchor internal-link navigation', () => {
  it('routes app-root-relative hrefs through the navigation handler', async () => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor(
      { href: 'apps/com.example.showcase/showcase_project', children: 'Projects' },
      onNavigate,
    );

    const notPrevented = fireEvent.click(getByText('Projects'));
    expect(notPrevented).toBe(false); // default was prevented — no raw browser navigation

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        '/apps/com.example.showcase/showcase_project',
        expect.objectContaining({ external: false, newTab: false }),
      ),
    );
  });

  it('keeps already-absolute paths as-is and preserves query + hash', async () => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor(
      { href: '/docs/showcase_tour_data?x=1#top', children: 'Tour' },
      onNavigate,
    );

    fireEvent.click(getByText('Tour'));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        '/docs/showcase_tour_data?x=1#top',
        expect.anything(),
      ),
    );
  });

  it('resolves ./ and ../ segments against the app root, not the current page', async () => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor(
      { href: '../docs/showcase_index', children: 'Manual' },
      onNavigate,
    );

    fireEvent.click(getByText('Manual'));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith('/docs/showcase_index', expect.anything()),
    );
  });

  it.each([
    ['https://example.com/x', 'external https'],
    ['mailto:hi@example.com', 'mailto'],
    ['//example.com/x', 'protocol-relative'],
    ['#section', 'in-page fragment'],
  ])('leaves %s (%s) to the browser', (href) => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor({ href, children: 'Link' }, onNavigate);

    const el = getByText('Link');
    // Prevent jsdom "navigation not implemented" noise without affecting the
    // renderer's own handler (capture runs on the container, after bubbling).
    el.ownerDocument.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(el);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not intercept target="_blank" links', () => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor(
      { href: 'apps/x/y', target: '_blank', children: 'New tab' },
      onNavigate,
    );

    const el = getByText('New tab');
    el.ownerDocument.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(el);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not intercept modified clicks (cmd/ctrl-click)', () => {
    const onNavigate = vi.fn();
    const { getByText } = renderAnchor(
      { href: 'apps/x/y', children: 'Modified' },
      onNavigate,
    );

    const el = getByText('Modified');
    el.ownerDocument.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(el, { metaKey: true });
    fireEvent.click(el, { ctrlKey: true });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders untouched without an ActionProvider', () => {
    const { getByText } = renderAnchor({
      href: 'apps/x/y',
      children: 'Bare',
    });

    const el = getByText('Bare') as HTMLAnchorElement;
    expect(el.getAttribute('href')).toBe('apps/x/y');
    el.ownerDocument.addEventListener('click', (e) => e.preventDefault());
    expect(() => fireEvent.click(el)).not.toThrow();
  });
});
