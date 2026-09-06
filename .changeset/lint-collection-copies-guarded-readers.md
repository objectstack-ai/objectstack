---
'@objectstack/lint': patch
---

Fix: a name-keyed `pages:` map no longer passes every source-page lint vacuously.

`pages` has two authoring carriers — a list, or a map keyed by page name that
`normalizeStackInput` folds into a list before the schema sees it. Four rules
(`validate-jsx-pages`, `validate-page-source-styling`,
`validate-react-page-props`, `validate-react-pages`) read the collection through
a private coercion that answered a map with an empty list, and they run on the
raw `os lint` path where nothing has normalized it yet. On a map-shaped stack
all four therefore returned no findings by never walking a single page: an
empty source, a syntax error, an unparseable component and a Tailwind
`className` were all reported as clean. They now read `collectionEntries`,
which handles both carriers, and a finding on the map carrier is located by the
author's own key (`pages.home.source`) rather than a synthetic index.

The same change removes the last sixteen private copies of the collection
coercion in this package. Twelve rules — the `function` form, which had already
grown the non-record filter locally in two different spellings — now read
`recordsOf` from `object-graph.ts`. Two behaviour changes fall out, both on
input that was already malformed: an array-typed member of `agents:` /
`skills:` / `tools:` used to survive the looser local filter and draw one
reference-integrity finding at a position nobody authored, and is now dropped;
a member of a name-keyed `validations:` map whose value is not a record is now
carried as `{ name }` rather than discarded, which reaches no check that reads
it. No rule id, message or severity changes, and every finding path on the list
carrier is unchanged.
