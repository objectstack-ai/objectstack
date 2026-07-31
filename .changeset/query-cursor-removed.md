---
"@objectstack/spec": major
"@objectstack/client": major
---

refactor(data)!: `query.cursor` is removed — no driver ever implemented keyset pagination (#4286 step 4)

`cursor` promised keyset pagination and nothing served it: the key was accepted
and ignored, so every page came back identical — a caller looping "until
`hasMore` is false" never terminated. It was Tier A of the #4286 inventory: a
shipped public producer (`QueryBuilder.cursor()`) minting a key no executor
read.

**FROM → TO**

| Was | Now |
| :--- | :--- |
| `cursor: { created_at: last.created_at }` | `where: { created_at: { $gt: last.created_at } }` + the matching `orderBy` |
| `QueryBuilder.cursor({...})` | `.where({ created_at: { $gt: ... } }).orderBy('created_at')` |

The one-line fix: **delete the key and seek with `where` on your sort key** —
every driver already executes that, with canonicalised temporal comparands.

Mechanics: `retiredKey()` tombstones on both declaration sites
(`QuerySchema.cursor` and `EngineQueryOptionsSchema.cursor`, one shared
prescription), so authoring the key fails `tsc` and a query still carrying it
fails to parse with the fix. `QueryBuilder.cursor()` is deleted. Registered as
the protocol-18 semantic migration `query-cursor-retired` (request surface —
nothing stored to rewrite). The caller-built `Record<string, unknown>` shape
would not survive a real keyset design anyway: a first-class cursor, if ever
built, will be a response-minted opaque token (the pattern the
metadata-revision / flow-run / notification list endpoints already use — those
`cursor` params are unrelated and unchanged).
