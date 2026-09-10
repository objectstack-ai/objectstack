---
'@objectstack/spec': patch
---

`EventMetadata.cluster` and `ServiceMetadata.cluster` cite the live docs page by SITE URL, not a dead filename

Both `.describe()` strings pointed at `cluster-semantics.mdx`, a page that is no
longer in the tree — `apps/docs/redirects.mjs` has redirected
`/docs/concepts/cluster-semantics` to `/docs/kernel/cluster` since the page was
folded in. The section numbers still resolved, so nothing was broken for a
reader following a link; what was broken is retrieval by filename, which finds
nothing.

These two strings are the published half. `gen:docs` copies them into
`content/docs/references/kernel/events-core.mdx` and `service-registry.mdx`, and
they also ship as JSON Schema `description` values under `packages/spec/json-schema/`
and as string literals in `packages/spec/dist/`. So the citation had to become
something a SITE reader can follow:

```
- See cluster-semantics.mdx §4.        (a file that does not exist)
+ See /docs/kernel/cluster §4.         (the address the redirect already resolves to)
```

⛔ Deliberately NOT the in-repo house style. Source comments elsewhere in the
tree cite `` `content/docs/kernel/cluster.mdx` §N `` — a repo path, correct for a
reader who has the repo checked out. Copying that convention into a `.describe()`
would tell a docs-site reader to open a `content/docs/...` file they do not
have, which is the same class of unfollowable reference pointed the other way.
There is no in-repo precedent to copy either way: these are the only two
`.describe()` strings in `packages/spec/src` that cite a docs page at all.

The site URL is also redirect-independent — it is the redirect's own target, so
the reference survives the redirect being retired.

No accept set moves and no authorable key is added or removed: the schemas,
their parse behaviour and their exported types are byte-identical apart from
these two description strings. The two regenerated reference pages carry the
same one-line change on three rows.
