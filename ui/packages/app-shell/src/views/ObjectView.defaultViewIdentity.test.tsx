/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The default list view's translation key resolves end-to-end (objectui#3770).
 *
 * objectstack#5164 ruling A settled ONE spelling for `_views` translation keys:
 * the runtime view identity's bare name. The i18n extractor derives it from the
 * view composer (objectstack#6124) and `packages/lint` enforces it
 * (objectstack#6038), so a container's default `list` — declared without a
 * `name` — is published as `objects.<object>._views.default.label`.
 *
 * This renderer derived `list.name || 'list'` instead: a third spelling no
 * producer emits. The default list's tab label therefore probed
 * `_views.list.label`, missed, and fell back to the English metadata label,
 * while every named view resolved fine. Neither repo had a test over this seam,
 * which is why the rename landed green on both sides.
 *
 * What is pinned here is the whole chain a default-list-only object travels:
 *
 *   server TranslationData (keyed `_views.default`)
 *     → transformSpecTranslations  (the console's loadLanguage transform)
 *   defineView container
 *     → mergeViewsIntoObjects      (the id + `name` the renderer carries)
 *     → defaultListViewId          (the id ObjectView promotes / persists by)
 *     → useObjectLabel().viewLabel(objectName, view.name || view.id, fallback)
 *
 * The last link is the one-line expression ObjectView passes at its two call
 * sites (`view.name || view.id`); everything before it is the real function.
 *
 * REVERSE VERIFICATION — both directions predicted before running, and observed:
 * restoring the retired derivation (`primary.name || 'list'` in ObjectView plus
 * `bucket.listViews[view.list.name || 'list']` in MetadataProvider) turns the
 * `_views.default` chain RED (`expected 'list' to be 'showcase_contact.default'`)
 * — and turns the negative assertion red in the OPPOSITE direction: the dead key
 * starts resolving (`expected '不该命中' to be 'All Contacts'`). The record-gate
 * case below stays GREEN under that revert, which is the point — that gate was
 * already correct and this change must not move it. Asserting both directions
 * means a partial revert of either call site cannot stay green.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import {
  I18nProvider,
  useObjectTranslation,
  useObjectLabel,
  isSpecTranslationData,
  transformSpecTranslations,
  pickLocalized,
} from '@object-ui/i18n';
import { ViewItemNameSchema } from '@objectstack/spec/ui';
import { mergeViewsIntoObjects } from '../providers/MetadataProvider';
import { defaultListViewId } from '../utils/viewIdentity';

/** A showcase-shaped object whose ONLY list view is the container's default. */
const OBJECT = { name: 'showcase_contact', label: 'Contact', fields: { name: { type: 'text' } } };

/**
 * The container as `defineView` emits it (examples/app-showcase
 * `ui/views/contact.view.ts`): a default `list` with no `name`, plus one named
 * secondary view so the "named views are unaffected" leg rides the same fixture.
 */
/**
 * The `I18nLabel` description authored on the default list — the ONE channel a
 * view description has after objectui#7219. Deliberately a different string
 * from `ZH_PAYLOAD`'s catalog `description` below, so the two cannot be
 * confused for one another at an assertion.
 */
const AUTHORED_LIST_DESCRIPTION = {
  en: 'Every contact record, authored on the view.',
  zh: '作者撰写：全部联系人记录。',
};

const CONTAINER = {
  name: 'showcase_contact',
  list: {
    label: 'All Contacts',
    description: AUTHORED_LIST_DESCRIPTION,
    type: 'grid',
    data: { provider: 'object', object: 'showcase_contact' },
    columns: [{ field: 'name' }],
  },
  listViews: {
    recent: { label: 'Recently Added', type: 'grid', columns: [{ field: 'name' }] },
  },
};

/**
 * The zh-CN payload as `/api/v1/i18n/translations/:locale` serves it after
 * objectstack#6124 migrated the bundle — the default list keyed `default`.
 */
const ZH_PAYLOAD = {
  objects: {
    showcase_contact: {
      label: '联系人',
      fields: { name: { label: '姓名' } },
      _views: {
        default: {
          label: '联系人',
          description: '全部联系人记录',
          emptyState: { title: '暂无联系人', message: '新建一个联系人开始。' },
        },
        recent: { label: '最近添加' },
      },
    },
  },
};

/** Same payload authored against the retired spelling — must NOT resolve. */
const ZH_PAYLOAD_RETIRED_KEY = {
  objects: {
    showcase_contact: {
      fields: { name: { label: '姓名' } },
      _views: { list: { label: '不该命中' } },
    },
  },
};

const wrapper = ({ children }: { children: React.ReactNode }) =>
  // `children` in the PROPS object, not the third argument: `I18nProviderProps`
  // declares it required, and the third-argument form does not satisfy that
  // overload (objectui#4040, same fix as packages/react's tranche).
  React.createElement(I18nProvider, {
    config: { defaultLanguage: 'zh', detectBrowserLanguage: false },
    children,
  });

/** Mount the real resolver over a server payload, exactly as the console does. */
function withServerBundle(payload: Record<string, unknown>) {
  expect(isSpecTranslationData(payload)).toBe(true);
  const { result } = renderHook(
    () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  result.current.i18n.addResourceBundle(
    'zh',
    'translation',
    transformSpecTranslations(payload as never),
    true,
    true,
  );
  return result.current.labels;
}

/** The merged object definition an ObjectView receives for this container. */
function mergedObject(container: Record<string, unknown>) {
  const [obj] = mergeViewsIntoObjects([{ ...OBJECT }], [container]);
  return obj as any;
}

/**
 * One switcher tab, built the way ObjectView's `views` memo builds it:
 * `{ id: <listViews key>, ...entry }` (the spread cannot clobber `id`, and an
 * entry with no `name` of its own therefore falls back to the key).
 */
const viewTab = (obj: any, id: string) => ({ id, ...obj.listViews[id] });

/** Exactly what ObjectView hands `viewLabel` for a tab. */
const translationArg = (view: any): string => view.name || view.id;

describe('default list view identity → _views translation key (objectui#3770)', () => {
  it('resolves the default list label/emptyState under `_views.default`', () => {
    const labels = withServerBundle(ZH_PAYLOAD);
    const obj = mergedObject(CONTAINER);
    const primaryId = defaultListViewId(obj.name, obj.list)!;

    expect(primaryId).toBe('showcase_contact.default');
    expect(obj.listViews[primaryId]).toBeTruthy();
    const entry = viewTab(obj, primaryId);

    expect(labels.viewLabel(obj.name, translationArg(entry), entry.label)).toBe('联系人');
    // `description` is deliberately NOT in this list any more — the catalog key
    // on this same node was retired by objectui#7219 and its inertness is the
    // case below. `label` and `emptyState` are the surfaces that stayed.
    expect(
      labels.viewEmptyState(obj.name, translationArg(entry), {
        title: 'No contacts',
        message: 'Create one to begin.',
      }),
    ).toMatchObject({ title: '暂无联系人', message: '新建一个联系人开始。' });
  });

  it('leaves a `_views.<view>.description` catalog entry INERT (objectui#7219)', () => {
    // Ruled 2026-09-02, option B: the catalog convention
    // `objects.<object>._views.<view>.description` is retired with the
    // `useObjectLabel().viewDescription()` member that resolved it. A list
    // view's description has exactly one channel — the `I18nLabel` authored on
    // the view entry, relayed by ObjectView (objectui#7199) and resolved at the
    // render site with `pickLocalized`, the call `plugin-list`'s `ListView`
    // makes on `schema.description`.
    //
    // ⚠️ This deliberately does more than assert the member is gone; that alone
    // would be green on any tree where it never existed. `ZH_PAYLOAD` AUTHORS
    // the catalog `description`, the control below proves that node is live and
    // this fixture reaches it, and the authored value is a DIFFERENT string
    // that arrives through the real pipeline (`expandViewContainer` →
    // `mergeViewsIntoObjects`) rather than being typed in at the assertion.
    const labels = withServerBundle(ZH_PAYLOAD);
    const obj = mergedObject(CONTAINER);
    const entry = viewTab(obj, defaultListViewId(obj.name, obj.list)!);

    // CONTROL — the `_views.default` node carrying the catalog `description`
    // resolves: its `label` sibling comes back translated from the bundle.
    expect(labels.viewLabel(obj.name, translationArg(entry), entry.label)).toBe('联系人');

    // Nothing on the hook reads that node's `description`: not at runtime…
    expect(Object.keys(labels)).not.toContain('viewDescription');
    // …and not in the return type, the half `@object-ui/i18n`'s changeset
    // announces (`tsconfig.test.json` compiles this file, so this is checked).
    // @ts-expect-error removed from the hook's return type by objectui#7219.
    expect(labels.viewDescription).toBeUndefined();

    // The authored `I18nLabel` survives the merge onto the entry ObjectView
    // hands its relay…
    expect(entry.description).toEqual(AUTHORED_LIST_DESCRIPTION);
    // …and that is what resolves for the audience locale…
    expect(pickLocalized(entry.description, 'zh')).toBe('作者撰写：全部联系人记录。');
    // …never the catalog string, which is what a wired-in catalog channel would
    // have put on screen instead.
    expect(pickLocalized(entry.description, 'zh')).not.toBe(
      ZH_PAYLOAD.objects.showcase_contact._views.default.description,
    );
  });

  it('does NOT resolve the retired `_views.list` spelling', () => {
    // The dialect this issue removed. A bundle authored against it must miss and
    // fall back to the metadata label — same as any other unknown key — so the
    // authoring mistake stays visible instead of half-working in this one client.
    const labels = withServerBundle(ZH_PAYLOAD_RETIRED_KEY);
    const obj = mergedObject(CONTAINER);
    const entry = viewTab(obj, defaultListViewId(obj.name, obj.list)!);
    expect(labels.viewLabel(obj.name, translationArg(entry), entry.label)).toBe('All Contacts');
  });

  it('leaves named views resolving by their own bare key', () => {
    const labels = withServerBundle(ZH_PAYLOAD);
    const obj = mergedObject(CONTAINER);
    expect(obj.listViews['showcase_contact.recent']).toBeTruthy();
    const recent = viewTab(obj, 'showcase_contact.recent');
    expect(labels.viewLabel(obj.name, translationArg(recent), recent.label)).toBe('最近添加');
  });

  it('keeps a named default list on its author-supplied key', () => {
    const labels = withServerBundle({
      objects: {
        showcase_contact: {
          fields: { name: { label: '姓名' } },
          _views: { my_list: { label: '我的列表' } },
        },
      },
    });
    const obj = mergedObject({
      name: 'showcase_contact',
      list: { name: 'my_list', label: 'My List', type: 'grid', columns: [{ field: 'name' }] },
    });
    const primaryId = defaultListViewId(obj.name, obj.list)!;
    expect(primaryId).toBe('showcase_contact.my_list');
    expect(
      labels.viewLabel(obj.name, translationArg(viewTab(obj, primaryId)), 'My List'),
    ).toBe('我的列表');
  });

  it('resolves the same key for the record gate, whose ids were already correct', () => {
    // The framework registers a container AND its expansion, so this shape is
    // what a real backend serves. It resolved before this fix too — asserted so
    // the two gates are pinned to ONE spelling rather than drifting apart again.
    const labels = withServerBundle(ZH_PAYLOAD);
    const [obj] = mergeViewsIntoObjects([{ ...OBJECT }], [
      {
        name: 'showcase_contact.default',
        object: 'showcase_contact',
        viewKind: 'list',
        isDefault: true,
        label: 'All Contacts',
        config: { type: 'grid', columns: [{ field: 'name' }] },
      },
    ]);
    const entry = viewTab(obj, 'showcase_contact.default');
    expect(labels.viewLabel(obj.name, translationArg(entry), entry.label)).toBe('联系人');
  });
});

/**
 * Stored-data surface, measured before the behaviour change and pinned here.
 *
 * A view's stored row is keyed by VIEW ID: the explicit save writes
 * `persistRuntimeMetadata('view', vid, …)`, and the override rows the page
 * reads back (`loadViewOverrides`) are found by the same id — one
 * `sys_metadata` row of type `view` NAMED by the id. (The toolbar's
 * `persistViewPatch` → `updateViewConfig` wrote its overlays the same way,
 * `saveItem('view', view.id, { …cfg, object, name: view.id })`, until
 * objectui#12504 retired it; those rows are still at rest.) The id therefore
 * doubles as the persistence key, and `ViewItemNameSchema` is the spec's
 * judgment on which strings are legal view identities:
 *
 *   /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
 *
 * The retired `'list'` derivation is not one of them — bare, no object prefix —
 * so it never had a legitimate stored row to migrate to the new id; the composer
 * identity is representable. (`defaultViewId` is derived per render from
 * `views.find(v => v.isDefault)` and never persisted, so it holds no stored
 * state of its own.)
 */
describe('the derived id is a representable view identity (persistence key)', () => {
  const legal = (id: string) => ViewItemNameSchema.safeParse(id).success;

  it('accepts the composer identity and rejects the retired `list` spelling', () => {
    const obj = mergedObject(CONTAINER);
    expect(legal(defaultListViewId(obj.name, obj.list)!)).toBe(true);
    expect(legal('list')).toBe(false);
  });

  it('is stable under re-derivation, so a saved override is never re-keyed', () => {
    // ObjectView derives the id on every render (overrides effect + view list),
    // and the merged entry it re-reads already carries the qualified name.
    // Feeding that back in must yield the SAME id — otherwise each pass would
    // persist under a fresh name and orphan the previous one.
    const obj = mergedObject(CONTAINER);
    const first = defaultListViewId(obj.name, obj.list)!;
    expect(defaultListViewId(obj.name, obj.listViews[first])).toBe(first);
    expect(defaultListViewId(obj.name, { name: first })).toBe(first);
  });

  it('returns undefined when the object declares no default list', () => {
    // No `objectDef.list` → no primary promotion and no override id, instead of
    // a synthesized one that would collide with a real view.
    expect(defaultListViewId('showcase_contact', undefined)).toBeUndefined();
    expect(defaultListViewId('showcase_contact', null)).toBeUndefined();
  });
});
