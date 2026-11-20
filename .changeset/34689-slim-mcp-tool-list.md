---
'@objectstack/mcp': patch
'@object-ui/console': patch
---

fix(mcp): the open MCP door's `tools/list` is a quarter smaller; teaching prose moves to the served SKILL.md

Clause-②: no
Metadata-protocol: none

Every MCP connection pays for `tools/list` before any work starts. Its total for an API key on a self-hosted app (17 tools) drops from 47,712 to 36,226 bytes; the descriptions `@objectstack/mcp` owns drop from 18,213 to 8,500. No tool is removed or renamed, and nothing a tool accepts changes: only description strings.

Each description keeps what a call needs: the arguments, the confirmation a destructive call takes, the refusal it may answer and what to do about it. Worked examples, answer-reading guidance and edge cases move to the SKILL.md the server serves at `/api/v1/mcp/skill` (and the Console's "Download skill" copy of it): `describe_object`'s field facts, `query_records`' `latestPer` / `expand` examples and the approvals-waiting-on-you filter, `aggregate_records` under the `query_records` entry, `get_record`'s `related`, `run_action`'s `FLOW_FAILED` relay, and `create_upload_link`'s read-only and locked-record cases. `validate_expression`'s description now names the facts to pass per site and points at the skill for the full list of checks.

The skill's `validate_expression` entry now names its `variables` input, and says that at a `flow_condition` the shadowed-read warning, and the binding of a bare name to the variable rather than the field, need it.
