---
'@objectstack/skills': patch
'@objectstack/mcp': patch
---

docs(skills): the `objectstack-ask` skill reads `withheldFields`, asks `aggregate_records` for a top or bottom N, and answers "how many" from `totalGroups`

Clause-②: no
Metadata-protocol: none

The `objectstack-ask` skill, and the page at `GET /mcp/skill` that is generated from it, now tell a connected client three things. In step 4: a `query_records` or `get_record` answer whose `withheldFields` names a field means the field exists but is hidden from the caller, so the client says it is not visible, never that it is empty; and a top or bottom N is asked of `aggregate_records` with `orderBy` (an aggregation alias or a group key) and `limit: N`, so the database ranks and cuts the groups. In step 6, one bullet covers `truncated: true` for every answer: more rows or groups existed than came back, so the client says the result is partial and answers "how many" from `totalGroups` (on `query_dataset` and `aggregate_records` alike); without `totalGroups` it says the total is unknown, because `rowCount` counts only what came back.

The two per-tool `truncated` sentences that bullet replaces are removed from steps 3 and 4. `packages/mcp/src/ask-skill.generated.ts` is regenerated from the skill; no code path changes.
