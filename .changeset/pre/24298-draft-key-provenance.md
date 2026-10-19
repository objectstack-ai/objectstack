---
"@objectstack/spec": minor
---

feat(spec): the draft read declares `draftChanges`, a pending draft's per-key provenance: which authoring surface last changed each key path of the draft, under which actor, and when

Clause-②: yes (widening)

- **The key.** `GetMetaItemResponseSchema` gains an optional `draftChanges` beside `item`: one entry per changed key path of the pending draft body, each `{ path, by, actor, at }`. `path` is an array of the keys from the body root to the deepest key the write changed (`["fields", "renewal_count"]`, `["fields", "renewal_count", "label"]`); an array value is one leaf, so a change to a view's columns is `["columns"]` and never carries an index (which elements differ is read by comparing the array with the published body's; the entry says who last changed the array); `[]` is the whole body of an item created as a draft. `by` is a closed set: `copilot` (an AI assistant's tool writing on a person's behalf), `studio` (a person editing in Studio) or `api` (any other caller of the save door). `actor` is the write's recorded identity or `null`, and `at` its ISO-8601 instant.
- **Where it is served.** Only on the strict draft read (`GET /meta/:type/:name?state=draft`), the read Studio's editor loads an item from, so the marks always describe the body that read returned. It is absent on the active read, the cached branch and the `?preview=draft` read. `ListDraftsResponseSchema` (`GET /meta/_drafts`) is unchanged.
- **Absent means "not recorded".** For a draft row whose saves recorded nothing (one saved before a server recorded the key), the key is absent rather than `[]`, so a reader never takes "not recorded" for "nothing changed".
- **Nothing breaks.** Every response that parsed before still parses, and no runtime behaviour changes in this release of the spec.
