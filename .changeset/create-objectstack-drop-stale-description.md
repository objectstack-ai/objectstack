---
"create-objectstack": patch
---

Fix scaffolded projects describing themselves as the blank template (#9263)

`rewriteProjectIdentity` rewrote `id` / `namespace` / `name` in both
`objectstack.config.ts` and `objectstack.manifest.json` from the project name,
but left `description` untouched — every scaffolded project carried the blank
template's own line verbatim ("Minimal ObjectStack environment — a clean
slate for building."), confidently wrong rather than empty, and printed by
the first command the getting-started flow tells people to run (`os
validate`).

The scaffolder now drops `description` from both files instead of rewriting
it. There is nothing but the project name to derive a replacement from, and a
name-derived sentence (e.g. "Support Desk — an ObjectStack environment.")
would be a bare restatement of the `name`/`displayName` row already shown —
worse than no sentence at all. `os validate` already omits the description
line entirely when the field is unset, so a freshly scaffolded project now
prints cleanly:

```
  Support Desk v0.1.0
```

instead of

```
  Support Desk v0.1.0
  Minimal ObjectStack environment — a clean slate for building.
```
