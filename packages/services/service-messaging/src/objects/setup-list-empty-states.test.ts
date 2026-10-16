// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's Notification Preferences, Subscriptions and Templates lists draw
 * their OWN empty state.
 *
 * These three objects shipped no list view at all, so the console synthesized
 * an "All records" tab and drew the generic "Nothing here yet — Create your
 * first record" under it. A list view's `emptyState` is the only place the
 * spec carries per-list empty copy, so each object now ships one view, `all`,
 * declared for that copy and nothing else:
 *
 *  - `columns: []` declares no projection (the spec's "left to the renderer"
 *    form), so the grid keeps the columns the console derived before the view
 *    existed;
 *  - no `filter`, `sort` or `pagination`, so the rows and their order are the
 *    ones the synthesized tab showed.
 *
 * Both halves are pinned here because a later "tidy-up" that fills in columns
 * or a sort changes what an admin sees on these pages, which this view was
 * declared not to do. The copy itself is checked for presence in every locale
 * bundle this package ships, not for its wording.
 */

import { describe, expect, it } from 'vitest';
import { NotificationPreference, NotificationSubscription, NotificationTemplate } from './index.js';
import { enObjects } from '../translations/en.objects.generated.js';
import { zhCNObjects } from '../translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../translations/ja-JP.objects.generated.js';
import { esESObjects } from '../translations/es-ES.objects.generated.js';

interface ViewLike {
  columns?: unknown;
  filter?: unknown;
  sort?: unknown;
  pagination?: unknown;
  label?: unknown;
  emptyState?: { title?: unknown; message?: unknown };
}

interface ObjectLike {
  name: string;
  listViews?: Record<string, ViewLike>;
}

const OBJECTS = [NotificationPreference, NotificationSubscription, NotificationTemplate] as unknown as ObjectLike[];

const BUNDLES = { en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects } as const;

function views(def: ObjectLike): Array<[string, ViewLike]> {
  return Object.entries(def.listViews ?? {});
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('Setup notification lists declare their own empty state', () => {
  it.each(OBJECTS.map((def) => [def.name, def] as const))(
    '%s: ships a list view, and every list view declares an empty-state title and message',
    (_name, def) => {
      expect(views(def).length, `${def.name} declares no list views`).toBeGreaterThan(0);
      for (const [viewName, view] of views(def)) {
        const where = `${def.name}.listViews.${viewName}`;
        expect(nonEmptyString(view.emptyState?.title), `${where} declares no emptyState.title`).toBe(true);
        expect(nonEmptyString(view.emptyState?.message), `${where} declares no emptyState.message`).toBe(true);
      }
    },
  );

  it.each(OBJECTS.map((def) => [def.name, def] as const))(
    '%s: the `all` view changes nothing but the empty state — no projection, filter, sort or page size',
    (_name, def) => {
      const all = def.listViews?.all;
      expect(all, `${def.name} has no 'all' list view`).toBeDefined();
      expect(all?.columns).toEqual([]);
      expect(all?.filter).toBeUndefined();
      expect(all?.sort).toBeUndefined();
      expect(all?.pagination).toBeUndefined();
    },
  );

  it.each(Object.keys(BUNDLES))('the %s bundle carries every view\'s label and empty-state copy', (locale) => {
    const bundle = BUNDLES[locale as keyof typeof BUNDLES] as Record<string, { _views?: Record<string, ViewLike> }>;
    for (const def of OBJECTS) {
      for (const [viewName, view] of views(def)) {
        const leaf = bundle[def.name]?._views?.[viewName];
        const where = `${locale}: ${def.name}._views.${viewName}`;
        expect(nonEmptyString(leaf?.label), `${where}.label`).toBe(true);
        expect(nonEmptyString(leaf?.emptyState?.title), `${where}.emptyState.title`).toBe(true);
        expect(nonEmptyString(leaf?.emptyState?.message), `${where}.emptyState.message`).toBe(true);
        if (locale === 'en') {
          expect(leaf?.emptyState, `${where}.emptyState`).toEqual({
            title: view.emptyState?.title,
            message: view.emptyState?.message,
          });
        }
      }
    }
  });
});
