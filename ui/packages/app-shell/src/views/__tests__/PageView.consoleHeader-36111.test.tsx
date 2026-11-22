// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A custom page draws the console page header (objectstack#36111): from the
 * phone breakpoint up, every page under `/apps/APP/page/NAME` opens with the
 * header lists, dashboards and reports draw, the page's name and description
 * on its left and the shell's top-right button group on its right.
 *
 * - The page renderer's own title and description move into that header
 *   (`PageTitleHostContext`), as a dashboard's do into its header: the page
 *   names itself once, in one `h1`.
 * - What the author composed is drawn as written. An authored `page:header`
 *   with a title keeps it, one heading level down (`h2`), so the document
 *   keeps one `h1` (objectui#3434).
 * - The floating 「Edit in studio」 pencil is the phone's alone; a phone keeps
 *   the face it had: no console header, the renderer's own title, the pencil.
 *
 * Real subjects: `PageView` and the real page renderer from
 * `@object-ui/components` (`page`, `page:header`, `element:text`), under a
 * router at the page's route. The shell's group is pinned in
 * `layout/__tests__/ShellPageActions-36111`; here only where it goes.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PageSchema } from '@objectstack/spec/ui';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: { defaultValue?: string; name?: string }) => o?.defaultValue ?? o?.name ?? k, language: 'en' }),
}));

/** The stored page document the next mount resolves. */
let storedPage: Record<string, unknown> = {};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [storedPage], objects: [], apps: [], getTypeStatus: () => 'ready' }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

// Module scope, never a `beforeAll`: the `page`, `page:header` and
// `element:text` renderers.
import '@object-ui/components';
import { AdapterCtx, FilterScopeProvider, SchemaRendererProvider } from '@object-ui/react';
import { PageView } from '../PageView';
import { ShellPageActionsScope } from '../../layout/ShellPageActions';

const text = (id: string, content: string) => ({ type: 'element:text', id, properties: { content } });

/** A page with no header of its own: the renderer drew its name as an `h1`. */
const PLAIN = {
  name: 'welcome',
  label: 'Welcome',
  description: 'Where the team starts the day.',
  type: 'app',
  regions: [{ name: 'main', components: [text('body', 'Body copy')] }],
};

/** A page whose author wrote a titled `page:header` that differs from the page's name. */
const AUTHORED = {
  name: 'contact',
  label: 'Contact Form',
  type: 'app',
  regions: [
    { name: 'header', components: [{ type: 'page:header', properties: { title: 'Get in touch', subtitle: 'We answer within a day.' } }] },
    { name: 'main', components: [text('body', 'Body copy')] },
  ],
};

function mount(page: Record<string, unknown>, { shell }: { shell?: boolean } = {}) {
  storedPage = page;
  const ds = { find: vi.fn(async () => ({ data: [] })), findOne: vi.fn(async () => null) };
  const route = (
    <MemoryRouter initialEntries={[`/apps/cloud/page/${page.name as string}`]}>
      <Routes>
        <Route path="/apps/:app/page/:pageName" element={<PageView />} />
      </Routes>
    </MemoryRouter>
  );
  render(
    <AdapterCtx.Provider value={ds as never}>
      <SchemaRendererProvider dataSource={ds as never}>
        <FilterScopeProvider currentUserId="u1" currentOrgId="o1">
          {shell === undefined ? route : <ShellPageActionsScope on={shell}>{route}</ShellPageActionsScope>}
        </FilterScopeProvider>
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
}

const settle = (ms = 50) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const setWidth = (value: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });

beforeEach(() => {
  setWidth(1280);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  cleanup();
  setWidth(1024);
  vi.unstubAllGlobals();
});

describe('objectstack#36111 — a custom page opens with the console page header', () => {
  it('the fixtures are pages the spec accepts', () => {
    for (const page of [PLAIN, AUTHORED]) {
      const parsed = PageSchema.safeParse(page);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('a page with no header of its own: its name and description move into the console header, once', async () => {
    mount(PLAIN);
    await screen.findByText('Body copy');
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Welcome');
    expect(within(header).getByText('Where the team starts the day.')).toBeInTheDocument();
    // The renderer draws neither a second time.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByText('Where the team starts the day.')).toHaveLength(1);
    // The header sits above the page's scroller, not inside it.
    expect(header.parentElement?.querySelector(':scope > .overflow-auto')).not.toBeNull();
  });

  it('a page that authors a titled `page:header`: the console header names the page, the author\'s title stays as an `h2`', async () => {
    mount(AUTHORED);
    await screen.findByText('Body copy');
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Contact Form');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Get in touch' })).toBeInTheDocument();
    expect(screen.getByText('We answer within a day.')).toBeInTheDocument();
  });

  it('the shell\'s button group sits at the header\'s right once the shell turns it on, and nowhere while it is off', async () => {
    mount(PLAIN, { shell: true });
    await screen.findByText('Body copy');
    const header = screen.getByTestId('page-header');
    expect(within(header).getByTestId('shell-page-actions')).toBeInTheDocument();
    expect(screen.getAllByTestId('shell-page-actions')).toHaveLength(1);
    cleanup();

    mount(PLAIN, { shell: false });
    await screen.findByText('Body copy');
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
  });

  it('a phone keeps the face it had: no console header, the renderer\'s own title', async () => {
    setWidth(375);
    mount(PLAIN, { shell: true });
    await screen.findByText('Body copy');
    await settle();
    expect(screen.queryByTestId('page-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome');
  });
});
