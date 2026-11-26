// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37455 (decision 4 of epic objectstack#37424) — under a
 * non-default app theme, nothing Studio draws takes the app's colour:
 *
 *  - the surface's root carries Studio's accent (`STUDIO_ACCENT`), so every
 *    button, link and hover inside it reads graphite;
 *  - a surface Studio draws in a portal on `body` (here the command palette's
 *    dialog) sits under the same accent, which `body` carries while Studio is
 *    mounted;
 *  - the accent comes off `body` when Studio unmounts, and the app's own
 *    branding on the page root is left as the app wrote it.
 *
 * The app's theme is written by the app shell's own hook
 * (`useAppShellBranding`, a rose primary and an amber accent), not by hand.
 * jsdom computes no Tailwind, so the pins read the class scope a node sits in,
 * as the menu's own graphite pin (`StudioMenu.test.tsx`) does.
 */

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAppShellBranding } from '@object-ui/layout';

const PACKAGE_ID = 'com.acme.app';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (_type: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

// The source loads `@objectstack/lint` lazily; paid here, at collection, not
// inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
// The surface mounts the command palette, which reaches the record preview's
// `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { STUDIO_ACCENT, STUDIO_ACCENT_HSL } from './studio-tokens';
import { useStudioAccentOnBody } from './studioAccent';
import { COMMAND_PALETTE_TESTID } from '../../context/CommandPaletteProvider';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const ACCENT_CLASSES = STUDIO_ACCENT.split(/\s+/).filter(Boolean);
/** One of the accent's classes, as a selector for the scope a node sits in. */
const ACCENT_SCOPE = `[class~="${ACCENT_CLASSES[0]}"]`;
const BRAND_TOKENS = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--sidebar-primary',
  '--sidebar-ring',
  '--accent',
  '--accent-foreground',
  '--brand-primary',
  '--brand-primary-hsl',
  '--brand-accent',
  '--brand-accent-hsl',
];

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } })
        : answer([]),
    ),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const token of BRAND_TOKENS) document.documentElement.style.removeProperty(token);
});

/** An app with a non-default theme, written on the page root by the app shell's own hook. */
function BrandedApp({ studio }: { studio: boolean }): React.ReactElement {
  useAppShellBranding({ primaryColor: '#e11d48', accentColor: '#f59e0b' });
  return (
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/owd?palette=1`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={studio ? <StudioDesignSurface /> : <p data-testid="app-page">app</p>} />
      </Routes>
    </MemoryRouter>
  );
}

/** The accent scope's every class is on `el`. */
function carriesAccent(el: Element): boolean {
  return ACCENT_CLASSES.every((cls) => el.classList.contains(cls));
}

describe('a non-default app theme does not tint Studio (objectstack#37455)', () => {
  it('CONTROL: the app\'s colour is on the page root, and it is not graphite', async () => {
    render(<BrandedApp studio />);
    await screen.findByTestId('studio-pillars-host');
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--primary').trim()).not.toBe('');
    expect(root.getPropertyValue('--accent').trim()).not.toBe('');
    expect(root.getPropertyValue('--primary').trim()).not.toBe(STUDIO_ACCENT_HSL.light);
  });

  it('the surface\'s root carries Studio\'s accent: its top-left rows and the page sit under it', async () => {
    render(<BrandedApp studio />);
    const host = await screen.findByTestId('studio-pillars-host');
    const scope = host.closest(ACCENT_SCOPE);
    expect(scope).not.toBeNull();
    expect(scope).not.toBe(document.body);
    expect(carriesAccent(scope as Element)).toBe(true);
    // objectstack#37456 — no top bar: the left column's top rows stand where it was.
    expect(scope).toContainElement(screen.getByTestId('studio-top-left'));
  });

  it('a portalled surface (the command palette) is outside the root and still under the accent, on body', async () => {
    render(<BrandedApp studio />);
    const host = await screen.findByTestId('studio-pillars-host');
    const palette = await waitFor(() => {
      const el = document.querySelector(`[data-testid="${COMMAND_PALETTE_TESTID}"]`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const studioRoot = host.closest(ACCENT_SCOPE) as Element;
    expect(studioRoot.contains(palette)).toBe(false);
    expect(palette.closest(ACCENT_SCOPE)).toBe(document.body);
    expect(carriesAccent(document.body)).toBe(true);
  });

  it('Studio unmounted: the accent leaves body, and the app\'s branding on the page root is as the app wrote it', async () => {
    const { rerender } = render(<BrandedApp studio />);
    await screen.findByTestId('studio-pillars-host');
    const primary = document.documentElement.style.getPropertyValue('--primary');
    expect(carriesAccent(document.body)).toBe(true);

    rerender(<BrandedApp studio={false} />);
    await screen.findByTestId('app-page');
    for (const cls of ACCENT_CLASSES) expect(document.body).not.toHaveClass(cls);
    expect(document.body).not.toHaveAttribute('data-studio-accent');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(primary);
  });
});

/** A component that holds Studio's accent on body while it is mounted, as each surface does. */
function AccentHolder(): null {
  useStudioAccentOnBody();
  return null;
}

// objectstack#37520 (N1) — the accent is counted: two surfaces mounted at once
// (a route swap, StrictMode's second setup, a portalled second surface) hold
// it together, and it leaves body only with the last. A plain add / remove
// would strip it from under the surface still mounted.
describe('the accent on body is counted across surfaces (objectstack#37520)', () => {
  function Pair({ first, second }: { first: boolean; second: boolean }): React.ReactElement {
    return (
      <>
        {first && <AccentHolder />}
        {second && <AccentHolder />}
      </>
    );
  }

  it('two mounted, one unmounted: body keeps the accent; the last unmounted takes it off', () => {
    const { rerender } = render(<Pair first second />);
    expect(carriesAccent(document.body)).toBe(true);
    expect(document.body).toHaveAttribute('data-studio-accent');

    rerender(<Pair first={false} second />);
    expect(carriesAccent(document.body)).toBe(true);
    expect(document.body).toHaveAttribute('data-studio-accent');

    rerender(<Pair first={false} second={false} />);
    for (const cls of ACCENT_CLASSES) expect(document.body).not.toHaveClass(cls);
    expect(document.body).not.toHaveAttribute('data-studio-accent');
  });

  it('CONTROL: one mounted and unmounted leaves body as it found it', () => {
    const { unmount } = render(<AccentHolder />);
    expect(carriesAccent(document.body)).toBe(true);
    unmount();
    for (const cls of ACCENT_CLASSES) expect(document.body).not.toHaveClass(cls);
    expect(document.body).not.toHaveAttribute('data-studio-accent');
  });
});

/**
 * Tailwind's `dark:` variant as the app shell's stylesheet binds it: the
 * selector a node must match for its `dark:` classes to apply.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DARK_VARIANT = (() => {
  const css = readFileSync(resolve(HERE, '../../styles.css'), 'utf8');
  const m = /@custom-variant dark \(&(:where\([^)]*\))\);/.exec(css);
  if (!m) throw new Error('styles.css binds no `dark:` variant this pin can read');
  return m[1];
})();

/**
 * Whether `node` matches the variant: `:where(a, b)` matches when any of its
 * selectors does. Read one by one, because the DOM under test does not match
 * a descendant combinator inside `:where()` (measured: `.dark *` matches body,
 * `:where(.dark, .dark *)` does not).
 */
function matchesDarkVariant(node: Element): boolean {
  const list = /^:where\((.*)\)$/.exec(DARK_VARIANT)?.[1] ?? '';
  return list.split(',').some((selector) => node.matches(selector.trim()));
}

/** The accent's dark declarations, as classes: `dark:[--primary:220_9%_83%]` and the rest. */
const DARK_ACCENT_CLASSES = ACCENT_CLASSES.filter((cls) => cls.startsWith('dark:'));
const darkClass = (token: string, hsl: string) => `dark:[${token}:${hsl.replace(/ /g, '_')}]`;

// objectstack#37520 (N4) — dark mode, as far as the DOM can say it: jsdom
// computes no Tailwind, so the dark values are not read here (the PR's Chromium
// readings carry them, `studio-tokens.test.ts` holds the class string to the
// constants). What is pinned is the scope: under the app's dark theme (the
// `dark` class on the page root), the nodes that carry the accent, the
// surface's root and body, both match the `dark:` variant, and both carry its
// graphite declarations, so a portalled surface reads dark graphite too.
describe('dark theme: the accent\'s dark declarations apply on the surface root and on body (objectstack#37520)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('the dark variant binds to a `dark` class above the node', () => {
    expect(DARK_VARIANT).toBe(':where(.dark, .dark *)');
    expect(DARK_ACCENT_CLASSES.length).toBeGreaterThan(0);
  });

  it('under the dark theme, the surface root and body match the variant and carry dark graphite', async () => {
    document.documentElement.classList.add('dark');
    render(<BrandedApp studio />);
    // objectstack#37456 — no top bar: the left column's top-left is the anchor inside the surface root.
    const topLeft = await screen.findByTestId('studio-top-left');
    const studioRoot = topLeft.closest(ACCENT_SCOPE) as Element;
    expect(studioRoot).not.toBeNull();
    expect(document.documentElement).toHaveClass('dark');
    for (const node of [studioRoot, document.body]) {
      expect(matchesDarkVariant(node)).toBe(true);
      for (const cls of DARK_ACCENT_CLASSES) expect(node).toHaveClass(cls);
      expect(node).toHaveClass(darkClass('--primary', STUDIO_ACCENT_HSL.dark));
      expect(node).toHaveClass(darkClass('--ring', STUDIO_ACCENT_HSL.dark));
    }
  });

  it('CONTROL: under the light theme neither matches the variant, so the dark declarations do not apply', async () => {
    render(<BrandedApp studio />);
    // objectstack#37456 — no top bar: the left column's top-left is the anchor inside the surface root.
    const topLeft = await screen.findByTestId('studio-top-left');
    const studioRoot = topLeft.closest(ACCENT_SCOPE) as Element;
    expect(matchesDarkVariant(studioRoot)).toBe(false);
    expect(matchesDarkVariant(document.body)).toBe(false);
    // The accent still sits on both: only its light declarations apply.
    expect(carriesAccent(studioRoot)).toBe(true);
    expect(carriesAccent(document.body)).toBe(true);
  });
});
