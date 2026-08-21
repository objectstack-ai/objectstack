---
"@objectstack/lint": minor
"@objectstack/spec": patch
---

Runtime publish-gate findings for collection-resident write types (`object` /
`permission` / `book`) now key the top-level collection entry in
`issues[].path` / `advisories[].path` by NAME —
`objects.acme_invoice.sharingModel` — instead of by the gate's private
per-write snapshot index (`objects[417].sharingModel`), which no caller could
resolve: that index numbered an in-memory array a Studio / MCP / REST receiver
has never seen. Single-member write types keep their trivially-stable
positional form (`flows[0].nodes[1]…`), and nested positions inside one named
item (`objects.acme_invoice.indexes[1]`) stay positional — they index the
author's own document. An entry with no splice-safe name falls back to the
positional spelling. The accepted metadata set is unchanged; only the spelling
of the emitted finding `path` changes, and `RuntimeAuthoringIssueSchema.path`'s
description now states the convention. CLI (`os validate` / `os lint`) output
is unchanged — there the index resolves against the author's own config file.
