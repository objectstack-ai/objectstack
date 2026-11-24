// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12303 row 4 — on a read-only package, the Studio header's Publish
 * says why it is disabled, to a keyboard and to assistive tech, not only to a
 * mouse.
 *
 * Measured on the card: the reason ("Read-only package — switch to or create
 * a writable package to edit.") was a `title` on the disabled button, with no
 * focusable wrapper. A natively disabled button fires no hover or focus, so
 * the `title` reached nobody who does not hover, and Tab from "Changes"
 * skipped Publish entirely. It now rides the record page's Archive pattern
 * (`DeclaredActionsBar`, objectui#11811): a wrapping span that is the tooltip
 * trigger and a tab stop, and an `sr-only` copy of the reason that both the
 * span and the button are described by. The automation enable switch, the
 * other half of the row, is pinned in
 * `StudioDesignSurface.automationsReadOnly-11124.test.tsx`.
 *
 * objectstack#36511 — Publish is drawn only while drafts are pending, so the
 * read-only cases below hold one, and with nothing pending there is no Publish
 * and no "No drafts pending publish" reason (which objectstack#31495 had
 * wrapped the same way). Pinned in the last block below.
 *
 * The REAL `StudioDesignSurface` over a fetch stub (the harness of
 * `StudioDesignSurface.interfacePolish.test.tsx`); only the package list's
 * `writable` differs between the case and its control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
// The surface loads the linter lazily; pay that load at collection, not inside
// a case's clocked window.
import '@objectstack/lint';

const PACKAGE_ID = 'com.acme.app';

const pkg = vi.hoisted(() => ({ writable: false }));
/** The draft ledger `/meta/_drafts` answers. */
let drafts: Array<{ type: string; name: string; packageId: string }> = [];

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: 'Acme', writable: pkg.writable }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { fetchPackages } from './packages-io';
import { t } from '../metadata-admin/i18n';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const REASON = t('engine.studio.pkg.readonlyHint', 'en-US');
const NONE_PENDING = t('engine.studio.publishNoneTitle', 'en-US');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  pkg.writable = false;
  drafts = [{ type: 'dashboard', name: 'acme_dashboard', packageId: PACKAGE_ID }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/meta/_drafts') return json(drafts);
      if (path === '/api/v1/meta/app') return json([{ name: 'acme_app', label: 'Acme' }]);
      if (path === '/api/v1/meta/app/acme_app/layers') {
        return json({ code: null, overlay: null, overlayScope: null, effective: { name: 'acme_app', label: 'Acme', navigation: [] } });
      }
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWorkbench() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const publish = () => screen.getByRole('button', { name: /^Publish/ });
/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

/** Publish once its wrapper gives `reason`. */
async function wrappedPublish(reason: string): Promise<HTMLElement> {
  renderWorkbench();
  return waitFor(
    () => {
      const btn = publish();
      expect(btn.parentElement).toHaveAttribute('data-disabled-reason');
      expect(describedBy(btn.parentElement as HTMLElement)).toHaveTextContent(reason);
      return btn;
    },
    { timeout: 8000 },
  );
}

/** Publish once the package list has said the package is read-only. */
const readOnlyPublish = () => wrappedPublish(REASON);

describe('Studio header Publish on a read-only package — the reason reaches the author (objectui#12303)', () => {
  it('Publish is described by the reason, carries no `title`, and its wrapper is described by it too', async () => {
    const btn = await readOnlyPublish();
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute('title');
    expect(describedBy(btn)).toHaveTextContent(REASON);
    const wrapper = btn.parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(describedBy(wrapper)).toHaveTextContent(REASON);
  });

  it('hovering Publish opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    const btn = await readOnlyPublish();
    await user.hover(btn.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('a keyboard user reaches the reason: Tab from "Changes" lands on Publish’s wrapper, which opens the tooltip', async () => {
    const user = userEvent.setup();
    const btn = await readOnlyPublish();
    screen.getByRole('button', { name: /^Changes/ }).focus();
    await user.tab();
    expect(btn.parentElement).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('CONTROL — a writable package: Publish gives no read-only reason', async () => {
    pkg.writable = true;
    renderWorkbench();
    // Read after the package list has answered `writable: true`.
    await waitFor(() => expect(fetchPackages).toHaveBeenCalled(), { timeout: 8000 });
    await act(async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    });
    const btn = publish();
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('title', REASON);
    expect(btn.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(screen.queryByText(REASON)).toBeNull();
  });
});

describe('Studio header with nothing pending: no Publish, so no reason (objectstack#31495, objectstack#36511)', () => {
  beforeEach(() => {
    pkg.writable = true;
  });

  it('a writable package with an empty ledger draws no Publish and no "No drafts pending publish"', async () => {
    drafts = [];
    renderWorkbench();
    await waitFor(() => expect(fetchPackages).toHaveBeenCalled(), { timeout: 8000 });
    await act(async () => {
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
    expect(screen.queryByTestId('publish-none-reason')).toBeNull();
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
  });

  it('CONTROL — a draft pending: a plain enabled Publish, no wrapper and no reason', async () => {
    drafts = [{ type: 'dashboard', name: 'acme_dashboard', packageId: PACKAGE_ID }];
    renderWorkbench();
    const btn = await waitFor(
      () => {
        const b = publish();
        expect(b).toBeEnabled();
        return b;
      },
      { timeout: 8000 },
    );
    expect(btn.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(btn).not.toHaveAttribute('aria-describedby');
    expect(btn.className).not.toMatch(/(^|\s)disabled:pointer-events-none(\s|$)/);
    expect(screen.queryByTestId('publish-none-reason')).toBeNull();
    expect(screen.queryByText(NONE_PENDING)).toBeNull();
  });
});
