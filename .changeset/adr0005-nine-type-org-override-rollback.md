---
"@objectstack/spec": minor
---

ADR-0005 whitelist enforced: nine unratified `allowOrgOverride: true` flags rolled back to `false` (#6483)

`DEFAULT_METADATA_TYPE_REGISTRY` granted per-org overlay writes to nine metadata types the ADR-0005 tenant-customizable whitelist (docs/adr/0005-metadata-customization-overlay.md §"Tenant-customizable type whitelist") never admitted: `page`, `app`, `action`, `dataset`, `book`, `permission`, `position`, `tool`, `skill`. The 2026-08-08 maintainer ruling on #6483 rolled all nine back (same verdict family as `flow`, #6283).

**Behaviour change** — an org-scoped overlay write (`PUT /api/v1/meta/{type}/{name}`, `saveMetaItem`, or `SysMetadataRepository.put` with `override-artifact` intent) against a **packaged/artifact-backed** item of these types now fails loudly with **`403 NOT_OVERRIDABLE`** instead of being accepted. Measured in-repo before the rollback: **zero** live org-scoped overlay rows existed for any of the nine types (no seeds, no dogfood data, no fixtures), so no stored data is invalidated.

Unchanged, deliberately:

- `allowRuntimeCreate` stays `true` on all nine — authoring a **brand-new** item of these types through the runtime API (the ADR-0005 two-tier model) keeps working, including ADR-0045's publish visibility flip for materialized apps and ADR-0094's write-through for runtime-created permission sets.
- `view` / `dashboard` / `report` (the ADR-0005 ✅ row) and `translation` / `email_template` are untouched.
- `OS_METADATA_WRITABLE` remains the documented operator escape hatch for re-opening a type at runtime.

Known consumer impact: a Setup/data-door edit of a **code-declared** permission set (ADR-0094's 2026-07-14 "customize packaged sets via env overlay" direction) now answers 403 — ADR-0086 two-doors applies (edit the package, re-publish). Readmitting any of the nine requires an ADR-0005 revision ratifying the admission pair (overlay schema + written render-only rationale), not a registry edit; the registry rows and `scripts/adr-anchors.json` now carry that governance anchor.
