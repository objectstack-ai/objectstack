/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12686 — a doc-to-doc link in a rendered doc body carries the router
 * basename, the class objectui#12233 fixed on record-page links.
 *
 * The console is served under `/_console`. A cross-reference rendered as
 * `href="/docs/NAME"` worked from a plain left click, which the page hands to
 * the router, and from nothing else: a new tab, a middle-click or a copied link
 * resolved it against the origin and the server answered 404. The oracle for
 * the right href is react-router's own `Link` for the same route, rendered in
 * the same router.
 *
 * The body goes through the REAL `MarkdownRenderer` (sanitizer included), so
 * the anchors read here are the ones a reader gets.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { ADAPTER } = vi.hoisted(() => {
  const BODY = [
    '# Lead guide',
    '',
    'Read the [index](./crm_index.md) first, then [setup](crm_index.md#setup).',
    '',
    'Jump to [details](#details) or visit [the site](https://example.com/x).',
    '',
    '## Details',
    '',
    'Body.',
  ].join('\n');
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async () => [],
        getItem: async (_type: string, name: string) => ({ item: { name, content: BODY } }),
      },
    }),
  };
  return { ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}));

// Imported AFTER the mocks so the page picks up the mocked modules.
import DocPage from './DocPage';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderDoc(basename: string) {
  return render(
    <MemoryRouter basename={basename} initialEntries={[`${basename === '/' ? '' : basename}/docs/crm_manual/crm_lead_guide`]}>
      <Routes>
        <Route path="/docs/:slug/:name" element={<DocPage />} />
        <Route path="/docs/:name" element={<div>landed</div>} />
      </Routes>
      <Link to="/docs/crm_index" data-testid="oracle">oracle</Link>
      <Where />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a doc-to-doc link carries the router basename (objectui#12686)', () => {
  it('under `/_console`, the rewritten href is the one react-router renders for the same route', async () => {
    renderDoc('/_console');
    const link = await screen.findByRole('link', { name: 'index' });
    const oracle = screen.getByTestId('oracle').getAttribute('href');
    expect(oracle).toBe('/_console/docs/crm_index');
    expect(link.getAttribute('href')).toBe(oracle);
    expect(screen.getByRole('link', { name: 'setup' }).getAttribute('href')).toBe(`${oracle}#setup`);
  });

  it('on a root mount the href stays `/docs/NAME`', async () => {
    renderDoc('/');
    const link = await screen.findByRole('link', { name: 'index' });
    expect(link.getAttribute('href')).toBe('/docs/crm_index');
    expect(link.getAttribute('href')).toBe(screen.getByTestId('oracle').getAttribute('href'));
  });

  it('a plain left click navigates in the app to the router path, once', async () => {
    renderDoc('/_console');
    const link = await screen.findByRole('link', { name: 'index' });
    const notPrevented = fireEvent.click(link, { button: 0 });
    expect(notPrevented).toBe(false);
    expect(await screen.findByText('landed')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm_index');
  });

  it('a modifier click is left to the browser', async () => {
    renderDoc('/_console');
    const link = await screen.findByRole('link', { name: 'index' });
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      expect(fireEvent.click(link, { button: 0, ...mod })).toBe(true);
    }
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm_manual/crm_lead_guide');
  });

  it('CONTROL: a fragment link still scrolls in JS, and an external link is untouched', async () => {
    renderDoc('/_console');
    const fragment = await screen.findByRole('link', { name: 'details' });
    expect(fragment.getAttribute('href')).toBe('#details');
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    expect(fireEvent.click(fragment, { button: 0 })).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);

    const external = screen.getByRole('link', { name: 'the site' });
    expect(external.getAttribute('href')).toBe('https://example.com/x');
    expect(fireEvent.click(external, { button: 0 })).toBe(true);
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm_manual/crm_lead_guide');
  });
});
