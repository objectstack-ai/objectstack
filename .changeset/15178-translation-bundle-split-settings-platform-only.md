---
'@objectstack/spec': minor
'@objectstack/service-settings': minor
---

**BREAKING for per-app translation bundles** — the translation bundle type splits in two: `settings` is a PLATFORM group and a per-app bundle may no longer declare it (#15178)

Clause-②: yes

`TranslationDataSchema` served two different bundles at once — the per-app one an
application authors (`stack.translations`, `defineTranslationBundle`) and the
code-authored bundles the platform packages ship. It now names the **per-app**
bundle entry and declares ten groups; the new `PlatformTranslationDataSchema` /
`PlatformTranslationBundleSchema` (types `PlatformTranslationData` /
`PlatformTranslationBundle`) carry the eleven-group platform face, `settings`
included.

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `defineTranslationBundle({ 'zh-CN': { settings: { mail: { title: '邮件投递' } } } })` | delete the `settings` group — there is no per-app replacement key |
| `defineStack({ translations: [{ 'zh-CN': { settings: … } }] })` | delete the `settings` group from the bundle entry |
| `const b: TranslationBundle = { en: { settings: … } }` — a PLATFORM package's own bundle | `const b: PlatformTranslationBundle = { en: { settings: … } }` |
| `const d: TranslationData = { settings: … }` — a PLATFORM package's own locale entry | `const d: PlatformTranslationData = { settings: … }` |

**The one-line fix for an application: delete the `settings` group.** Settings copy
is not application-authorable at all — `settings` is keyed by
`SettingsManifest.namespace` and only platform code declares a manifest, so the
only namespaces a per-app entry could ever address were the platform's own.
`settingsCommon` is **not** affected — the Settings UI shell strings (the source
badges, under `settingsCommon.sourceLabels`) stay on the per-app face; only the
per-namespace manifest copy under `settings` leaves.
Run `os migrate meta --from 17` to list the mechanical edits for existing
sources; apply them by hand.

### What the deletion changes, which is not nothing

⚠️ This is **not** a lossless delete, and the record says so rather than claiming
the house phrase. Both bundles load into ONE served tree — `AppPlugin`'s
`loadTranslations` and every platform plugin's `kernel:ready` contribution both
call `II18nService.loadTranslations`, which deep-merges — and the
`resolveSettings*` family and the console's settings labels read that merged
tree. So an app-authored `settings` branch did resolve.

**It was a gap filler, not an override.** The app's bundles are loaded in
`AppPlugin`'s own `start()` (kernel Phase 2); the platform's settings
translations arrive from `SettingsServicePlugin`'s `kernel:ready` hook (Phase
3); `deepMerge` gives the **later** source the leaf. So the platform won every
key both bundles defined, and a per-app entry rendered **only where the platform
bundle carried no string for that key and locale** — the platform ships `en`,
`zh-CN`, `ja-JP` and `es-ES`.

**What to expect after upgrading.** Where the platform already carried the
string, nothing changes on screen — that value was the one being served all
along. Where your entry was filling a gap, that Settings screen now renders the
**manifest's own literal, which is English** (the `?? fallback` every
`resolveSettings*` helper ends in). Those are the screens to re-read. If a
platform string is wrong or missing for your locale, correct it in the platform
bundle (`@objectstack/service-settings`'s `settingsBuiltinTranslations`) — do
not re-add the app-side copy, which the platform overwrites on every boot
wherever it has its own value.

No deprecation window: the per-app door refuses the key by name from this major,
and the rejection carries the prescription above.

### Unchanged

The registered `translation` metadata type (`TranslationItemSchema`) still
declares `settings` — this ruling covers the file-authored bundle. `GET
/api/v1/i18n/translations/:locale` still declares it on its response, because the
served document is the merged tree; `GetTranslationsResponseSchema` is typed
against the platform face for exactly that reason.

Ruling batch #132 item 2 letter ② (2026-09-13) — 「同意」. The card's original
"removal" disposition is struck: `settings` is a live platform key.

<!-- adr-0087: registered translation-per-app-settings-removed -->
