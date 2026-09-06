---
'@objectstack/lint': patch
---

Read the last sixteen collection copies through the package's shared, guarded readers.

Sixteen rule modules still declared their own `(v: unknown) => AnyRec[]`
collection coercion. Twelve — the `function` form, which had already grown the
non-record filter locally in two different spellings — now read `recordsOf`
from `object-graph.ts`. The four page walks (`validate-jsx-pages`,
`validate-page-source-styling`, `validate-react-page-props`,
`validate-react-pages`) carried the arrow form, which cast its array branch
unchecked; they now read `collectionEntries` from `collection-entries.ts`,
which drops a non-record member inside the reader while carrying each
survivor's real config path, so a `pages:` list with an empty item no longer
renumbers the `pages[N].source` path a finding points an editor at.

Two behaviour changes fall out, both on input that was already malformed. An
array-typed member of `agents:` / `skills:` / `tools:` used to survive the
looser local filter and draw one reference-integrity finding at a position
nobody authored; it is now dropped. And a member of a name-keyed `validations:`
map whose value is not a record is now carried as `{ name }` rather than
discarded, which reaches no check that reads it. No rule id, message or
severity changes, and every finding path on well-formed metadata is unchanged.
