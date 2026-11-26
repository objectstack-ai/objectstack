---
'@objectstack/service-record-context': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/spec': patch
'@objectstack/types': patch
---

fix(service-record-context): get_record_context leaves out a related child the caller is not served, and both MCP doors hand over the caller's queryable fields and their page cap

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0160 D3 "Object level", as amended, and its second amendment. No pack, key or code changes. The published surface widens by optional members only: `RecordContextDoor.pageCap?()`, and `StdioDataBridgeDeps.security` may carry `getQueryableFields`; `@objectstack/types` adds `resolveQueryReadPageCap`.

- **A related child this caller is not served is left out, not refused.** The answer carries the root and every served section, with the one `not_visible` note, and names the child nowhere; nothing of the child is read after its object-level judgement, its published definition included. A child is still refused whole, as before, when a gate refuses it for everyone: the read guard, or API exposure — which is now asked before the served definition, so a child whose package is disabled (`OBJECT_PACKAGE_DISABLED`, which also serves its object to nobody) keeps its `PERMISSION_DENIED` refusal. A served-definition read that fails refuses the call, unnamed, and is never read as a narrowing.
- **Both doors supply `queryableFieldsOf`.** The `/mcp` door and the stdio door now hand the executor the security service's `getQueryableFields` answer for the caller they resolved, so a related list's `where` or `orderBy` is judged on that answer before the read. A field outside it drops the section with the note, and is never refused by the engine's guard; a masked field this caller is served whole (its unmask capability held) is now filtered and sorted on, where the fallback dropped the section.
- **A door's page cap is a stated cut.** A door may report its page cap (`pageCap`, optional); the executor then asks a related list for at most that many rows, cuts the list one row under it, and states the cut. Both doors report the deployment's smaller read limit (`OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`). Before, under a maximum page size below a list's cut plus its probe row, the `/mcp` door refused the whole call `MAX_RECORDS_EXCEEDED` and the stdio door read the full list.
- The `related_truncated` note kind's doc line, and the `rows` and `truncated` descriptions of a related list in the tool's output schema, now say a list is cut at its entry's `limit`, at the row cap, or below either at the door's page cap.
- `@objectstack/types` exports `resolveQueryReadPageCap()`: the smaller of `OS_DATA_MAX_PAGE_SIZE` and `OS_DATA_QUERY_ROW_BUDGET`, `undefined` when neither is set. Both doors answer `pageCap` from this one function, so they cut at the same row.
