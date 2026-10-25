// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A sidebar entry's ⋯ › Design asks before leaving a page that holds unsaved
 * edits (objectui#13231).
 *
 * Measured in Chromium on a dirty settings page: Design opened the entry's
 * Studio surface at once and the edit was lost, because the entry navigates
 * from a menu item, which no link listener sees. It now goes through the
 * shell's unsaved-edits seam.
 *
 * Harness: `SidebarItemMenu-12427`'s — the real component in a real sidebar
 * row, the real Radix menu and the real router, with the two principal answers
 * as stand-ins and the entry's package served writable, so Design is offered.
 * A page's unsaved edits are registered with the seam directly, the way a
 * page's hook does.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
import { resolveHref } from '@object-ui/layout';
import { SidebarItemMenu, sidebarItemDesignPath } from '../SidebarItemMenu';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

const BASE_PATH = '/apps/crm';
const APP = { name: 'crm', _packageId: 'com.acme.crm' };
const LEADS = { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' } as NavigationItem;
const STUDIO = '/studio/com.acme.crm/data?surface=object:crm_lead';
const QUESTION = 'You have unsaved changes. Are you sure you want to leave?';

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderRow() {
  const { href, external } = resolveHref(LEADS, BASE_PATH);
  return render(
    <MemoryRouter initialEntries={[BASE_PATH]}>
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href={href} data-testid="row-link">Leads</a>
            </SidebarMenuButton>
            <SidebarItemMenu
              label="Leads"
              href={href}
              external={external}
              isFavorite={false}
              onToggleFavorite={vi.fn()}
              designPath={sidebarItemDesignPath(LEADS, APP)}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** objectui#12615 — one macrotask, so the package list's verdict has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function clickDesign() {
  await settle();
  fireEvent.keyDown(screen.getByTestId('sidebar-item-menu-trigger'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Design' }));
}

/**
 * The prompt, answered by the test: Cancel unless a case says OK. Stubbed as a
 * global because happy-dom's window has no `confirm` to spy on.
 */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;
let release: (() => void) | null = null;

beforeEach(() => {
  confirmSpy = stubConfirm();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.acme.crm', name: 'CRM' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

afterEach(() => {
  cleanup();
  release?.();
  release = null;
  vi.unstubAllGlobals();
});

describe('sidebar ⋯ › Design asks before leaving unsaved edits (objectui#13231)', () => {
  it('with an unsaved edit on screen, Design asks; Cancel stays where it is', async () => {
    release = registerUnsavedEdits(QUESTION);
    renderRow();
    await clickDesign();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    await settle();
    expect(screen.getByTestId('where')).toHaveTextContent(BASE_PATH);
    expect(screen.getByTestId('where')).not.toHaveTextContent('/studio');
  });

  it('with an unsaved edit on screen, OK opens the entry\'s Studio surface', async () => {
    release = registerUnsavedEdits(QUESTION);
    confirmSpy.mockReturnValue(true);
    renderRow();
    await clickDesign();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(STUDIO));
  });

  it('CONTROL: with nothing registered, Design opens Studio at once and asks nothing', async () => {
    renderRow();
    await clickDesign();

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(STUDIO));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
