---
'@objectstack/studio': patch
---

fix(studio): clearer metadata list filter chips, empty states & no-flash theme boot

Surveyed Studio's core pages via the browser and shipped three targeted polish fixes:

- **Filter chips on multi-type list pages** (Views & Apps, Automations, …) were displaying the nav-category label for every chip — e.g. _"Views & Apps 1"_ / _"Views & Apps 2"_ instead of _"App 1"_ / _"Dashboard 2"_. Added a singular `METADATA_TYPE_LABELS` registry and a `typeLabel()` helper in `studio-nav.ts`, and switched the chip + search placeholder + empty-state copy to per-type labels.
- **Empty-state grammar**: _"No ai in this package yet."_ now reads _"Nothing in AI for this package yet."_ — works for any title casing (AI, Views & Apps, …) without lowercasing.
- **First-paint theme flash**: stored theme was only applied in a `useEffect`, causing a brief white flash before React mounted (especially noticeable on slow loads). Added an inline `<script>` in `index.html` that mirrors `theme-toggle.tsx` and applies the `.dark` class and the matching `<html>` background-color synchronously, plus a `<meta name="color-scheme" content="dark light">` so native UI (scrollbars, form controls) inherits the correct scheme too.
