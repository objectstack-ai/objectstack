---
'@objectstack/metadata': patch
---

`FilesystemLoader` now implements `loadManyKeyed()`, so a metadata file whose
body has no top-level `name` is no longer invisible to `MetadataManager.list()`.
`loadMany()` globbed files and pushed bodies, discarding the path it had just
read; the manager then fell back to keying by `body.name`, which drops every
nameless body — an aggregated `defineView` container has none by design. That is
the #14205 defect, unrepaired for this loader until now.

The key is this loader's own name-to-path derivation — the basename minus
extension, the same one `list()` reports — but only where that derivation is a
bijection for the file: it sits directly under `ROOT/TYPE/` and carries an
extension `findFile()` tries, so `findFile(type, key)` resolves back to that same
file. Every other shape (a nested path, an extension-less file) keeps the
previous behaviour verbatim: keyed by `body.name` when it has one, dropped when
it has none. `list()` and `findFile()` disagree outside the flat shape — `list()`
reports the bare basename for a nested file and `findFile()` cannot resolve it —
so keying those by the basename would mint names `get()` and `exists()` cannot
open, and two directories holding one basename would collide silently. Repairing
the derivation itself is tracked separately.

One deliberate consequence: a flat file whose `body.name` disagrees with its
basename is now keyed by the basename. That is #14205's rule (identity is the
key the store holds an item under, not `body.name`) applied to this loader, and
it aligns `list()` with `listNames()` for that shape. `loadMany()`'s own
signature and answer are unchanged; both methods now share one file walk so
their bodies cannot drift.
