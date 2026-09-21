// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The judgment half of `translation-per-app-settings-removed`. The D2
// conversion deletes the group mechanically; what it cannot say in a
// `to: '(removed)'` notice is that the strings being deleted were WORKING —
// and that deleting them changes what the deployment renders.
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
    'Not losslessly convertible, and NOT because the content was inert — the opposite. Measured on '
    + 'this tree before the split: `AppPlugin.loadTranslations` hands each `stack.translations` '
    + 'bundle entry WHOLE to `II18nService.loadTranslations`, the adapter deep-merges it into the '
    + 'one per-locale tree, and every platform plugin contributes into that same tree at '
    + '`kernel:ready` — so `settings` from an app bundle and `settings` from '
    + '`@objectstack/service-settings` land in one place. `resolveSettingsTitle` and the rest of the '
    + '`resolveSettings*` family read it (`pickSettingsEntry` → `pickData(bundle, locale)?.settings`), '
    + 'and so does the console’s `useSettingsLabel`, which scans every namespace carrying a '
    + '`settings` branch; the liveness ledger `packages/spec/liveness/translation.json` records that '
    + 'reader with its evidence pointer. An app-authored entry therefore RESOLVED, and what it '
    + 'resolved was an override of the platform’s own settings copy for that deployment, addressed '
    + 'by a namespace the application does not own. Dropping the group restores the platform string, '
    + 'which is the ruled intent — but it is a VISIBLE change to what a Settings screen renders, not '
    + 'a no-op, and a mechanical notice reading "(removed)" does not convey that. The two bundles '
    + 'are separate namespaces from this major on (ruling batch #132 item 2 letter ②, 2026-09-13; '
    + 'ADR-0049 enforce-or-remove supplied the question, not the answer — the maintainer struck the '
    + 'card’s own removal disposition, because `settings` is a LIVE platform key). No deprecation '
    + 'window: the per-app door refuses the key by name from this major, with the prescription on '
    + 'the rejection.',
  acceptanceCriteria:
    'No per-app bundle carries `settings`: `defineTranslationBundle({ <locale>: { settings: … } })` '
    + 'and a `defineStack({ translations: [...] })` entry carrying it are both refused as an '
    + 'unrecognized key, and the refusal names the group as platform-only rather than suggesting a '
    + 'rename (pinned in `packages/spec/src/system/translation.test.ts`). The platform face still '
    + 'accepts it: `PlatformTranslationDataSchema.parse({ settings: … })` succeeds, '
    + '`settingsBuiltinTranslations` still type-checks, and `GET /api/v1/i18n/translations/:locale` '
    + 'still declares `settings` on its response (`GetTranslationsResponseSchema`), because the '
    + 'served document is the merged tree. The registered `translation` metadata type is unchanged '
    + 'and still declares `settings`. For a deployment that WAS overriding platform settings copy '
    + 'from an app bundle: after the upgrade the affected Settings screens render the platform’s own '
    + 'strings again — confirm that is what you want, and if a platform string is wrong, correct it '
    + 'in the platform bundle rather than re-adding the app-side override.',
};
