// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `translation-per-app-settings-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `translationPerAppSettingsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `settings` on every APPLICATION-authored translation face — the platform-only
 * group leaving `stack.translations` with the type split (protocol 18, #15178,
 * ruling batch #132 item 2 letter ②) and then the registered `translation`
 * item (#19620, ruling batch #210 item 2 letter B), both faces in one entry.
 *
 * ⛔ NOT a lossless delete, and this entry says so rather than claiming the
 * house phrase. `settings` is keyed by `SettingsManifest.namespace`, and only
 * platform code declares a manifest — so the only namespaces an application
 * could address were the PLATFORM's own. Both bundles are loaded into ONE
 * served tree (`AppPlugin.loadTranslations` and each platform plugin's
 * `kernel:ready` contribution both call `II18nService.loadTranslations`, which
 * deep-merges), and `resolveSettingsTitle` / the console's `useSettingsLabel`
 * read that merged tree, so an app-authored entry DID resolve.
 *
 * What it did NOT do is override the platform. `AppPlugin` loads the app's
 * bundles in its own `start()` (kernel Phase 2); `SettingsServicePlugin`
 * contributes the platform's settings translations from a `kernel:ready` hook
 * (Phase 3); `deepMerge` gives the LATER source the leaf. So the platform won
 * every key both bundles defined, and a per-app entry rendered only where the
 * platform bundle carried no string for that key and locale — a gap filler on
 * a namespace the application does not own. Dropping it therefore takes those
 * gaps back to the manifest's own literal (the `?? fallback` every
 * `resolveSettings*` helper ends in), which is a VISIBLE change and not a
 * no-op. The semantic entry
 * `18.translation-per-app-settings-platform-only.ts` is where an author is
 * told that, because a notice reading "(removed)" does not say it.
 *
 * The ITEM shape went further, and that is why it is walked too (#19620). A
 * stored `translation` item is NOT a bundle loaded into the static tree: the
 * runtime-authored layer is read OVER the shipped bundles
 * (`deepMerge(static, authored)` in both i18n adapters), so an item's
 * `settings` did override the platform's own copy for its locale, not merely
 * fill gaps in it. Dropping it takes those keys back to the platform bundle's
 * string where it has one and to the manifest literal where it does not. The
 * seam that matters for an item is the runtime one: `authored-translation-sync`
 * replays this chain over each stored row before merging it
 * (`applyConversionsToStoredItem`), so a row written before the item door
 * closed stops overriding at the next sync, with this entry's notice logged,
 * rather than at the next re-save. That needed the stored pass itself to
 * reach `translation` rows at all — it had no collection for the type and
 * returned every one untouched (`STORED_ONLY_COLLECTIONS` in `./stored.ts`) —
 * which also puts the metadata API's reads and `os migrate meta --stored`
 * on this entry.
 *
 * Two shapes, told apart structurally rather than by key spelling:
 *
 * - **A bare item** carries `locale` (REQUIRED on an item since #3778), or —
 *   for a row written before `locale` was required, which the sync still reads
 *   by its name — has a declared translation GROUP as a top-level key. A
 *   bundle entry never does either: its top-level keys ARE the locale codes.
 *   Only the item's own top-level `settings` is stripped, so an object
 *   literally named `settings` under `objects` is untouched.
 * - **A bundle entry**: the candidate value under each locale must be a dict
 *   whose every key is a declared translation group — which an `objects`
 *   record, the one other dict-of-dicts at that depth, is not.
 */
const translationPerAppSettingsRemoved: MetadataConversion = {
  id: 'translation-per-app-settings-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'stack.translations[].<locale>.settings / translation.settings',
  summary:
    "translation group 'settings' removed from both application-authored faces, the per-app bundle "
    + 'entry and the registered translation item: settings copy belongs to the platform, and the two '
    + 'authoring doors of one application translation type accept one shape. It is keyed by '
    + 'SettingsManifest.namespace and only platform code declares a manifest. A per-app bundle entry '
    + "could only fill gaps the platform's own bundle left in the one merged served tree, and was "
    + 'overwritten wherever both defined the key; a stored item OVERRODE the platform copy, because the '
    + 'runtime-authored layer is read over the shipped bundles. Overrides now give way to the platform '
    + 'copy, gaps fall back to the manifest literal, and the group stays on the PLATFORM bundle, '
    + 'PlatformTranslationData',
  apply(stack, emit) {
    /** The top-level groups a translation bundle entry may carry (either face). */
    const GROUPS = new Set([
      'objects', 'apps', 'messages', 'globalActions', 'dashboards', 'datasets',
      'pages', 'flows', 'settings', 'metadataForms', 'settingsCommon',
    ]);
    return mapCollection(stack, 'translations', (entry, path) => {
      // A bare `translation` ITEM: strip its own top-level group only.
      if ('locale' in entry || Object.keys(entry).some((k) => GROUPS.has(k))) {
        return stripKeys(entry, ['settings'], emit, path);
      }
      let next = entry;
      for (const [locale, data] of Object.entries(entry)) {
        if (!isDict(data) || !isDict(data.settings)) continue;
        if (!Object.keys(data).every((k) => GROUPS.has(k))) continue;
        const stripped = stripKeys(data, ['settings'], emit, `${path}.${locale}`);
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
          'zh-CN': {
            settings: { mail: { title: '邮件投递', keys: { host: { label: '主机' } } } },
            // A neighbouring group on the same entry rides through untouched.
            apps: { crm: { label: '客户关系管理' } },
          },
        },
        {
          // The bare item shape a stored `translation` row replays as.
          name: 'ja_jp',
          locale: 'ja-JP',
          settings: { mail: { title: 'メール配信' } },
          messages: { commonSave: '保存' },
        },
        {
          // A row written before `locale` was required — told from a bundle
          // entry by its top-level group key. The object literally NAMED
          // `settings` is application copy under `objects` and stays.
          name: 'fr',
          objects: { settings: { label: 'Paramètres' } },
        },
      ],
    },
    after: {
      translations: [
        {
          'zh-CN': {
            apps: { crm: { label: '客户关系管理' } },
          },
        },
        {
          name: 'ja_jp',
          locale: 'ja-JP',
          messages: { commonSave: '保存' },
        },
        {
          name: 'fr',
          objects: { settings: { label: 'Paramètres' } },
        },
      ],
    },
    // One per stripped group: the `zh-CN` bundle entry and the `ja-JP` item.
    expectedNotices: 2,
  },
};

export { translationPerAppSettingsRemoved };
