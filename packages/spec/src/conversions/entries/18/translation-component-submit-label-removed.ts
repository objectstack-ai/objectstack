// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `translation-component-submit-label-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `translationComponentSubmitLabelRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `translation.pages.<name>.components.<id>.submitLabel` — the component-copy
 * key retired with its only declarer (protocol 18, commit d173125fb, ADR-0049).
 *
 * The face is measured, not mirrored: each copy key exists because some
 * component in `ComponentPropsMap` declares it, and `submitLabel`'s only
 * declarer was `element:form` — retired whole by #9249 (`element-form-removed`
 * above). The maintainer ruled retire over re-anchor (2026-08-22, landed as commit d173125fb): the live form
 * surface's submit copy is `object-form`'s `submitText` (`I18nLabelSchema`),
 * localizable at its own authoring site, so re-anchoring would have widened
 * the face for one word. The key, its `submit` alias and its
 * `PAGE_COMPONENT_COPY_KEYS` slot are gone; the schema rejection carries the
 * prescription.
 *
 * Pure lossless delete — since #9249 no resolver overlaid the key, so a stored
 * translation kept a string nothing read. Both authored shapes are walked: a
 * bundle entry (locale → data map, `stack.translations`' declared shape) and a
 * bare data/item entry (groups at the top level — the shape stored `translation`
 * items replay through, the `translation-validation-messages-removed`
 * precedent).
 */
const translationComponentSubmitLabelRemoved: MetadataConversion = {
  id: 'translation-component-submit-label-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'translation.pages.components.submitLabel',
  summary:
    "translation component-copy key 'submitLabel' removed (retired rather than re-anchored — its "
    + "only declared carrier, 'element:form', retired whole because no renderer for it ever "
    + 'shipped, so the resolver no longer '
    + "overlays it and a stored string was read by nothing; the live form surface's submit copy "
    + "is 'object-form''s 'submitText', localized at its own authoring site, and re-anchoring the "
    + 'key there would only have added a second place to translate one word)',
  apply(stack, emit) {
    const stripFromData = (data: Record<string, unknown>, path: string): Record<string, unknown> => {
      const pages = data.pages;
      if (!isDict(pages)) return data;
      let pagesChanged = false;
      const nextPages: Record<string, unknown> = { ...pages };
      for (const [pageName, page] of Object.entries(pages)) {
        if (!isDict(page) || !isDict(page.components)) continue;
        let componentsChanged = false;
        const nextComponents: Record<string, unknown> = { ...page.components };
        for (const [id, entry] of Object.entries(page.components)) {
          if (!isDict(entry)) continue;
          const stripped = stripKeys(entry, ['submitLabel'], emit, `${path}.pages.${pageName}.components.${id}`);
          if (stripped === entry) continue;
          nextComponents[id] = stripped;
          componentsChanged = true;
        }
        if (!componentsChanged) continue;
        nextPages[pageName] = { ...page, components: nextComponents };
        pagesChanged = true;
      }
      return pagesChanged ? { ...data, pages: nextPages } : data;
    };
    return mapCollection(stack, 'translations', (entry, path) => {
      // Bare data/item shape: the groups sit at the entry's top level.
      let next = stripFromData(entry, path);
      // Bundle shape: locale code → data. Judged structurally (a dict whose
      // `pages` is a dict) rather than by key spelling — `LocaleSchema` judges
      // only a tag's shape, an open-ended set, so the locale keys cannot be
      // enumerated. A strip-only
      // walk makes a false positive a no-op: it removes nothing unless the
      // exact `pages.<name>.components.<id>.submitLabel` path is present.
      for (const [locale, data] of Object.entries(next)) {
        if (!isDict(data) || !isDict(data.pages)) continue;
        const stripped = stripFromData(data, `${path}.${locale}`);
        if (stripped === data) continue;
        next = next === entry ? { ...entry } : next;
        next[locale] = stripped;
      }
      return next;
    });
  },
  fixture: {
    before: {
      translations: [
        {
          // The bundle shape `stack.translations` declares.
          'zh-CN': {
            pages: {
              sales_home_page: {
                components: {
                  new_lead_form: { submitLabel: '创建' },
                  // Live keys on a neighbor ride through untouched.
                  quick_create: { title: '快速新建' },
                },
              },
            },
          },
        },
        {
          // The bare item shape stored `translation` rows replay through.
          name: 'ja_jp',
          locale: 'ja-JP',
          pages: {
            sales_home_page: {
              components: { new_lead_form: { submitLabel: '作成' } },
            },
          },
        },
      ],
    },
    after: {
      translations: [
        {
          'zh-CN': {
            pages: {
              sales_home_page: {
                components: {
                  new_lead_form: {},
                  quick_create: { title: '快速新建' },
                },
              },
            },
          },
        },
        {
          name: 'ja_jp',
          locale: 'ja-JP',
          pages: {
            sales_home_page: {
              components: { new_lead_form: {} },
            },
          },
        },
      ],
    },
    // One per stripped key instance: one in the bundle-shaped entry, one in
    // the item-shaped entry. The emptied component bag stays — the conversion
    // strips KEYS, and deleting the bag would be a second, unprescribed edit.
    expectedNotices: 2,
  },
};

export { translationComponentSubmitLabelRemoved };
