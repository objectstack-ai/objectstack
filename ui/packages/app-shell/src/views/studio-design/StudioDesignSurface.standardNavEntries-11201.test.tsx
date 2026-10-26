// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11201 (ruling B, stage 1) — the Studio's two producers of STANDARD
 * navigation entries store them with no `label`.
 *
 * Ruling B keeps one rule, the spec's: a present label renders verbatim, and an
 * absent one inherits its target's current label at render time, which is the
 * text that localises. A standard entry is one whose text is its target's own,
 * so it is written label-less. The Studio wrote the target's text instead:
 *
 *   - Create app with "add objects" (`buildAppSkeleton`, fed by the pillar's
 *     package-object list) seeded one entry per object with `label` = the
 *     object's label, or its MACHINE NAME for a draft or unlabelled object;
 *   - binding an object to a placeholder entry (`StudioNavItemInspector`)
 *     adopted the object's label the same way.
 *
 * Both now write no `label` key. objectui#11196 moved the second half to the
 * birth: the canvas births a new entry label-less, so binding leaves the label
 * as it is and no longer recognises a "New item" placeholder; a legacy stored
 * "New item" is a present label and is kept. The pins read what the writer emits; the
 * seeded entries are also rendered, as stored, through the sidebar's
 * `NavigationRenderer` wired as `UnifiedSidebar` wires it, under en and zh-CN.
 * Controls: a label the author typed, and a locale map, are kept as authored.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema, NavigationItemSchema } from '@objectstack/spec/ui';
import type { TranslationData } from '@objectstack/spec/system';

// Module scope, never a `beforeAll` (AGENTS.md, objectui#3010).
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { MetadataCtx } from '@object-ui/react';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import {
  createI18n,
  I18nProvider,
  isSpecTranslationData,
  transformSpecTranslations,
  useObjectTranslation,
} from '@object-ui/i18n';
import { useNavTargetLabel } from '../../hooks/useNavTargetLabel';
import { buildAppSkeleton } from './skeletons';
import { StudioNavItemInspector } from './StudioDesignSurface';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// The Create-app scaffold
// ---------------------------------------------------------------------------

/** A labelled published object, and an unlabelled one (a draft's header carries no label). */
const OBJECT_DEFS = [{ name: 'account', label: 'Account' }, { name: 'draft_thing' }];

const ZH_CN: TranslationData = { objects: { account: { label: '客户' } } } as TranslationData;

function metadata() {
  return {
    apps: [],
    objects: OBJECT_DEFS,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function i18nIn(language: string) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const raw = ZH_CN as Record<string, unknown>;
  expect(isSpecTranslationData(raw)).toBe(true);
  instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(raw), true, true);
  return instance;
}

/** The sidebar surface, wired the way `UnifiedSidebar` wires `NavigationRenderer`. */
function Sidebar({ items }: { items: NavigationItem[] }) {
  const { language } = useObjectTranslation();
  const resolveTargetLabel = useNavTargetLabel();
  return (
    <SidebarProvider defaultOpen>
      <nav aria-label="Sidebar">
        <NavigationRenderer
          items={items}
          basePath="/apps/acme"
          resolveTargetLabel={resolveTargetLabel}
          locale={language}
        />
      </nav>
    </SidebarProvider>
  );
}

function renderSidebar(items: Array<Record<string, unknown>>, language: string) {
  render(
    <I18nProvider instance={i18nIn(language)} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/acme']}>
        <MetadataCtx.Provider value={metadata() as never}>
          <Sidebar items={items as unknown as NavigationItem[]} />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return within(screen.getByRole('navigation', { name: 'Sidebar' }));
}

const seeded = () =>
  buildAppSkeleton('acme_app', 'Acme', OBJECT_DEFS.map((o) => ({ name: o.name }))).navigation as Array<
    Record<string, unknown>
  >;

describe('objectui#11201 — Create app seeds its object entries with no label', () => {
  it('every seeded entry names its object and carries NO `label` key', () => {
    const navigation = seeded();
    expect(navigation.map((e) => e.objectName)).toEqual(['account', 'draft_thing']);
    for (const entry of navigation) {
      expect(entry).toMatchObject({ type: 'object' });
      expect(entry).not.toHaveProperty('label');
    }
  });

  it('the seeded app is a document the spec accepts', () => {
    expect(AppSchema.safeParse(buildAppSkeleton('acme_app', 'Acme', [{ name: 'account' }])).success).toBe(true);
  });

  it('under en, the stored entries render the object’s label, and the machine name only for an unlabelled one', () => {
    const sidebar = renderSidebar(seeded(), 'en');
    expect(sidebar.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/apps/acme/account');
    expect(sidebar.getByRole('link', { name: 'draft_thing' })).toHaveAttribute('href', '/apps/acme/draft_thing');
  });

  it('under zh-CN, the stored entry renders the object’s zh label from the app bundle', () => {
    const sidebar = renderSidebar(seeded(), 'zh-CN');
    expect(sidebar.getByRole('link', { name: '客户' })).toHaveAttribute('href', '/apps/acme/account');
    expect(sidebar.queryByText('Account')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Binding an object to a placeholder entry
// ---------------------------------------------------------------------------

const PICKER_OBJECTS = [
  { name: 'account', label: 'Account' },
  // What the pillar hands the picker for a draft or unlabelled object.
  { name: 'draft_thing', label: 'draft_thing' },
];

/**
 * Bind `objectName` in *Link object*, the shared `Select` since objectui#11865:
 * open its list and pick the option the picker labels `Label (name)`.
 */
async function bind(node: Record<string, unknown>, objectName: string): Promise<Record<string, unknown>> {
  const onNavPatch = vi.fn();
  render(
    <StudioNavItemInspector
      navId="navigation[0]"
      appDraft={{ navigation: [node] }}
      objects={PICKER_OBJECTS}
      packageId="com.acme.app"
      onNavPatch={onNavPatch}
      onClear={vi.fn()}
    />,
  );
  const object = PICKER_OBJECTS.find((o) => o.name === objectName)!;
  // objectui#12455 — the inspector also offers an Icon picker (a combobox), so the object picker is addressed by its test id.
  fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: `${object.label} (${object.name})` }));
  expect(onNavPatch).toHaveBeenCalledTimes(1);
  return (onNavPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> }).navigation[0];
}

describe('objectui#11201 — binding an object to a placeholder entry leaves it label-less', () => {
  // objectui#11196 re-judged the placeholder: a new canvas entry is born with
  // no `label` (it was born "New item", which this bind then removed).
  for (const objectName of ['account', 'draft_thing']) {
    it(`a new canvas entry, born label-less, bound to ${objectName} has NO \`label\` key, and parses`, async () => {
      const entry = await bind({ id: 'nav_item_1', type: 'object' }, objectName);
      expect(entry).toMatchObject({ id: 'nav_item_1', type: 'object', objectName });
      expect(Object.prototype.hasOwnProperty.call(entry, 'label')).toBe(false);
      expect(NavigationItemSchema.safeParse(JSON.parse(JSON.stringify(entry))).success).toBe(true);
    });
  }

  it('CONTROL — a label the author typed is kept as authored', async () => {
    const entry = await bind({ id: 'nav_clients', type: 'object', label: 'Clients' }, 'account');
    expect(entry.label).toBe('Clients');
  });

  it('a legacy stored "New item" label is a present label: kept verbatim, no sentinel matching (objectui#11196)', async () => {
    const entry = await bind({ id: 'nav_item_2', type: 'object', label: 'New item' }, 'account');
    expect(entry.label).toBe('New item');
  });
});
