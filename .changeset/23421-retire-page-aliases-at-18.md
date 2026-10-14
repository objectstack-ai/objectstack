---
'@objectstack/spec': minor
---

feat(spec)!: two page-property conversions leave the load path at 18 — a `page:header`'s `description` and an inline `api` action's object-form `params` are refused with their rename at every door that judges page props

Clause-②: yes (narrowing)

**BREAKING (authoring):** the ADR-0087 D2 conversions `page-header-subtitle-alias` and `inline-action-api-params-to-body-extra` were declared for protocol 17's one-major window and are now retired from the load path. The authoring funnel (`defineStack`, `os validate`, `os build`, `os lint`) no longer rewrites either spelling, so an author who still writes one meets the page-props refusal, which names the rename. That refusal is the same answer the metadata save door gives, so `os validate` no longer passes a page that the save door then refuses.

Migration:

- `page:header` (and the legacy `page-header` node) `properties.description` → `properties.subtitle`. Rename the key; the value is unchanged. If both keys are present with different text, keep the one you mean under `subtitle` and delete `description`.
- An inline `type: 'api'` action's object-form `params` (a request payload map such as `params: { name: '{{page.inquiryName}}' }`) → `bodyExtra`. Rename the key; the value is unchanged. `params` stays the `ActionParam[]` definition array (the fields a dialog collects).

Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

Stored metadata needs no edit. Stored-row rehydration still replays the whole conversion chain, these two entries included, so `sys_metadata` page rows written under either old spelling keep loading in canonical form. A built artifact whose declared protocol floor is at or below `17.7.0` is also still converted at the artifact-ingestion door.

<!-- adr-0087: not-required (already-registered page-header-subtitle-alias, inline-action-api-params-to-body-extra) Both D2 conversions are registered in the step-17 chain before this change, and they are the whole mechanical migration: this diff only marks them retiredFromLoadPath with retiredAfter 17.7.0, so the authoring funnel stops replaying them while os migrate meta, stored-row rehydration and the artifact door keep replaying them. No key, value or shape is added or removed, so there is no new D2 conversion and no D3 semantic judgment to register: both rewrites are lossless renames. -->
