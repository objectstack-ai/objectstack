---
'@objectstack/mcp': patch
'@objectstack/spec': patch
---

feat(mcp): `delete_records` deletes many records of one object in one confirmed call, by a filter or an id list (#30891)

Clause-②: yes (widening) — the MCP surface (HTTP `/api/v1/mcp` and the stdio server) registers one more tool, `delete_records`, offered to an OAuth token that carries both `data:read` and `data:write`; no existing tool, input or answer changes.
Metadata-protocol: none

An agent that had to clear a set of records called `delete_record` once per row, and confirmed each one. `delete_records` takes the selection as `where` (a filter, `{}` for every record) or `recordIds` (an id list), never both.

- **The preview is the refusal.** A call without `confirm: true` deletes nothing. It answers `delete_record`'s refusal (`428` `ACTION_CONFIRMATION_REQUIRED`, the same `details` keys, `details.actionName` naming `delete_records`) with a `preview` member beside `error`: how many records the selection matches for this caller (`matched`), how many a confirmed call attempts (`wouldAttempt`), up to ten sample ids and, for an id list, the ids that name no readable record (`notFound`). The agent shows that to its human and retries with `confirm: true` once they approve.
- **A confirmed call deletes each record as `delete_record` does**, through the same bridge member, under the caller's permissions, row-level security and the object's delete rules (`beforeDelete` hooks, restricted relations). No caller bypasses a package's locking rule, an administrator included. Records a rule refuses stay, and the answer groups them by code, status and reason, with their ids: `{ matched, attempted, deleted, refused, refusals: [{ code, status, reason, count, recordIds }], remaining, cap }`. A refusal's `details` stays off the wire, as on every other tool.
- **A fault is not a refusal.** A rule's refusal and a fault are told apart the way the REST `/data` door tells them apart (its own classifier): a 4xx verdict (a coded rule refusal, a sandboxed hook body's `400 HOOK_ABORTED`) is grouped and the call goes on; a 5xx verdict (a code hook's bare `throw new Error`, a lost connection, a driver error, a driver's own string code) stops the call at that record. The tool error names the fault and the record, and carries the call's `progress` (`deleted`, `stoppedAt`, `notAttempted`): the records deleted before it stay deleted.
- **At most 200 records per call**, the bound REST `POST /data/:object/deleteMany` applies by default (`batch.maxBatchSize`). A filter is read in id order at the cap, and the count says whether more match; when more than 200 match, the answer says how many remain and the next call with the same selection continues. When the deployment has no aggregate support, the answer says `matchedMoreThan: 200` instead of guessing a count. On a deployment whose read page size or row budget (`OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`) is under 200, one call runs at that size, since the data door refuses a larger read, and the answer's `cap` names it; a longer id list is refused before anything is read.
- **Scopes.** Over OAuth the tool needs both `data:read` and `data:write`: its preview reads the selection's ids and count, a read a `data:write`-only token is not granted.

What a preview cannot say: which records a delete rule will refuse. The engine has no delete dry run, so the rules are judged when the confirmed call runs, and the preview says so.

`@objectstack/spec` changes only doc comments: `AIActionConfirmation` names `delete_records` as the third door of the confirmation member, and the error-code ledger's `ACTION_CONFIRMATION_REQUIRED` rows name both delete tools.
