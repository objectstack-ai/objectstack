---
'@objectstack/lint': minor
'@objectstack/cloud-connection': patch
---

The canonical-expression-envelope detector for raw-literal `Page` exports gets a shared home in `@objectstack/lint` (#11480). New public API beside `walkPageComponents`: `auditPageExpressionEnvelopes(page, label)` runs the three parse doors (`PageSchema` / `PageComponentSchema` / `ComponentPropsMap`) over one authored page and reports bare-expression findings plus every door's precondition failures; `renderBareExpressionFindings(findings)` renders the actionable red; types `BareExpressionFinding`, `PageEnvelopeAudit`, `EnvelopeAuditDoor`. The detector previously lived package-local to `@objectstack/platform-objects`' gate, which could not reach raw-literal pages shipped by other packages. `@objectstack/cloud-connection`'s two shipped pages are now covered by the same gate, and `MarketplaceInstalledPage` is declared `: Page` (type-level only; no runtime change) so export-shape page discovery sees it.
