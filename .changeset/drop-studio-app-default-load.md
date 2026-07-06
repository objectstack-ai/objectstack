---
'@objectstack/cli': patch
'@objectstack/plugin-dev': patch
---

`os dev` / `os start` / `os serve` no longer default-load the `@objectstack/studio` app package.

The console ships a dedicated Studio surface at `/_console/studio/<package-id>/<pillar>`,
so Studio no longer needs to exist as a navigable app tile in the home "Your apps" list.
The `@objectstack/studio` package is unchanged and can still be registered explicitly;
Setup and Account remain default-loaded (ADR-0048 one-app-per-package mechanism).
