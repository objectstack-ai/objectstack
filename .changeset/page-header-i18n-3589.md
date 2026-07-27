---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/cli": minor
"@objectstack/rest": patch
---

feat(spec): resolve page metadata i18n — `page:header` title/subtitle (#3589)

Custom system pages authored as metadata (Installed Apps, Cloud Connection,
Connect an Agent) hard-code their `page:header` copy in
`properties.title` / `properties.subtitle`. Every other metadata type is
localized at the REST boundary, but `page` was not: the `pages` namespace
existed only on `AppTranslationBundleSchema` — a schema no runtime reads —
with no resolver behind it, so those headers stayed English in every locale
while the matching nav labels translated correctly.

- `TranslationDataSchema` (the shape the i18n service actually serves) gains a
  `pages` namespace: `pages.<name>.{label,description,title,subtitle}`.
- New `translatePage` in `@objectstack/spec/system` translates a page's own
  `label` / `description` and overlays `title` / `subtitle` onto every
  `page:header` in the page's regions. Registered in
  `translateMetadataDocument`, so it rides the existing read path.
- `page` added to the REST boundary's `TRANSLATABLE_META_TYPES`. Locale
  extraction, the locale-keyed ETag, and `Vary: Accept-Language` already
  covered every metadata type — no new plumbing.
- `objectstack i18n extract` now emits page entries, including the
  `page:header` copy, so the new namespace is not invisible to the tooling.
- zh-CN / ja-JP / es-ES translations shipped for the three Setup pages, plus
  the missing `nav_cloud_connection` / `nav_connect_agent` nav labels (these
  existed only in zh-CN).

Header copy is keyed by **page name**, not by component id: `page:header`
instances carry no stable id. `title` falls back to `pages.<name>.label`, since
a page's header title and its nav label are normally the same string.

Authoring is unchanged and English literals stay in metadata as the fallback —
a page with no `pages` entry renders exactly as before. Consumers of
`@object-ui` need no change: pages arrive already localized from the server.
