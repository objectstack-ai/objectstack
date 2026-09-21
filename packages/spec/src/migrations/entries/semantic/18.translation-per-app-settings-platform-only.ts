// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The judgment half of `translation-per-app-settings-removed`. The D2
// conversion deletes the group mechanically; what it cannot say in a
// `to: '(removed)'` notice is WHERE those strings were rendering — only in the
// gaps the platform's own bundle left — and that deleting them sends those
// gaps back to the manifest's English literal.
export const entry: SemanticMigration = {
  id: 'translation-per-app-settings-platform-only',
  surface: 'stack.translations[].<locale>.settings — the per-app bundle’s settings group',
  replacement:
    'Delete the group from the per-app bundle. There is no per-app replacement key: settings copy '
    + 'is not application-authorable at all. `settings` is keyed by `SettingsManifest.namespace`, '
    + 'and only platform code declares a manifest '
    + '(`packages/services/service-settings/src/manifests/*.manifest.ts`), so the only namespaces a '
    + 'per-app entry could ever address were the platform’s own. Platform settings copy is '
    + 'translated in the PLATFORM bundle — `@objectstack/service-settings`’s '
    + '`settingsBuiltinTranslations`, typed `PlatformTranslationData` — which is where a correction '
    + 'to a platform string belongs. An application’s own copy goes in the groups the per-app bundle '
    + 'still declares: `objects`, `apps`, `pages`, `dashboards`, `datasets`, `flows`, '
    + '`globalActions`, `metadataForms`, `messages`.',
  reason:
    'Not losslessly convertible, and NOT because the content was inert — but not because it '
    + 'overrode anything either. Measured on this tree before the split: '
    + '`AppPlugin.loadTranslations` hands each `stack.translations` bundle entry WHOLE to '
    + '`II18nService.loadTranslations`, the adapter deep-merges it into the one per-locale tree, and '
    + 'every platform plugin contributes into that same tree — so `settings` from an app bundle and '
    + '`settings` from `@objectstack/service-settings` land in one place. `resolveSettingsTitle` and '
    + 'the rest of the `resolveSettings*` family read it (`pickSettingsEntry` → '
    + "`pickData(bundle, locale)?.settings`), and so does the console's `useSettingsLabel`, which "
    + 'scans every namespace carrying a `settings` branch; the liveness ledger '
    + '`packages/spec/liveness/translation.json` records that reader with its evidence pointer. '
    + 'ORDER decides the rest, and it runs against the application: `AppPlugin` loads the app’s '
    + 'bundles in its own `start()` (kernel Phase 2), `SettingsServicePlugin` contributes the '
    + 'platform’s settings translations from a `kernel:ready` hook (Phase 3), and `deepMerge` gives '
    + 'the LATER source the leaf — `AppPlugin`’s own comment says as much (“the platform bundles have '
    + 'not arrived yet at this point in the lifecycle”). So the platform won every key both bundles '
    + 'defined, and what an application actually had was a GAP FILLER on a namespace it does not own: '
    + 'the entry rendered only where the platform bundle carried no string for that key and locale '
    + '(the platform ships en / zh-CN / ja-JP / es-ES), silently, with no way for the author to tell '
    + 'a filled gap from an ignored override. Dropping the group therefore takes those gaps back to '
    + 'the manifest’s own literal — the `?? fallback` every `resolveSettings*` helper ends in, which '
    + 'is English — and that is a VISIBLE change to what a Settings screen renders, not a no-op, '
    + 'which a mechanical notice reading "(removed)" does not convey. The two bundles are separate '
    + 'namespaces from this major on (ruling batch #132 item 2 letter ②, 2026-09-13; ADR-0049 '
    + 'enforce-or-remove supplied the question, not the answer — the maintainer struck the card’s own '
    + 'removal disposition, because `settings` is a LIVE platform key). No deprecation window: the '
    + 'per-app door refuses the key by name from this major, with the prescription on the rejection.',
  acceptanceCriteria:
    'No per-app bundle carries `settings`: `defineTranslationBundle({ <locale>: { settings: … } })` '
    + 'and a `defineStack({ translations: [...] })` entry carrying it are both refused as an '
    + 'unrecognized key, and the refusal names the group as platform-only rather than suggesting a '
    + 'rename (pinned in `packages/spec/src/system/translation.test.ts`). The platform face still '
    + 'accepts it: `PlatformTranslationDataSchema.parse({ settings: … })` succeeds, '
    + '`settingsBuiltinTranslations` still type-checks, and `GET /api/v1/i18n/translations/:locale` '
    + 'still declares `settings` on its response (`GetTranslationsResponseSchema`), because the '
    + 'served document is the merged tree. The registered `translation` metadata type is unchanged '
    + 'and still declares `settings`. For a deployment that WAS authoring per-app settings copy: the '
    + 'screens to re-read after the upgrade are the ones where it was FILLING A GAP — a namespace, '
    + 'key or locale the platform bundle does not translate — because those now render the '
    + 'manifest’s own literal, which is English. Everywhere the platform already carried the string, '
    + 'nothing changes on screen: the platform value was already the one being served. If a platform '
    + 'string is wrong or missing for your locale, correct it in the platform bundle '
    + '(`@objectstack/service-settings`’s `settingsBuiltinTranslations`) — ⛔ do not re-add the '
    + 'app-side copy, which the platform overwrites on every boot wherever it has its own value.',
};
