// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37575 — the ⋯ menu's Radix tree is a memoised view, handed text
 * and callbacks that stay the same across renders, so a sidebar re-render no
 * longer redraws every entry's menu. The callbacks it holds read the newest
 * props when they run: a favourite toggle reaches the callback of the latest
 * render, never the first one, and a copied link is the latest address.
 *
 * Harness as `SidebarItemMenu-12427.test.tsx`: the real component in a real
 * row, the translator returning each call site's inline default.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: toastSpy,
}));

import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
import { SidebarItemMenu } from '../SidebarItemMenu';

function row(props: { label: string; href: string; onToggleFavorite: () => void }) {
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarItemMenu label={props.label} href={props.href} isFavorite={false} onToggleFavorite={props.onToggleFavorite} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
    </MemoryRouter>
  );
}

const trigger = () => screen.getByTestId('sidebar-item-menu-trigger');
const open = async () => {
  fireEvent.keyDown(trigger(), { key: 'Enter' });
  return screen.findAllByRole('menuitem');
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ headers: new Headers(), ok: true, status: 200, json: async () => ({ data: [] }) })));
  toastSpy.success.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SidebarItemMenu: the memoised menu acts on the latest props (objectstack#37575)', () => {
  it('a favourite toggle after a re-render calls the newest callback, not the first', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(row({ label: 'Leads', href: '/apps/crm/crm_lead', onToggleFavorite: first }));
    rerender(row({ label: 'Leads', href: '/apps/crm/crm_lead', onToggleFavorite: latest }));
    const items = await open();
    fireEvent.click(items.find((el) => el.textContent === 'Add to favorites') as HTMLElement);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('a new label renames the trigger, and Copy link copies the newest address', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { rerender } = render(row({ label: 'Leads', href: '/apps/crm/crm_lead', onToggleFavorite: vi.fn() }));
    rerender(row({ label: 'Prospects', href: '/apps/crm/crm_prospect', onToggleFavorite: vi.fn() }));
    expect(trigger()).toHaveAccessibleName('More actions for Prospects');
    const items = await open();
    await act(async () => {
      fireEvent.click(items.find((el) => el.textContent === 'Copy link') as HTMLElement);
    });
    expect(writeText).toHaveBeenCalledWith(new URL('/apps/crm/crm_prospect', window.location.href).href);
    expect(toastSpy.success).toHaveBeenCalledWith('Link copied to clipboard');
  });
});
