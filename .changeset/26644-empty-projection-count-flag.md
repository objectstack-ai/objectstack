---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the Data API refuses an empty projection and a count flag that is neither true nor false, instead of reading them as absent (#26644)

Clause-②: no (narrowing) — `GET /data/:object`, `POST /data/:object/query` (both transports: `RestServer` and the runtime dispatcher) and `GET /data/:object/:id` refuse a projection that names no field, and the list doors refuse a `count` / `$count` other than true or false, where they answered 200 before. Nothing is widened and no export changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: two query-parameter values the list normalizer read as the absent default are now refused 400 VALIDATION_ERROR naming the parameter. A caller drops the parameter or sends a well-formed value; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the shared list normalizer (`findData`) and the by-id read (`getData`), served by every Data API door that uses them.

- **Before.** A blank or comma-only `$select` / `select` / `fields` (`?$select=`, `?$select=,`), and an empty array in a JSON body (`"fields": []`), became an empty projection, which every driver serves as no projection: all columns, under a 200. A `$count` / `count` other than `true` or `false` (`?$count=maybe`, `?$count=1`, a blank `?count=`) was left unlowered, so the `count=false` opt-out never matched and the count ran: a `total` was reported as if `$count=true` had been sent.
- **Now.** Both are refused `400 VALIDATION_ERROR` before any read, with a message naming the parameter the caller wrote and the value (`Query parameter '$select' names no field; got ""`, `Query parameter '$count' must be true or false; got "maybe"`), as a blank `$top` already is. The accepted count values are the spec's `QueryTransportParamsSchema.count`: the boolean, or the strings `true` and `false`. `GET /data/:object/:id?select=` answers with the same code; that route's catch already reports every projection refusal (an unknown field included) as `404`, and the empty projection joins that answer.
- **Unchanged.** An absent parameter keeps its default: every column, and the count runs. A named projection (`$select=a,b`, trailing commas and spaces trimmed as before), `$count=true`, `$count=false` and a JSON `null` answer exactly as before. `POST /data/:object/query` already refused a non-boolean `count` at its body schema (`400 VALIDATION_FAILED`), and still does.
- **Who sees it.** A caller that builds `$select` from a list that can be empty, or sends a mistyped `$count`. It now learns that from a 400 instead of an answer that looked normal.

**The remedy.** Leave the parameter out to read every column or to keep the count, or send a projection naming at least one field and a count flag of `true` or `false`.
