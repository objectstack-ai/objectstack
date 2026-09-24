// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { TranslationDataSchema } from '../../../system/translation.zod.js';
import type { SemanticMigration } from '../../types.js';

// The judgment half of `translation-per-app-settings-removed`. The D2
// conversion deletes the group mechanically; what it cannot say in a
// `to: '(removed)'` notice is WHERE those strings were rendering and what
// renders once they are gone — and the answer differs by door. From a per-app
// bundle they only ever filled gaps the platform's own bundle left, and those
// gaps go back to the manifest's English literal. From a `translation` item
// they OVERRODE the platform's copy (the runtime-authored layer is read over
// the shipped bundles), and those keys go back to the platform's string.
// Extended from the bundle door to the item door by #19620 (ruling batch #210
// item 2 letter B) rather than duplicated: one group, one ownership rule, one
// entry.
export const entry: SemanticMigration = {
  id: 'translation-per-app-settings-platform-only',
  surface:
    'stack.translations[].<locale>.settings and translation.settings — the settings group on the '
    + 'per-app bundle and on the registered `translation` item',
  // The group names are DERIVED from `TranslationDataSchema.shape`, never typed
  // out beside it. A hand-maintained copy of a schema's key set is the construct
  // that drifted to nine-of-ten in this very message, so the copy is deleted
  // rather than pinned: there is one spelling of the set, and a group added to
  // the per-app face reaches this sentence the day it is declared.
  // `Object.keys` on a zod object shape yields the declaration order of the
  // literal it was built from — the order this sentence promises the operator.
  // The `translation` item declares the same groups (plus `locale` and its
  // identity/envelope keys), so the one derived list answers both doors.
  // A getter, not an eager template: importing the registry must not force the
  // lazy translation schema at module load.
  get replacement(): string {
    const groups = Object.keys(TranslationDataSchema.shape);
    return 'Delete the group from the per-app bundle and from every `translation` item. There is no '
      + 'application-side replacement key: settings copy is not application-authorable at either door. '
      + '`settings` is keyed by `SettingsManifest.namespace`, and only platform code declares a manifest '
      + '(`packages/services/service-settings/src/manifests/*.manifest.ts`), so the only namespaces an '
      + 'application could ever address were the platform’s own. Platform settings copy is '
      + 'translated in the PLATFORM bundle — `@objectstack/service-settings`’s '
      + '`settingsBuiltinTranslations`, typed `PlatformTranslationData` — which is where a correction '
      + 'to a platform string belongs. An application’s own copy goes in the '
      + `${groups.length} groups the per-app bundle and the \`translation\` item still declare, in the `
      + 'order they declare them: '
      + groups.map((g) => `\`${g}\``).join(', ')
      + '. Note `settingsCommon` among them: it IS on both faces, so the Settings UI shell strings an '
      + 'application may translate (the source badges, under `settingsCommon.sourceLabels`) are NOT '
      + 'what is being removed here — only the per-namespace manifest copy under `settings` is.';
  },
  reason:
    'Not losslessly convertible, and NOT because the content was inert: what it did differs by door, '
    + 'and both effects are visible on screen. THE PER-APP BUNDLE — measured on this tree before the '
    + 'split: `AppPlugin.loadTranslations` hands each `stack.translations` bundle entry WHOLE to '
    + '`II18nService.loadTranslations`, the adapter deep-merges it into the one per-locale tree, and '
    + 'every platform plugin contributes into that same tree — so `settings` from an app bundle and '
    + '`settings` from `@objectstack/service-settings` land in one place. `resolveSettingsTitle` and '
    + 'the rest of the `resolveSettings*` family read it (`pickSettingsEntry` → '
    + "`pickData(bundle, locale)?.settings`), and so does the console's `useSettingsLabel`, which "
    + 'scans every namespace carrying a `settings` branch. ORDER decides the rest, and it runs against '
    + 'the application: `AppPlugin` loads the app’s bundles in its own `start()` (kernel Phase 2), '
    + '`SettingsServicePlugin` contributes the platform’s settings translations from a `kernel:ready` '
    + 'hook (Phase 3), and `deepMerge` gives the LATER source the leaf — `AppPlugin`’s own comment '
    + 'says as much (“the platform bundles have not arrived yet at this point in the lifecycle”). So '
    + 'the platform won every key both bundles defined, and what a per-app bundle actually had was a '
    + 'GAP FILLER on a namespace it does not own: the entry rendered only where the platform bundle '
    + 'carried no string for that key and locale (the platform ships en / zh-CN / ja-JP / es-ES), '
    + 'silently, with no way for the author to tell a filled gap from an ignored override. Dropping '
    + 'it takes those gaps back to the manifest’s own literal — the `?? fallback` every '
    + '`resolveSettings*` helper ends in, which is English. THE `translation` ITEM went further: a '
    + 'stored item is not loaded into the static tree at all but into the runtime-authored layer '
    + '(`authored-translation-sync` → `replaceAuthoredTranslations`), and both i18n adapters read '
    + 'that layer OVER the shipped bundles (`deepMerge(static, authored)`), whatever order they loaded '
    + 'in. So an item’s `settings` OVERRODE the platform’s own copy for its locale — a published item '
    + 'could rewrite a platform Settings screen — which is exactly what the ownership ruling says an '
    + 'application must not do. Dropping it takes each overridden key back to the platform bundle’s '
    + 'string, and each key it had filled back to the manifest literal. A mechanical notice reading '
    + '"(removed)" conveys neither. The two bundles are separate namespaces from this major on '
    + '(ruling batch #132 item 2 letter ②, 2026-09-13), and the item door follows the file door '
    + '(ruling batch #210 item 2 letter B, 2026-09-22: the file door and the item door are two '
    + 'authoring surfaces for ONE app metadata type, so they accept one shape; an admin override of '
    + 'platform copy, if ever wanted, is a platform-level feature, not app metadata). ADR-0049 '
    + 'enforce-or-remove supplied the question, not the answer — `settings` stays a LIVE platform '
    + 'key. No deprecation window: both doors refuse the key by name from this major, with the '
    + 'prescription on the rejection.',
  acceptanceCriteria:
    'No application-authored face carries `settings`. `defineTranslationBundle({ <locale>: { '
    + 'settings: … } })`, a `defineStack({ translations: [...] })` entry carrying it, '
    + '`defineTranslation({ locale, settings: … })` and a `translation` item saved through the '
    + 'metadata API carrying it are all refused as an unrecognized key, and each refusal names the '
    + 'group as platform-only rather than suggesting a rename (pinned in '
    + '`packages/spec/src/system/translation.test.ts`; the metadata door answers `422 '
    + 'INVALID_METADATA`, pinned in `packages/metadata-protocol`). The platform face still accepts it: '
    + '`PlatformTranslationDataSchema.parse({ settings: … })` succeeds, `settingsBuiltinTranslations` '
    + 'still type-checks, and `GET /api/v1/i18n/translations/:locale` still declares `settings` on '
    + 'its response (`GetTranslationsResponseSchema`), because the served document is the merged '
    + 'tree. A `translation` row ALREADY STORED with `settings` is not refused — a stored row has no '
    + 'author to teach — it is converted: the runtime sync replays this conversion before merging the '
    + 'row, logs the conversion notice once, and loads the rest of the item, so its `settings` stops '
    + 'overriding at the next sync; `os migrate meta --stored --apply` persists the canonical row. '
    + 'For a deployment that WAS authoring settings copy, re-read the Settings screens in each locale '
    + 'it covered: where a `translation` item overrode a platform string, the platform’s string '
    + 'renders again; where either door filled a GAP — a namespace, key or locale the platform bundle '
    + 'does not translate — the manifest’s own literal renders, which is English. If a platform string '
    + 'is wrong or missing for your locale, correct it in the platform bundle '
    + '(`@objectstack/service-settings`’s `settingsBuiltinTranslations`) — ⛔ do not re-add '
    + 'app-side copy at either door, which is refused.',
};
