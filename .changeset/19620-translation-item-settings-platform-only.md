---
'@objectstack/spec': minor
'@objectstack/core': minor
---

**BREAKING for runtime-authored `translation` items** — the registered `translation` metadata type no longer declares `settings`: platform settings copy is platform-only at BOTH application doors (#19620)

Clause-②: no

`TranslationItemSchema` — one `translation` metadata item, authored with
`defineTranslation`, in Studio, or through the metadata API — now takes the same
ten groups as a per-app bundle entry (`TranslationData`). `settings`, and its
singular `setting`, are refused by name with the platform-only prescription,
exactly as the per-app bundle has refused them since #15178. The file door and
the item door are two authoring surfaces for one app metadata type, so they
accept one shape.

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `defineTranslation({ locale: 'zh-CN', settings: { mail: { title: '邮件投递' } } })` | delete the `settings` group — there is no application-side replacement key |
| a `translation` item saved through the metadata API or Studio carrying `settings` | delete the `settings` group; the save answers `422 INVALID_METADATA` until you do |
| `const t: TranslationItem = { locale: 'en', settings: … }` | move the copy to the PLATFORM bundle (`PlatformTranslationData`), or delete it |

**The one-line fix: delete the `settings` group from the item.** Settings copy is
not application-authorable — `settings` is keyed by `SettingsManifest.namespace`
and only platform code declares a manifest. `settingsCommon` is **not** affected:
the Settings UI shell strings (the source badges, under
`settingsCommon.sourceLabels`) stay on both application faces.
Run `os migrate meta --from 17` to list the mechanical edits for existing
sources; apply them by hand.

### Rows already stored are converted, not refused

A `translation` row saved before this change keeps loading. The runtime
translation sync (`@objectstack/core`'s `authored-translation-sync`) reads
`sys_metadata` itself and used to merge the RAW stored payload; it now replays
the ADR-0087 conversion chain over each row before merging it, the same policy
as every other stored-metadata read seam. `translation-per-app-settings-removed`
has learned the item shape, so a stored row's `settings` is dropped there, the
rest of the item (`objects`, `apps`, …) still loads, and the server logs one
warning per row naming the row, the group and the conversion. Run
`os migrate meta --stored --apply` to persist the canonical rows.

### What changes on screen, which is not nothing

On the item door the group was STRONGER than on the bundle door. A published
item is loaded into the runtime-authored layer, which both i18n adapters read
**over** the shipped bundles — so an item's `settings` overrode the platform's
own Settings copy for its locale, rather than only filling gaps. After
upgrading, re-read the Settings screens in each locale such an item covered:
where it overrode a platform string, **the platform's string renders again**;
where it filled a gap the platform bundle leaves, the **manifest's own literal
renders, which is English**. If a platform string is wrong or missing for your
locale, correct it in the platform bundle (`@objectstack/service-settings`'s
`settingsBuiltinTranslations`).

No deprecation window: the item door refuses the key by name from this major.

### Unchanged

The platform face — `PlatformTranslationDataSchema`, `settingsBuiltinTranslations`,
and `GET /api/v1/i18n/translations/:locale`, whose served document is the merged
tree — still declares `settings`. The liveness ledger's `translation.settings`
row is deleted because the key left the ITEM's shape; the platform capability it
evidenced is untouched.

Ruling batch #210 item 2 letter B (2026-09-22) — maintainer 「210 同意」.

<!-- adr-0087: registered translation-per-app-settings-removed, translation-per-app-settings-platform-only -->
