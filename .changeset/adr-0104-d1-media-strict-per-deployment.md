---
"@objectstack/objectql": minor
---

feat(objectql)!: media value shapes enforce once THIS deployment has verified its file migration (#3438 D1 media half, gated by #3617)

A `file` / `image` / `avatar` / `video` / `audio` value that does not match the
stored contract (an opaque `sys_file` id) now **rejects with `invalid_type`**
instead of warning — but only on a deployment that has run
`os migrate files-to-references --apply` and passed its self-check.

**Why this is not a version-wide flip.** The legacy media values this rejects —
inline `{url, name, …}` blobs, bare URLs — are exactly what that migration
converts. A deployment that has run it has been *shown* to hold none; a
deployment that has not would have every media-field update start failing the
moment it upgraded. So the enforcement follows the evidence, per deployment,
rather than the release. Nothing changes for a deployment until it migrates.

**Upgrading:**

```bash
os migrate files-to-references          # dry run: reports what would convert
os migrate files-to-references --apply  # convert, verify, record the flag
```

If a write starts failing after you migrate, the value genuinely does not match
the contract — the error names the field. `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens
media leniency while you diagnose.

**Scope — deliberately only media.** `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` is
unchanged and still opts every class into strict (and still forces media strict
on a deployment that has not migrated). Reference types (`lookup`, `user`, …)
and structured JSON (`location`, `address`, `repeater`, …) stay warn-first: the
file migration is evidence about file values and says nothing about whether a
`location` is well formed, so gating them on its flag would be borrowing
evidence for a fact it does not cover. They flip when something can vouch for
them — see #3438.

**Cost.** Dormant unless the written object declares a media field, and the
flag read is memoized, so this is one query per process for apps that store
files and zero for those that do not. A running server picks up a
newly-recorded migration on restart, or via `engine.invalidateDataMigrationFlags()`.
