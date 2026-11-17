---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ask`, a skill for a client that answers business questions over MCP

Clause-②: no
Metadata-protocol: none

A person who connects Claude Code (or another MCP client) to an ObjectStack app and asks it for a number now has a skill that tells the client how to answer. Until now that procedure was written only in the `list_datasets` tool description and on the page at `GET /mcp/skill`, and a client does not reliably read either before it picks a tool.

The new skill `objectstack-ask` is for the connected client, not for a developer writing queries in code. It gives the steps in order:

- Lift the business words of the question and call `list_datasets` with them as `terms`, in the user's own words and language.
- Decide by `matches`. A word matches only when it equals a member's name, label or synonym (case, spacing, `_` and `-` aside), never by similarity. One measure match is computed with `query_dataset`, and the source is cited from the answer's `provenance`. Several matches are a question for the user. A dimension match alone is not an answer.
- When nothing matches but the word is a loose form of several listed measures (a bare "revenue" beside Won Revenue, Annual Revenue and Planned Revenue), ask which one is meant and compute nothing yet.
- Otherwise fall back to `aggregate_records` / `query_records`, and open the answer with a line saying it is not from a governed metric (非指标口径).
- `membersWithheld: true` is reported as measures the user may not read, never as a metric that does not exist.
- When no metric, object or field records what the question needs, say what is missing. Never answer from an assumed value.

`objectstack-ai` and `objectstack-query`'s aggregation rules each gain one line pointing to it. Install or update the catalog as before (`@objectstack/skills`, then the sync); nothing else changes.
