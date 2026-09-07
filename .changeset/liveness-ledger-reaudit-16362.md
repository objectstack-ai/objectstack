---
"@objectstack/spec": patch
---

Liveness ledger: four verdicts re-derived and corrected ahead of the author-warning flip.

The ledger's `dead` and `live-elsewhere` verdicts are about to start warning downstream authors, so each row was re-measured against a pinned tree — objectstack `5d55afec4d`, objectui `a472b071` — with a firing positive control on the same instrument and corpus before any zero was read as a reading.

- **`validation.label` / `.description` / `.tags`: `dead` → `live`.** The 2026-08-10 sweep upheld `dead` on *reachability*, not on the read: `ValidationPreview` genuinely rendered all three, but the only route that mounted it was the standalone `validation` resource door, and ADR-0088 had retired that kind — so on the governed path (a rule embedded in its object) the preview was never handed a draft. That note named its own falsifier, and it has since landed: the standalone door is gone, and `EmbeddedItemEditor` now resolves `getMetadataPreview(editAs)` and mounts the preview on the live draft, with the embedded anchor binding `editAs: 'validation'`. Under the ruling that a designer preview rendering a key to a human is a runtime consumer, these three display keys are live. They remain docs-shaped and are still not author-warned.
- **`view` `list.tabs`: `live` → `dead`.** The previous note was wrong in both directions at once. It credited objectui's `TabBar` with reading `icon`/`visible`/`pinned`/`filter` — true of the component, but **nothing mounts it**: every `TabBar` render site in the whole renderer tree is its own definition or one of its two test files, and `ListView` never reads `tabs` off the view schema, so authoring `list.tabs` draws no tab bar. And it called `tabs[].order` a dead sub-surface while `getVisibleTabs` sorts on exactly that key. The two author-time readers that do walk the key (a field-reference lint and the metadata diagnostics) check `tabs[].filter[].field` for reference integrity and deliver none of the key's declared effect — validated-then-ignored is accept/reject, which this ledger has always kept separate from liveness.

No published surface moves: these are ledger JSON rows plus the generated count table, with no export, key, or accept-set change. The `list.tabs` re-grade does mean an author who writes tabs on a list view will be told the key is inert — which it is, and was.
