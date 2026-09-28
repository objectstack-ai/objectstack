---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol): `GET /meta/:type/:name/diff` with no `from` compares against the nearest earlier version whose body differs, so the default diff right after a publish shows what the publish changed (#20451)

Clause-②: no — no key, export, route, parameter or response field moves; only which version the default `from` side names.

Every draft save appends a `sys_metadata_history` row, and publishing the draft appends the same body again as the next row. The default `from` side was the history row immediately before the `to` side, so right after a publish it was the draft save the publish came from, and the default diff answered "no changes". The change the publish carried was reachable only by naming `?from=`.

- **Now:** with no `from`, `diffMetaItem` walks back from the `to` side over the history rows it already reads and takes the nearest earlier row whose body differs, by the diff's own equality (all three buckets empty means equal). A body-less row, a delete's, compares as an empty body, so the walk stops on it and the answer names the deletion. With no earlier row that differs, the `from` side is absent: `fromVersion: null`, everything added.
- **Measured on the real REST stack**, before → after:

| history | default range before | default range now |
|:--|:--|:--|
| v1 active, v2 draft save, v3 publish | `2 → 3`, no changes | `1 → 3`, the change the publish carried |
| the same with a v4 draft pending | `2 → 3`, no changes | `1 → 3` |
| create, delete, draft save, publish | `3 → 4`, no changes | `2 → 4`, everything added |
| create, delete, active recreate | `2 → 3`, everything added | unchanged |
| a new item draft-saved, then published | `1 → 2`, no changes | `null → 2`, everything added |
| a single version | `null → 1`, everything added | unchanged |

- **Unchanged:** an explicit `?from=` / `?to=` names exactly its versions (`?from=2&to=3` over the first row still answers "no changes"); the default `to` side is the active version; the response shape; the one history read, with no cap. The walk compares the stored bodies before redaction, as the diff itself does, so a credential-only change still stops it and its values are still not served.
- `@objectstack/rest`: the route's OpenAPI summary states the new default.
