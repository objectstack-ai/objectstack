---
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

**Pending metadata drafts are now served only to a caller with an authoring capability — the check `GET /api/v1/meta/_drafts` already made.** A pending draft is unpublished authoring work. Until now, every door that reads one, other than `/meta/_drafts`, served it to any signed-in caller who could open the item. The draft access that the `previewDrafts` / `state` request declarations, ADR-0106 D4 and ADR-0037 described as admin-gated upstream is now gated.

Clause-②: no

- **The doors:** `GET /api/v1/meta/:type/:name?state=draft` and `?preview=draft`, `GET /api/v1/meta/:type?preview=draft`, and `POST /api/v1/analytics/dataset/query` with `previewDrafts: true` or `?preview=draft` on `RestServer`, plus the runtime dispatcher's `/meta` item and list `?preview=draft`.
- **Who may read drafts:** a system context, or a caller holding `studio.access`, `setup.access` or `manage_metadata`. This is the same predicate `/meta/_drafts` asks, not a second rule.
- **Everyone else gets the read as if the draft switch were absent.** They receive the published version, pruned for them as the plain read prunes it. For a name that has nothing published, they receive that door's own absence answer: `404` on the item read, `404 NOT_FOUND` for a dataset by name, and the item simply missing from a list. The answer is byte-identical to the plain read, so it does not reveal whether a draft exists. For example, `?state=draft` on an app with no pending draft answers such a caller with the published app, not `404 NO_DRAFT`. A dataset preview run by such a caller uses live rows, never a pending seed draft's rows.
- **Unchanged:** callers with an authoring capability read exactly what they read before. Whoever may save an app reads its `?state=draft` whole, and everyone else pruned per caller. `/meta/_drafts` still answers `403` to a caller without the capability, because it lists drafts and has no published answer to fall back to. `/diff` and `/history` are not changed by this release.
