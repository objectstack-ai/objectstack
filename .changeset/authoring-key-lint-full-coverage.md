---
"@objectstack/spec": minor
---

feat(spec): the unknown-authoring-key lint covers every metadata collection, not just objects (#3786)

#4148 introduced the lint for `object` and `field` — the two surfaces #4120
caught real drift on. Those two were a sample, not the population: of the
authorable metadata types, only a handful are `.strict()` (`flow` / `permission`
/ `position` / `tool` from #4001 Tier-A, joined mid-review by `app` via #4165).
Every other type strips an
undeclared key exactly the way `field` did — an author who misspells a key on a
`page`, an `agent` or a `dashboard` got the same parse-clean-value-gone silence,
with no lint watching.

`lintUnknownAuthoringKeys` now walks **every metadata collection** — 16 today:
object, page, dashboard, report, dataset, action, job, agent, skill, hook,
mapping, datasource, view, email_template, doc, book — and its coverage is
**derived, not listed**: which collections exist comes from `PLURAL_TO_SINGULAR`
(the same boundary map the normalizer uses), which schema judges each comes from
the canonical type→Zod registry, and whether linting is even meaningful is read
off each schema's own unknown-key posture. A third hand-written "types the lint
covers" list would have been the #3786 shape all over again, inside the tool
built to end it.

The posture rules keep the lint from ever disagreeing with the parse:

- **strip** (zod default) → lint: the parse drops unknown keys silently, and
  that silence is what gets reported.
- **strict** → skip: the parse already rejects loudly with the schema's own
  tombstone guidance; a second, possibly disagreeing voice helps nobody. This
  bucket GROWS as #4001 tiers graduate schemas — `app` graduated (#4165) while
  this change was in review, and the derivation adapted without an edit.
- **passthrough** → skip: unknown keys survive the parse, nothing is dropped.
- **unions** (`view`) → the union of member keys; lintable only when a member
  strips and none passes unknowns through.

`defineStack`, `os validate` and `os build` pick the wider coverage up with no
code change of their own. Verified against the three first-party example apps
(28 pages, 29 flows, 11 actions and friends in the showcase): all clean, zero
false positives. Verified by mutation: dropping union handling, inverting the
strict filter, and skipping a collection each turn the tests red.

New root/kernel exports: `listLintableAuthoringCollections` (+
`LintableAuthoringCollection`) — the derived coverage as data, so tooling can
report what the evidence base for the #4001 strict tiers actually spans.

One import-site change: `lintUnknownAuthoringKeys` moved from the `/data`
subpath to the package root and `/kernel` (`@objectstack/spec` root import is
unchanged and remains the canonical site). Covering every type means importing
every schema, and `/data` is consumed by frontend bundles — the walker moving
out keeps that chunk from inheriting the whole schema universe. If you imported
it from `@objectstack/spec/data`, import from `@objectstack/spec` instead. The
comparator, guidance tables and finding types stay in `/data`, unchanged.
