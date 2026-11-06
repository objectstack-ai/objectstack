---
'@objectstack/mcp': patch
'@objectstack/spec': patch
---

feat(mcp): `delete_records` deletes many records of one object in one confirmed call, by a filter or an id list (#30891)

Clause-②: yes (widening) — the MCP surface (HTTP `/api/v1/mcp` and the stdio server) registers one more `data:write` tool, `delete_records`; no existing tool, input or answer changes.
Metadata-protocol: none

An agent that had to clear a set of records called `delete_record` once per row, and confirmed each one. `delete_records` takes the selection as `where` (a filter, `{}` for every record) or `recordIds` (an id list), never both.

- **The preview is the refusal.** A call without `confirm: true` deletes nothing. It answers `delete_record`'s refusal (`428` `ACTION_CONFIRMATION_REQUIRED`, the same `details` keys, `details.actionName` naming `delete_records`) with a `preview` member beside `error`: how many records the selection matches for this caller (`matched`), how many a confirmed call attempts (`wouldAttempt`), up to ten sample ids and, for an id list, the ids that name no readable record (`notFound`). The agent shows that to its human and retries with `confirm: true` once they approve.
- **A confirmed call deletes each record as `delete_record` does**, through the same bridge member, under the caller's permissions, row-level security and the object's delete rules (`beforeDelete` hooks, restricted relations). No caller bypasses a package's locking rule, an administrator included. Records a rule refuses stay, and the answer groups them by code, status and reason, with their ids: `{ matched, attempted, deleted, refused, refusals: [{ code, status, reason, count, recordIds }], remaining, cap }`. A refusal's `details` stays off the wire, as on every other tool.
- **At most 200 records per call**, the bound REST `POST /data/:object/deleteMany` applies by default (`batch.maxBatchSize`). A filter is worked in id order; when more than 200 match, the answer says how many remain and the next call with the same selection continues. When the deployment has no aggregate support, the answer says `matchedMoreThan: 200` instead of guessing a count.

What a preview cannot say: which records a delete rule will refuse. The engine has no delete dry run, so the rules are judged when the confirmed call runs, and the preview says so.

`@objectstack/spec` changes only a doc comment: `AIActionConfirmation` names `delete_records` as the third door of the confirmation member.
