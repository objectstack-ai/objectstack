---
"@objectstack/lint": patch
---

fix(lint): `_views` keys for named `listViews`/`formViews` entries are the runtime's, single spelling (#6422)

`validateTranslationReferences` accepted two spellings for a named view entry —
the map key and the entry's inner `name` — while the composer
(`expandViewContainerWithDiagnostics`) constructs the runtime identity from the
map key alone and ignores `name` entirely. Per the #5164 ruling (canonical =
the runtime identity's bare key), the named branches now read their keys from
the composer, exactly as the default `list` already does: an inner `name`
diverging from its map key stops being a legal bundle key (the runtime never
resolves it), and a collision-renamed entry (`formViews.default` beside a
default `list` → `default_2`) becomes legal under the renamed key — the one
spelling that actually resolves — instead of being reported as an orphan.

Measured over all 12 ratchet-covered configs in this repo: `os lint` verdicts
are byte-identical before/after (`added: 0 / removed: 0`).
