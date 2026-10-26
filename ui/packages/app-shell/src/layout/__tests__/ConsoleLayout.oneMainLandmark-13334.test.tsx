// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13334 — a console page has exactly one `main` landmark.
 *
 * Measured on HotCRM's Setup pass (the Organization record page, then the
 * permission-set page): two nested `<main>` elements, so a screen reader
 * announced two main regions. Every Setup record page renders inside
 * `ConsoleLayout` (`/apps/setup/...`), whose `@object-ui/layout` `AppShell`
 * put its own `<main>` inside `SidebarInset`, which is itself a `<main>`.
 * The content element is now a `<div>`, and `SidebarInset` is the one landmark.
 *
 * Pinned here, against the real `ConsoleLayout` with its real `AppShell` and
 * real `SidebarInset`: one `main` landmark (counted in the DOM and judged by
 * axe's landmark rules), the route slot and its page sit inside it, and the
 * skip link still targets the route slot and moves focus there. The two
 * organization layouts, which are routes of their own outside `ConsoleLayout`,
 * are counted too: each draws its one `<main>`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axe from 'axe-core';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({
  UnifiedSidebar: () => (
    <nav>
      <a href="/apps/setup/sys_organization">Organizations</a>
    </nav>
  ),
}));
vi.mock('../AppHeader', () => ({
  AppHeader: () => <button type="button">App launcher</button>,
}));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    organizations: [ORG],
    activeOrganization: ORG,
    isOrganizationsLoading: false,
    switchOrganization: vi.fn(async () => {}),
  }),
}));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { OrganizationsLayout } from '../../console/organizations/OrganizationsLayout';
import { OrganizationLayout } from '../../console/organizations/manage/OrganizationLayout';

const APP = { name: 'setup', label: 'Setup', active: true, navigation: [] };

function inProviders(path: string, ui: React.ReactNode) {
  return render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProvider>{ui}</NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** A Setup record page as `AppContent` mounts it: inside `ConsoleLayout`. */
function mountSetupRecordPage() {
  return inProviders(
    '/apps/setup/sys_organization/record/org_1',
    <ConsoleLayout activeAppName="setup" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
      <div data-testid="record-page">
        <h1>Acme</h1>
        <button type="button">Edit</button>
      </div>
    </ConsoleLayout>,
  );
}

const mainLandmarks = () => [...document.querySelectorAll('main, [role="main"]')];

async function axeLandmarkViolations() {
  const res = await axe.run(document, {
    runOnly: {
      type: 'rule',
      values: ['landmark-no-duplicate-main', 'landmark-main-is-top-level', 'landmark-one-main'],
    },
  });
  return {
    violations: res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html.slice(0, 80)) })),
    judged: [...res.passes, ...res.violations].map((r) => r.id),
  };
}

afterEach(() => cleanup());

describe('a console page has exactly one main landmark (objectui#13334)', () => {
  it('a Setup record page inside ConsoleLayout draws one main, and it holds the page', () => {
    mountSetupRecordPage();
    const mains = mainLandmarks();
    expect(mains).toHaveLength(1);
    expect(mains[0]).toContainElement(screen.getByTestId('console-route'));
    expect(mains[0]).toContainElement(screen.getByTestId('record-page'));
  });

  it("axe's main-landmark rules find nothing on it", async () => {
    mountSetupRecordPage();
    const { violations, judged } = await axeLandmarkViolations();
    expect(violations).toEqual([]);
    // Control: an empty list is a reading only if the rules ran against a main.
    expect(judged).toEqual(expect.arrayContaining(['landmark-no-duplicate-main', 'landmark-one-main']));
  });

  it('the skip link still targets the route slot and moves focus to it', async () => {
    mountSetupRecordPage();
    const slot = screen.getByTestId('console-route');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#console-main-content');
    expect(slot.id).toBe('console-main-content');
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skip);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(slot);
  });

  it('the organizations list layout draws one main', () => {
    inProviders('/organizations', <OrganizationsLayout><p>list</p></OrganizationsLayout>);
    expect(mainLandmarks()).toHaveLength(1);
  });

  it('the organization management layout draws one main around its tab page', () => {
    inProviders(
      '/organizations/acme/members',
      <Routes>
        <Route path="/organizations/:slug" element={<OrganizationLayout />}>
          <Route path="members" element={<p data-testid="members-page">members</p>} />
        </Route>
      </Routes>,
    );
    const mains = mainLandmarks();
    expect(mains).toHaveLength(1);
    expect(mains[0]).toContainElement(screen.getByTestId('members-page'));
  });
});
