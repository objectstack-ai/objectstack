/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every chrome string objectstack#5506 moved into the locale packs still
 * resolves to ENGLISH when no `I18nProvider` is mounted.
 *
 * This is not a nice-to-have: consumers outside this package address exactly
 * these controls by their English accessible names with no provider in the
 * tree — `packages/plugin-view/src/__tests__/ObjectView.test.tsx`
 * (`getByLabelText('Close panel')`) and `e2e/live/inline-edit-polish-2572.spec.ts`
 * (the header toolbar by English name). Routing a literal through `t()` without
 * a working default is exactly how that breaks, and it breaks in another
 * package's suite, not this one's.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'de' }}>`, every later
 * "no provider" render in that same file silently resolves against the German
 * instance — a green-looking file that asserts nothing about the fallback, or
 * (as first written) a confusing red where the drawer renders
 * "Als ganze Seite öffnen" under a test that mounted no provider at all.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { NavigationOverlay } from '../custom/navigation-overlay';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const record = { _id: 'rec_1', name: 'Acme Corp' };

afterEach(() => cleanup());

describe('NavigationOverlay chrome — English fallback with no provider (objectstack#5506)', () => {
  it('names the resize handle, expand button, heading and description in English', () => {
    render(
      <NavigationOverlay
        isOpen
        isOverlay
        selectedRecord={record}
        mode="drawer"
        close={() => {}}
        setIsOpen={() => {}}
        storageKey="drawer-width:lead"
        onExpand={() => {}}
      >
        {() => <div>BODY CONTENT</div>}
      </NavigationOverlay>,
    );

    // Drag handle — `role="separator"`, no visible label.
    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe('Resize drawer');
    // Expand button — icon-only; `title` is the precise handle because the
    // shadcn Sheet primitive contributes an untranslated close of its own.
    expect(screen.getByTitle('Open as full page').getAttribute('aria-label')).toBe(
      'Open as full page',
    );
    // Visible heading, with no host-supplied title.
    expect(screen.getByText('Record Detail')).toBeTruthy();
    // sr-only description, interpolating that same default heading.
    expect(screen.getByText('Record detail overlay for Record Detail.')).toBeTruthy();
  });

  it('keeps the #5430 close names English too', () => {
    render(
      <NavigationOverlay
        isOpen
        isOverlay
        selectedRecord={record}
        mode="split"
        close={() => {}}
        setIsOpen={() => {}}
        title="Acme Corp"
        mainContent={<div>main</div>}
      >
        {() => <div>BODY CONTENT</div>}
      </NavigationOverlay>,
    );

    // The exact query `plugin-view`'s ObjectView.test.tsx uses.
    expect(screen.getByLabelText('Close panel')).toBeTruthy();
  });
});

describe('page:tabs count badge — English fallback with no provider (objectstack#5506)', () => {
  it('names the badge in English, with a real singular form', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'page:tabs',
          id: 'tabs',
          // The bag, where `PageTabsProps` declares `items` (objectui#11364).
          properties: {
            items: [
              {
                label: 'Details',
                value: 'details',
                count: 5,
                children: [{ type: 'element:text', properties: { content: 'A' } }],
              },
              {
                label: 'Related',
                value: 'related',
                count: 1,
                children: [{ type: 'element:text', properties: { content: 'B' } }],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByLabelText('5 items')).toBeTruthy();
    // Pre-#5506 this read "1 items" — the English plural was baked into the
    // template literal with no singular branch at all.
    expect(screen.getByLabelText('1 item')).toBeTruthy();
  });
});
