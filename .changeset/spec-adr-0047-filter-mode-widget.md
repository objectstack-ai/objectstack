---
"@objectstack/spec": minor
---

feat(spec): page form filter-mode widget + ADR-0047 §3.4a (omit-is-none)

The Interface section's `interfaceConfig` composite now lists its sub-fields
explicitly so `userFilters` can use the dedicated `filter-mode` selector widget
(None / Tabs / Dropdown, objectui). An unknown widget name degrades gracefully
to the prior composite rendering, so this is independently mergeable.

ADR-0047 §3.4a records the design decision: "no filter bar" is the ABSENCE of
`userFilters`, not a literal `element: 'none'` — presence and style are
orthogonal axes, keeping declarative metadata and overlay diffs clean. The
`userFilters` element `'toggle'` is deprecated (kept in the enum for back-compat;
authoring offers None/Tabs/Dropdown only, Airtable parity).
