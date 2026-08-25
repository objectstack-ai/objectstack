---
'@objectstack/mcp': patch
---

`CONNECT_AGENT_PAGE` is declared `: Page` (type-level only; no runtime change) so export-shape page discovery can see it. It reaches the kernel through `CONNECT_AGENT_UI_BUNDLE.pages`, but was authored as a bare `export const CONNECT_AGENT_PAGE = { … }` with per-field `as const` — the same shape `MarketplaceInstalledPage` shipped in before #11574, and invisible to the export-shape scan the canonical-envelope gates (#11255, #11480) discover their population with. A new repo-wide gate, `check:page-declaration-shape`, now closes the class: every identifier in a bundle's `pages:` array must be declared `export const X: Page =` or through `definePage()` (#11576).
