---
'@objectstack/service-ai': patch
---

fix(ai): AI-authored views now bind to their object and render (kanban as a board, not a list)

An AI-built app's views (including kanban) appeared only as the default list and never as selectable tabs. Diagnosis (vs the working showcase kanban) showed it was a **metadata-shape** bug in the blueprint's `viewBody`, not the renderer or skill: it emitted a bare `{ list: {…} }` fragment instead of the canonical view record. Three things were missing/wrong:

- no top-level **`name`** → `getMetaItems` only surfaces overlay rows whose body has `name`, so every AI view was silently dropped from the object's view list;
- no top-level **`object`** / **`viewKind`** → the console couldn't bind the view to its object;
- the view name wasn't **`<object>.<key>`**-prefixed (the convention the console keys view tabs off).

`viewBody` now emits `{ name: '<object>.<key>', object, viewKind: 'list'|'form', config: <ListView|FormView> }`, matching the shape the showcase's own views use (verified against the real `ViewSchema`). End-to-end verified: an AI-built kanban app surfaces 看板 + 列表 as tabs and renders the kanban as a board grouped by status.
