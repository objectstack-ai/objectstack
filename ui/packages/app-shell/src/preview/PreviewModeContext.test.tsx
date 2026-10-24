/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0037 sticky preview — the regression that motivated it: in-app
 * navigation (landing redirect, sidebar links) builds URLs without the query
 * string, so a `?preview=draft` session used to silently flip back to the
 * published world for one render. That flicker swapped the metadata source
 * mid-session and once fed a cross-world diff into NavigationSyncEffect,
 * which WROTE navigation changes from inside a read-only preview.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import {
  PreviewModeProvider,
  usePreviewDrafts,
  markPreviewExit,
  isPreviewSearch,
} from './PreviewModeContext';

function Probe() {
  const preview = usePreviewDrafts();
  const location = useLocation();
  return (
    <div>
      <span data-testid="preview">{String(preview)}</span>
      <span data-testid="search">{location.search}</span>
    </div>
  );
}

/** Navigates once (like the app's landing redirect) WITHOUT the query string. */
function DropFlagOnce({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Exits preview explicitly, the way DraftPreviewBar's Exit button does. */
function ExplicitExitButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      data-testid="exit"
      onClick={() => {
        markPreviewExit();
        navigate(location.pathname, { replace: true });
      }}
    >
      exit
    </button>
  );
}

function App({ children, initialEntry }: { children?: React.ReactNode; initialEntry: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <PreviewModeProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Probe />
                {children}
              </>
            }
          />
        </Routes>
      </PreviewModeProvider>
    </MemoryRouter>
  );
}

describe('isPreviewSearch', () => {
  it('detects the flag and rejects other values', () => {
    expect(isPreviewSearch('?preview=draft')).toBe(true);
    expect(isPreviewSearch('?preview=published')).toBe(false);
    expect(isPreviewSearch('')).toBe(false);
  });
});

describe('PreviewModeProvider (sticky)', () => {
  it('is on when the URL carries the flag', () => {
    render(<App initialEntry="/apps/crm?preview=draft" />);
    expect(screen.getByTestId('preview').textContent).toBe('true');
  });

  it('stays on and restores the flag when navigation drops the query string', async () => {
    render(
      <App initialEntry="/apps/crm?preview=draft">
        <DropFlagOnce to="/apps/crm/lead" />
      </App>,
    );
    // The context value must never read false mid-flight, and the URL must
    // come back with the flag restored.
    await waitFor(() => {
      expect(screen.getByTestId('search').textContent).toBe('?preview=draft');
    });
    expect(screen.getByTestId('preview').textContent).toBe('true');
  });

  it('turns off (and stays off) after an explicit markPreviewExit()', async () => {
    render(
      <App initialEntry="/apps/crm?preview=draft">
        <ExplicitExitButton />
      </App>,
    );
    expect(screen.getByTestId('preview').textContent).toBe('true');
    fireEvent.click(screen.getByTestId('exit'));
    await waitFor(() => {
      expect(screen.getByTestId('preview').textContent).toBe('false');
    });
    // The flag is gone and the keeper did NOT re-apply it.
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('is off for a tree that never entered preview', () => {
    render(<App initialEntry="/apps/crm" />);
    expect(screen.getByTestId('preview').textContent).toBe('false');
    expect(screen.getByTestId('search').textContent).toBe('');
  });
});
