---
"@objectstack/plugin-approvals": patch
---

Clause-②: no
Metadata-protocol: none

The note an `admin_rescue` approval request writes on its own timeline ("Routed to this organization's administrators because the approver slate named no one: …") is now read in the reader's language. The request's node-config snapshot stores the note as a code and its parameters (`__adminRescueNote`: the timeline row it explains, the abandoned approver slots, and why a declared `fallback` did not help), and `listActions` (`GET /api/v1/approvals/requests/:id/actions`) renders that row's `comment` through the plugin's `messages` catalog at the caller's locale, the way the approvals door already localizes a request's flow, step and object labels. The sentence and its clauses ship in `en`, `zh-CN`, `ja-JP` and `es-ES`.

The stored `comment` is unchanged: it is still the English sentence, which a reader with no locale, an `en` reader, the generic data door and the action-history list views are served as before. Requests opened before this release carry no snapshot entry, so their note keeps showing its stored English; no migration is needed.
