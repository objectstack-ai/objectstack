---
"@objectstack/spec": patch
---

fix(spec): `JobSchema`'s own `@example` no longer opens with `id`, the key retired in 17.0.0 (#19184)

The TSDoc `@example` on `JobSchema` opened with `id: "job_sync_meta"`. `id` was removed in
17.0.0 (#4667, ADR-0049) and is tombstoned a dozen lines below the block that wrote it, so the
example the schema publishes was refused **by that schema** on a verbatim copy:

```
JobSchema.safeParse(<the block as written>)
  → success: false
  → unrecognized_keys: ["id"]
  → "Unrecognized key(s) on this job: `id`. • `job.id` was removed in @objectstack/spec 17.0.0 …"
```

The same object with the line deleted parses, so the one deleted line is the whole fix. An
`@example` is read by whoever copies it before they read the key table — an author, and every
agent writing job metadata from this schema — which is why a key the same file declares dead is
the one thing it must not open with.

Nothing about what a job may be written as changes here: the accept set, the key table, the
tombstone and its prescription are all untouched, and the generated authorable-surface and
JSON-Schema artifacts are byte-identical across the change. What ships is the corrected example
itself — `src/**/*.zod.ts` is part of this package's published `files`, so the block travels in
the tarball an upgrading consumer reads.

Scope, stated because the adjacent block invites it: the file's second `@example` (on
`defineJob`) carries no retired key and is untouched. The package-wide `@example` sweep is its
own card.
