---
'@objectstack/spec': minor
---

feat(spec)!: `deriveRecordFlowSurface` derives a bounded modal (`size: 'auto'`) for a field-heavy create / edit / child task flow on desktop; a mobile posture keeps the full-screen modal (`size: 'full'`)

A task flow (`create`, `edit`, `child-create`, `child-edit`) whose base surface is `'page'` (at or above `RECORD_SURFACE_PAGE_THRESHOLD` authorable fields) still opens as an overlay modal, but on desktop its size is now `'auto'`, so the renderer's own `lg` / `xl` bound applies instead of stretching the form to the window edge. With `viewport: 'mobile'` the derivation answers `size: 'full'` exactly as before. A heavy form with an embedded child or line-items table is not split out: it takes the same bounded modal on desktop. The `view` flow and every light-object flow are unchanged.

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is added, removed, renamed or re-shaped, and no export is added, removed or narrowed (`RecordFlowSurface.size` was already `'auto' | 'full'`). What changes is the value a published pure function derives for one input class, a desktop field-heavy task flow, so there is nothing for `objectstack migrate meta` to rewrite. The remedy for a host that wants the old size is an explicit `navigation.size` / `FormView.modalSize`, never a rewrite of a package source or a stored row. -->

**BREAKING** (a published derivation's default changes), shipped as `minor` under the launch-window convention for breaking changes.

What changes for you: a consumer that relied on `deriveRecordFlowSurface(def, flow)` answering `size: 'full'` for a field-heavy task flow on desktop now gets `size: 'auto'`.

| call | FROM | TO |
|:--|:--|:--|
| `deriveRecordFlowSurface(heavyDef, 'create')` (also `'edit'`, `'child-create'`, `'child-edit'`; or `{ viewport: 'desktop' }`) | `{ container: 'overlay', surface: 'modal', size: 'full' }` | `{ container: 'overlay', surface: 'modal', size: 'auto' }` |
| the same call with `{ viewport: 'mobile' }` | `{ container: 'overlay', surface: 'modal', size: 'full' }` | unchanged |

The one-line fix, for an object that genuinely needs the full-screen form on desktop: set `navigation.size: 'full'` on its list view (or `FormView.modalSize: 'full'`), which wins over the derived default.
