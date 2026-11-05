---
'@object-ui/app-shell': patch
---

fix(app-shell): the Console sidebar, recent list and object list header draw a served object or list view label as served

Clause-②: no
Metadata-protocol: none

- **Now.** An unlabelled sidebar entry that opens an object or a list view, a recent object or list view row (in the sidebar and on Home), the object list page's title, the app header's title on an object route and an object's `/data` page title draw the label the `/meta` read or the app bundle served as given. The server has already translated it, by its label order for an overridden item: a `.custom` object extension's or view override's own text is kept over the base package's translation. Before, the served label reached the client's catalog lookup only as its fallback, so the base package's translation of the old name won. A list is titled by the served `pluralLabel`, else the served `label`.
- **Unchanged.** A list view the client derived (no served read names it), an object the cache does not hold yet, and a pending draft's label are still named by the catalog key, then by the machine name as before. An unedited item shows the same text as before, because the server serves the catalog's translation for it. Record pages, record forms and drawers still look the object's name up in the catalog; they are a follow-up.
