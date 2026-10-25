// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11181: the Interfaces rail heading prints an app's own `label` in
 * the designer locale when that label is a locale map.
 *
 * The spec types `AppSchema.label` as `I18nLabel`: a plain string or an inline
 * locale map. `InterfacesPillar` read it through `String()` twice, once from
 * the package's app list row and once from the loaded app body, so a map
 * printed `[object Object] · Navigation`. The pillar now holds the label as the
 * spec types it and resolves it at render through `navItemLabelText`, the
 * helper the Studio's nav readers already share (objectui#11128,
 * objectui#11148, objectui#11158), so the heading also follows a
 * designer-language switch.
 *
 * The pillar is the real `InterfacesPillar` over a mocked metadata client (the
 * harness of `StudioDesignSurface.interfacesRailLabelMap-11158.test.tsx`).
 * Every app of the fixture parses against the spec, so each map is an input
 * the designer must handle. The plain-string app is the control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema } from '@objectstack/spec/ui';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

const PKG = 'com.acme.app';

const NAV = [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }];

const MAP_LABEL = { en: 'Acme', 'zh-CN': '顶点' };

/** What the mocked server answers: the app list row, and the app body. */
const state: {
  label: unknown;
  /** `false` holds the app body's read open, so only the list row is known. */
  bodyLoads: boolean;
} = { label: MAP_LABEL, bodyLoads: true };

const appDoc = () => ({ name: 'acme_app', label: state.label, navigation: NAV });

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: state.label }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn((type: string, name: string) => {
    if (type === 'app') {
      return state.bodyLoads ? Promise.resolve({ effective: appDoc() }) : new Promise<never>(() => {});
    }
    if (type === 'page') {
      return Promise.resolve({ effective: { name, label: name, type: 'app', regions: [{ name: 'main', components: [] }] } });
    }
    return Promise.resolve({ effective: { name } });
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

type Language = 'en' | 'zh';

/** The provider's own language switch, handed to the case by the probe below. */
let switchLanguage: ((lang: string) => Promise<void>) | null = null;
function LanguageProbe() {
  const { changeLanguage } = useObjectTranslation();
  React.useEffect(() => {
    switchLanguage = changeLanguage;
  }, [changeLanguage]);
  return null;
}

beforeEach(() => {
  state.label = MAP_LABEL;
  state.bodyLoads = true;
  switchLanguage = null;
  for (const fn of Object.values(mockClient)) fn.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderPillar(language: Language) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>
      <LanguageProbe />
    </I18nProvider>,
  );
}

const HEADING: Record<Language, (app: string) => string> = {
  en: (app) => `${app} · Navigation`,
  zh: (app) => `${app} · 导航`,
};

const MAP_TEXT: Record<Language, string> = { en: 'Acme', zh: '顶点' };

describe('the objectui#11181 fixture is what the spec accepts', () => {
  it('the map-labelled app and the plain-string app both parse against AppSchema', () => {
    for (const label of [MAP_LABEL, 'Acme']) {
      state.label = label;
      expect(AppSchema.safeParse(appDoc()).success).toBe(true);
    }
  });
});

for (const language of ['en', 'zh'] as const) {
  describe(`the Interfaces rail heading prints a map-labelled app under ${language} (objectui#11181)`, () => {
    it('the loaded app body: the map resolves in the designer locale, beside a string name', async () => {
      renderPillar(language);

      expect(await screen.findByText(HEADING[language](MAP_TEXT[language]), undefined, { timeout: 8000 })).toBeInTheDocument();
      // The body load settled (the first leaf auto-opened), so this is the body's label.
      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
      expect(screen.getByText(HEADING[language](MAP_TEXT[language]))).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('[object Object]');
    });

    it('the app list row, while the body is still loading: the map resolves the same way', async () => {
      state.bodyLoads = false;
      renderPillar(language);

      expect(await screen.findByText(HEADING[language](MAP_TEXT[language]), undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(mockClient.layered).toHaveBeenCalledWith('app', 'acme_app');
      expect(document.body.textContent).not.toContain('[object Object]');
    });

    it('the control: a plain-string label prints as authored', async () => {
      state.label = 'Acme';
      renderPillar(language);

      await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
      expect(screen.getByText(HEADING[language]('Acme'))).toBeInTheDocument();
    });
  });
}

describe('the heading follows a designer-language switch (objectui#11181)', () => {
  it('resolves the held map again in the new locale, without reloading the app', async () => {
    renderPillar('en');

    await waitFor(() => expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent('Home'), { timeout: 8000 });
    expect(screen.getByText(HEADING.en('Acme'))).toBeInTheDocument();
    const loads = mockClient.layered.mock.calls.filter(([type]) => type === 'app').length;

    expect(switchLanguage).toBeTypeOf('function');
    await act(async () => {
      await switchLanguage!('zh');
    });

    expect(await screen.findByText(HEADING.zh('顶点'))).toBeInTheDocument();
    expect(mockClient.layered.mock.calls.filter(([type]) => type === 'app').length).toBe(loads);
  });
});
