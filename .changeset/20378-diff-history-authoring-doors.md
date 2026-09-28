---
"@objectstack/rest": patch
---

**`GET /api/v1/meta/:type/:name/diff` and `GET /api/v1/meta/:type/:name/history` are now authoring doors: a caller without an authoring capability is refused, as `GET /api/v1/meta/_drafts` refuses.** Before this release, any signed-in caller who could open an item could read its version diff and its change history. Both doors read the metadata version log, which records a draft save exactly as it records a published save. So a member could read an item's unpublished draft through `/diff`, either by naming the draft save's version in `from`/`to` or through the default range once a draft was pending. Through `/history`, the same member could read the draft-save events. This follows the maintainer's ruling on #20378 (letter B, comment 5865708652), which pulls both doors back into the declared contract: draft and preview reads are admin-gated upstream (ADR-0106 D4). It narrows the earlier ruling that let every caller who may open an app read `/diff` pruned, for these two doors only.

Clause-②: no

- **Who may read them:** a system context, or a caller holding `studio.access`, `setup.access` or `manage_metadata`. This is the predicate `/meta/_drafts` and every draft switch already ask, not a second rule.
- **Everyone else:** `403` with code `FORBIDDEN`, in the same nested `error` envelope `/meta/_drafts` answers. The refusal is decided on the caller before the query is parsed and before any item or version is read. So it is the same answer for an item that exists, one that does not, and one that exists only as a draft, and it carries no item name, version or event. The message names the door, not drafts.
- **Unchanged:** callers with an authoring capability read both doors exactly as before, per-caller pruning included: on `/diff`, whoever may save an app reads both sides whole, and any other admitted caller reads them pruned. `/layers` and the deprecated `?layers=true` read the active row, so they keep answering every caller who may open the app with the pruned plain-read answer. `/audit` is unchanged.

A client that read `/diff` or `/history` as a member now receives `403 FORBIDDEN`. To read them, call as a caller holding one of the three capabilities above.
