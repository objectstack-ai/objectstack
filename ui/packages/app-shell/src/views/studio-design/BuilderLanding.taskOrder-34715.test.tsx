// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34715 — the Studio landing is ordered by what the author came to
 * do, and its copy names no package mechanism.
 *
 * The installed apps lead (changing one is the likeliest errand), the
 * author's own apps and the create card follow, and the entries that belong
 * to no app come last. An installed app's card carries a Customize button that
 * opens it the way the card does, says "No changes yet" when nothing is
 * changed, and shows no package id on its face. In Chinese the page body
 * carries none of 「.custom」「基座」「只读」; in English none of ".custom",
 * "read-only", "writable base".
 *
 * Read off the real `BuilderLanding` under a real router, in English and in
 * Chinese; the package list, the customization read and the package-less flow
 * count are answered by doubles, so no request leaves the file.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
const counts = vi.hoisted(() => ({ byId: {} as Record<string, { customized: number; switchedOff: number }> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => packages.list),
    fetchListedPackageIds: vi.fn(async () => new Set(packages.list.map((p) => String(p.id)))),
  };
});
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));
vi.mock('./packageCustomizations-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./packageCustomizations-io')>()),
  // A served answer whose lists are as long as the counts asked for: `customized` view overrides, `switchedOff` flows.
  fetchPackageCustomizations: vi.fn(async (id: string) => {
    const { customized, switchedOff } = counts.byId[id] ?? { customized: 0, switchedOff: 0 };
    return {
      packageId: id,
      overrides: Array.from({ length: customized }, (_, i) => ({ type: 'view', name: `view_${i}` })),
      extensions: [],
      switchedOff: Array.from({ length: switchedOff }, (_, i) => ({ type: 'flow', name: `flow_${i}` })),
      contributions: [],
      counts: { overrides: customized, extensions: 0, switchedOff, contributions: 0 },
    };
  }),
}));
// The panel's label read (objectstack#34714) is not under test here: rows keep their names.
vi.mock('./landingCustomizations-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./landingCustomizations-io')>()),
  loadCustomizationLabels: vi.fn(async () => ({})),
}));
vi.mock('./packageSurfaces', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packageSurfaces')>();
  return {
    ...mod,
    loadPackageLessSurfaces: vi.fn(async () => [
      { type: 'flow', name: 'org_flow_a', label: 'Org flow A' },
      { type: 'flow', name: 'org_flow_b', label: 'Org flow B' },
    ]),
  };
});

import { BuilderLanding } from './BuilderLanding';
import { parsePackages } from './packages-io';

const HOTCRM = { id: 'app.objectstack.hotcrm', name: 'HotCRM', writable: false, namespace: 'crm' };
const SERVICE = { id: 'app.objectstack.service', name: 'HotCRM Service', writable: false, namespace: 'svc' };
const OWN = { id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' };

afterEach(() => {
  cleanup();
  packages.list = [];
  counts.byId = {};
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

function renderLanding(lang: 'en' | 'zh' = 'en') {
  const landing = (
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
      </Routes>
    </MemoryRouter>
  );
  if (lang === 'en') return render(landing);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{landing}</I18nProvider>);
}

/** The landing's body: every rendered word, the location probe left out. */
function bodyText(): string {
  const probe = screen.getByTestId('location');
  return (document.body.textContent ?? '').replace(probe.textContent ?? '', '');
}

/** Section headings in page order. */
const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('Studio landing: ordered by what the author came to do (objectstack#34715)', () => {
  it('installed apps come first, then the author’s own apps, then the entries outside any app', async () => {
    packages.list = [OWN, HOTCRM, SERVICE];
    renderLanding();

    await screen.findByText('HotCRM');
    expect(headings()).toEqual(['Installed apps', 'Customizations in this environment', 'Your own apps', 'Outside any app']);
    const installed = screen.getByTestId('studio-landing-installed');
    // DOM order: each installed card precedes the author's own card.
    const own = screen.getByTestId('studio-landing-own');
    expect(installed.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(own).getByText('Acme')).toBeInTheDocument();
    expect(within(own).getByTestId('studio-landing-new-app')).toHaveTextContent('New app of your own');
  });

  it('every installed card carries Customize, which opens the app the way the card does', async () => {
    packages.list = [HOTCRM, SERVICE];
    renderLanding();

    await screen.findByText('HotCRM');
    expect(screen.getAllByTestId('studio-landing-customize')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Customize HotCRM' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/app.objectstack.hotcrm/data'));
    expect(screen.getByTestId('pillar-builder')).toBeInTheDocument();
  });

  it('an installed card shows no package id on its face, and says "No changes yet" when nothing is changed', async () => {
    packages.list = [HOTCRM, SERVICE];
    counts.byId = { 'app.objectstack.hotcrm': { customized: 6, switchedOff: 1 } };
    renderLanding();

    const installed = await screen.findByTestId('studio-landing-installed');
    await waitFor(() =>
      expect(within(installed).getAllByTestId('studio-landing-customizations').map((l) => l.textContent)).toEqual([
        '6 customized, 1 switched off',
        'No changes yet',
      ]),
    );
    expect(installed.textContent).not.toContain('app.objectstack');
    // The id is still there to read, in the card's title.
    expect(installed.querySelector('[data-package-id="app.objectstack.hotcrm"]')).toHaveAttribute(
      'title',
      'app.objectstack.hotcrm',
    );
  });

  it('a system package served flat with a kernel scope is no installed app: no card, no Customize (comment 6943119575)', async () => {
    // The list as the registry half serves a hosted environment: a `sys.*`
    // package whose kernel `scope` is flat, beside an installed app.
    const parsed = parsePackages({
      data: [
        { id: 'sys.package-state', name: 'Package State', scope: 'system', writable: false },
        { id: 'sys.env-artifact-cache', name: 'Environment Artifact Cache', scope: 'cloud', writable: false },
        { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', namespace: 'crm' }, writable: false },
      ],
    });
    // CONTROL: the parser keeps the flat kernel rows, tagged — the landing is what drops them.
    expect(parsed.filter((p) => p.kernel).map((p) => p.id)).toEqual(['sys.package-state', 'sys.env-artifact-cache']);
    packages.list = parsed.map((p) => ({ ...p }));
    renderLanding();

    const installed = await screen.findByTestId('studio-landing-installed');
    expect(within(installed).getByText('HotCRM')).toBeInTheDocument();
    expect(within(installed).getAllByTestId('studio-landing-customize')).toHaveLength(1);
    expect(document.querySelector('[data-package-id^="sys."]')).toBeNull();
    expect(bodyText()).not.toMatch(/Package State|Environment Artifact Cache/u);
  });

  it('positions and permissions keep their Studio entry under the new name', async () => {
    packages.list = [HOTCRM];
    renderLanding();

    const entry = await screen.findByTestId('studio-landing-env-catalog');
    expect(entry).toHaveTextContent('Positions and permissions');
    fireEvent.click(entry);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/studio\/[^/]+\/metadata$/));
  });

  it('en-US: the body names no mechanism — no ".custom", "read-only" or "writable base"', async () => {
    packages.list = [OWN, HOTCRM, SERVICE];
    renderLanding('en');

    await screen.findByTestId('studio-landing-org-scope');
    const text = bodyText();
    // CONTROL: the body was read after the cards and both entries drew.
    expect(text).toContain('HotCRM Service');
    expect(text).toContain('Flows in no app');
    expect(text).not.toMatch(/\.custom|read-only|writable base/iu);
  });

  it('zh-CN: the body carries none of 「.custom」「基座」「只读」, and installed apps lead', async () => {
    packages.list = [OWN, HOTCRM, SERVICE];
    renderLanding('zh');

    await screen.findByTestId('studio-landing-org-scope');
    expect(headings()[0]).toBe('已安装的应用');
    expect(screen.getAllByTestId('studio-landing-customize')[0]).toHaveTextContent('定制');
    expect(screen.getByTestId('studio-landing-org-scope')).toHaveTextContent('未归属的流程2');
    expect(screen.getByTestId('studio-landing-env-catalog')).toHaveTextContent('岗位与权限');
    const text = bodyText();
    expect(text).toContain('HotCRM Service');
    for (const word of ['.custom', '基座', '只读']) expect(text).not.toContain(word);
  });
});
