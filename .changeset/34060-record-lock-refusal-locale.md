---
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
---

fix(plugin-approvals): the record-lock refusal is worded in the writer's locale

Clause-②: no
Metadata-protocol: none

A user who saved a record held by an approval in progress was refused `409 RECORD_LOCKED` with an English sentence in every locale, while the other refusals on the same request answered in the request locale. A zh-CN writer read `Project '华东仓储客服平台实施' is locked while an approval is in progress, and cannot be edited until that approval is complete`.

The sentence is now rendered through the shared Operation Message Catalog (`@objectstack/spec/system`, `renderOperationMessage`), the catalog the record door's other refusals use. Four new keys cover what the lock hook has in hand: `record_locked` (object label and record title), `record_locked_untitled` (label only), `record_locked_unlabeled` (title only) and `record_locked_opaque` (neither). They ship in `en`, `zh-CN`, `ja-JP` and `es-ES`. The object is named by its label in the writer's locale (`objects.<object>.label` from the deployment's language pack, else the declared label), never by its API name. The same zh-CN writer now reads `项目「华东仓储客服平台实施」正在审批中，已被锁定，审批完成前无法编辑`. Batch rows (`updateMany`, `batch` upsert) carry the same sentence.

Unchanged: the English sentence is byte-identical, a locale the catalog does not carry reads English, and the wire code `RECORD_LOCKED`, the 409 status and the `RECORD_LOCKED: ` message prefix do not move. A deployment can override each sentence under `errors.record_locked`, `errors.record_locked_untitled`, `errors.record_locked_unlabeled` and `errors.record_locked_opaque`.
