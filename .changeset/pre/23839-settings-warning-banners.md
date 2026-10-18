---
'@objectstack/service-settings': patch
---

Clause-②: no

fix(service-settings): the File Storage, Knowledge and AI settings pages show their warnings as `info_banner` callouts with `bannerSeverity: 'warning'`, not as a sentence inside a subtitle or a field's help text

Four warnings were written into ordinary strings with a hand-typed warning glyph, so the admin read them as one more sentence of the page subtitle or of a toggle's help. Each one is now an `info_banner` row in the section it concerns, directly under the field it warns about:

- `storage` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing files.
- `knowledge` — `adapter_switch_warning`, under the Adapter select: switching adapter does not migrate existing indices.
- `knowledge` — `enforce_rls_warning`, under the Enforce RLS on search toggle: disabling it skips the vector-store leakage safeguard.
- `ai` — `log_prompts_warning`, under the Log full prompts toggle: full prompts may leak PII.

The namespace description or field help of each keeps its non-warning text. The translations moved with them: in the `en`, `zh-CN`, `ja-JP` and `es-ES` bundles each warning sentence left the `description` / `help` copy and sits under `settings.NAMESPACE.banners.BANNER_ID.{title,text}`, with a translated title per banner. The existing Feature Flags `beta_notice` banner gained the same copies, so no shipped locale reads it in English any more.

No setting key, value, default or save behaviour changes. A host that renders `info_banner` rows from the manifest literals draws the English title and text; translated copy is read through `resolveSettingsBannerTitle` / `resolveSettingsBannerText` from `@objectstack/spec/system`.
