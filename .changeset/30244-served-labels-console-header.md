---
'@object-ui/app-shell': patch
---

fix(app-shell): the Console header, the app report index and the recent list draw a served report, page or dashboard label as served

Clause-②: no
Metadata-protocol: none

- **Now.** A report's crumb and a page's phone title in the header, a report's row in the app's report index, and a report, page or dashboard row in the recent-items list (and an unlabelled sidebar entry that opens a dashboard) draw the label the `/meta` read or the app bundle served as given. The server has already translated it, by its label order for an overridden item: a `.custom` override's or a published edit's own text is kept over the base package's translation. Before, the served label reached the client's catalog lookup only as its fallback, so the base package's translation of the old name won.
- **Unchanged.** An item the read did not serve, or served with no label, is still named by the catalog key under its name (`{ns}.reports.<name>.label`, `pages`, `dashboards`), then by its humanized name or machine name as before. An unedited item shows the same text as before, because the server serves the catalog's translation for it. A language switch reads the metadata again, so a served label is never left in the old language.
