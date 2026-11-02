---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the settings hub tells a member that an administrator manages the settings

Clause-②: yes (widening)
Metadata-protocol: none

- **A member is no longer shown a developer sentence.** `GET /api/settings` lists only the manifests the caller may read, and a manifest that declares no `readPermission` reads at the spec default, `setup.access`. A plain member opening the settings hub under an app they may use was answered an empty list and read "No settings registered. Plugins can register settings manifests via the SettingsService." The hub now asks the capability answer the Console already holds (`/auth/me/permissions`, through `MePermissionsProvider`; no new request): a caller without `setup.access` reads "Settings are managed by your administrator" with a line saying to ask an administrator, in the style of the app-level "You don't have access" screen.
- **The empty message for an administrator is reworded out of developer language:** "No settings pages are available yet. They appear here when an installed app provides them." A caller with manifests sees the list unchanged. An unreported capability answer fails open onto this message, as every capability gate does.
- **New strings** `console.settingsHub.adminManaged` and `console.settingsHub.adminManagedDescription`, and the reworded `console.settingsHub.empty`, in all ten locale packs. The two new keys widen the exported `en` catalogue and `TranslationKeys` type; nothing is removed.
