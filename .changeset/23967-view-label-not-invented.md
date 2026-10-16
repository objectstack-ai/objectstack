---
'@objectstack/rest': minor
---

fix(rest)!: the `/meta` item and list reads serve a view stored with no `label` without the `label` the translator invents from its name

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the document two `/meta` reads serve for a view whose stored row carries no `label`: it no longer carries one the serving layer made up. The stored row was never touched and is not touched now. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a `/meta` read stops serving a value nobody authored), shipped as `minor` under the launch-window convention for breaking changes.

A view's `label` is optional in the spec, with no default. When the translation catalog carried no string for a view, the read-side translator answered the view's own name, so a view stored without a `label` was served one: `GET /api/v1/meta/view/NAME` and `GET /api/v1/meta/view` returned `label: "OBJECT.KEY"`, on the standalone server and on the runtime dispatcher alike. The console drew that machine name as the view tab. The view-container read already dropped this value; the item read and the list read now drop it too.

What a client reads now:

- A view stored with no `label` is served with no `label` key, in every locale, with or without a translation catalog.
- A view with an authored `label` is served that label, unchanged, including a label that happens to equal the view's name.
- A catalog translation (`objects.OBJECT._views.KEY.label`) is still served, for a view with a `label` and for one without.
- A read that resolves no locale is served the stored document as before, and the layered read (`?layers=true`) never carried the invented value.

Who reads differently: a client that displays a served view's `label` now finds the key absent for a view stored without one, where it used to find the qualified name; it shows its own wording for such a view (the object's plural label, for example). The console's view tab falls back to the view's name on its own, so it keeps showing a machine name for such a view until its own fallback changes.
