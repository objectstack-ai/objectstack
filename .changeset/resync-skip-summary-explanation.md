---
'@objectstack/cli': patch
---

`os meta resync`: explain a nonzero skip count instead of leaving it to look like a no-op (#9184)

`resynced 0 / skipped 8` is a **permanent, by-design** outcome on any install
created before #8692's forward-only ruling — the platform's own seeder wrote
the `'admin'` stamp those rows still carry, and #8692 deliberately never
migrates it (a stored `'admin'` cannot be told apart from a genuine Setup
takeover). The docblock half of this (#9130 / PR #9183) already explained it
in source; this is the half the operator actually sees, at the terminal,
without going looking:

```
⚠ Left 8 set(s) untouched (admin- or package-owned).
  Expected, not a failure — resync only reconciles platform-owned rows. A stored
  'admin' stamp (or the legacy 'user' spelling) isn't always a deliberate Setup
  takeover: on installs from before #8692, the platform's own seeded defaults
  carry that same stamp, so a persistent skip count here can be permanent by
  design. A package-owned row, by contrast, is always a deliberate override by
  the package that owns it.
```

The new line fires on the same condition the skip-count summary itself
already used (`resyncSkipped > 0`) — a partial skip gets the same
explanation as a total one. `--json` output is unchanged; `resyncSkipped` is
already a plain number a script can act on without prose.

While here, the skip-count summary's own wording is corrected: it read
`(admin- or package-owned override)`, uniformly claiming "override" for
both provenance classes. That is accurate for a package-owned row (always a
deliberate override, per the seeder's docblock) but was already the exact
false framing PR #9183 removed from the per-row log line for the
admin-owned case — a pre-#8692 seeded row was never overridden by anybody.
The summary now reads `(admin- or package-owned)`, and the new explanatory
line carries the nuance instead.
