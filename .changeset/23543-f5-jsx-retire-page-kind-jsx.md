---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
'@objectstack/lint': patch
---

feat(spec)!: the page kind `jsx` is retired — an authored `kind: 'jsx'` is refused with the prescription naming `html`, and `page-kind-jsx-to-html` leaves the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** `jsx` was the first name of the constrained-JSX page tier (ADR-0080), which ADR-0081 renamed `html`. Through 17 it stayed a declared `PageSchema.kind` member and the loader rewrote an authored `kind: 'jsx'` to `html` with a notice. At 18 it is retired: `PageSchema.kind` declares it through `enumWithRetiredValues`, so every door that parses a page (`defineStack`, `os validate`, `os build`, `os lint`, the metadata save door) refuses it by name: "Page `kind: 'jsx'` was removed in @objectstack/spec 18 (ADR-0087 D2) … Use `kind: 'html'`." Writing it in TypeScript no longer compiles either. The ADR-0087 D2 conversion `page-kind-jsx-to-html` is retired from the load path (`retiredAfter: '17.7.0'`), so the authoring funnel no longer rewrites the value. `COMPILED_PAGE_KINDS` is now `['html']`: `requires` is accepted on an `html` page only.

Migration:

- `kind: 'jsx'` → `kind: 'html'`. Change the value; the page's `source` is compiled and rendered exactly as before, and `requires` stays legal on it.
- A script or integration that saves a page through the metadata API with `kind: 'jsx'` → send `kind: 'html'`.

`os migrate meta` does not list this edit: the rename belongs to protocol 11, below the migration floor, so make it by hand. The D3 entry `page-kind-jsx-retired` states it for upgraders.

Stored metadata needs no edit. Every stored-row rehydration seam replays the retired conversion, so a `sys_metadata` page row written as `jsx` keeps loading as an `html` page, and a built artifact whose declared protocol floor is at or below `17.7.0` is still converted at the artifact-ingestion door.

The readers that branched on the retired value dropped it: the metadata save door's html-page compile gate (`@objectstack/metadata-protocol`), the CLI's SDUI-manifest page count, and the lint page walk, `validateJsxPages` and the page-source styling rule (`@objectstack/lint`) now read `html` (and `react` where they did before) only.

<!-- adr-0087: registered page-kind-jsx-retired -->
