// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `<NotFoundState>` and the unknown-object state drawn through it
 * (objectstack#32157): the state keeps its own title and cause, and offers a
 * way back to Home, which is `useHomePath()` (the declared landing app where a
 * deployment declares one). The other three states are pinned in their own
 * harnesses: the unmatched URL in `AppContent.noAppComponentRoutes`, the
 * unknown record in `RecordDetailView.recordReadFailure-11902`, the unknown app
 * in `AppContent.deniedVsUnpublished`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { ObjectNotFoundState } from '../../views/objectViewChrome';

function Pathname() {
  return <span data-testid="pathname">{useLocation().pathname}</span>;
}

function renderObjectNotFound(apps: unknown[] = [], language = 'en') {
  const metadata = {
    apps, objects: [], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <MemoryRouter initialEntries={['/apps/crm/no_such_object']}>
          <Pathname />
          <Routes>
            <Route path="/apps/crm/:objectName" element={<ObjectNotFoundState objectName="no_such_object" />} />
            <Route path="/home" element={<h1>Home page</h1>} />
            <Route path="/apps/cloud_control" element={<h1>Declared landing</h1>} />
          </Routes>
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('the unknown-object state offers a way back to Home', () => {
  it('names the object and its cause, and Back to home opens Home', async () => {
    renderObjectNotFound();
    const state = screen.getByTestId('object-not-found');
    expect(state).toHaveTextContent('Object Not Found');
    expect(state).toHaveTextContent('The object "no_such_object" does not exist in the current configuration.');

    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/home');
  });

  it('a deployment that declares its landing app returns there', async () => {
    renderObjectNotFound([{ name: 'cloud_control', label: 'Cloud', isDefault: true, navigation: [] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await screen.findByRole('heading', { name: 'Declared landing' })).toBeInTheDocument();
  });

  it('zh: the way back reads in the reader language', () => {
    renderObjectNotFound([], 'zh');
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });
});
