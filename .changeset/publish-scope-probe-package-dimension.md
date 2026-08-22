---
'@objectstack/metadata-protocol': minor
---

**BREAKING** (behavioral narrowing, maintainer-adjudicated): a per-item publish that states a package (`POST /api/v1/meta/:type/:name/publish?package=PKG_ID`) now resolves its draft's org scope package-exactly. Both probes in `resolveDraftOrgScopeForPublish` carry the stated `package_id`, so the scope probe asks the same question the promote does.

What this fixes: with two packages holding drafts for one `(type, name)` in different org scopes (the ADR-0048 coexistence), the package-agnostic scope probe could match another package's row in the caller's org, name that scope, and the package-exact promote then answered `404 [no_draft]` over a publishable draft sitting env-wide — the exact row the caller named.

What you may newly see: a publish that states `?package=` no longer discovers a draft of the same `(type, name)` authored with no package binding — it answers `404 [no_draft]`. That narrowing is the ruling, not a side effect: a mistyped package must fail loudly rather than silently publish some other package's draft. Remedy: if the draft you mean is the package-less one, retry the publish without the `?package=` query parameter; an unstated package keeps the historical match-any resolution.

<!-- adr-0087: not-required (no-migration-prescription) Request-time resolution semantics of one HTTP query parameter; no authored metadata key, spec surface, or export changes shape, so `objectstack migrate meta` has nothing to rewrite. -->
