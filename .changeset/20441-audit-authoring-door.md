---
"@objectstack/rest": patch
---

**`GET /api/v1/meta/:type/:name/audit` is now an authoring door: a caller without an authoring capability is refused, as `/diff`, `/history` and `GET /api/v1/meta/_drafts` refuse.** Before this release, any signed-in caller who could open an item could read its protection-audit trail. Every save appends a row to that trail, a draft save included, and the row carries `note: "draft"`, the actor and the time. So a member could learn that an item had unpublished authoring work, who saved it and when. For an item that had never been published, where the plain read answers `404`, the member could learn that it existed at all. This carries the maintainer's ruling on #20378 (letter B, comment 5865708652) to this door, as triage graded on #20441: draft and preview reads are admin-gated upstream (ADR-0106 D4), and the audit trail, like the version log, has no published-only answer to fall back to.

Clause-②: no

- **Who may read it:** a system context, or a caller holding `studio.access`, `setup.access` or `manage_metadata`. This is the predicate `/meta/_drafts`, `/diff`, `/history` and every draft switch already ask, not a second rule.
- **Everyone else:** `403` with code `FORBIDDEN`, in the same nested `error` envelope `/meta/_drafts` answers. The refusal is decided on the caller before the protocol is resolved, before the query is parsed and before any event is read. So it is the same answer for an item that exists, one that does not, and one that exists only as a draft, and it carries no event, actor or item name. The message names the door, not drafts.
- **Unchanged:** callers with an authoring capability read the trail exactly as before, including the per-caller refusal of an item the plain read refuses them and the organization scope of the read.

A client that read `/audit` (`client.meta.getAudit`) as a member now receives `403 FORBIDDEN`. To read it, call as a caller holding one of the three capabilities above.
