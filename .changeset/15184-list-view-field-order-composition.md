---
'@objectstack/spec': patch
---

`ListViewSchema` declares the `columns` x `hiddenFields` x `fieldOrder` composition instead of leaving it to be inferred from a renderer (#15184)

The three keys that decide which fields a list view shows, and in what order, now say so in their own `.describe()` text — the string that ships into `json-schema/`, into the generated `content/docs/references/ui/view.mdx`, and into the TSDoc an author hovers:

- `columns` is the **projection**: the candidate set and the baseline order. A field omitted here is not displayed, and neither other key can add it back.
- `hiddenFields` **subtracts** from that projection, before any ordering runs. A name `columns` never projected subtracts nothing.
- `fieldOrder` **orders what survives** and never adds a field. A surviving column absent from `fieldOrder` sorts **last**, after every listed one, keeping its `columns`-relative order; a name listed there that did not survive orders nothing.

**Why this is a declaration and not a precedence rule.** `fieldOrder` was proposed for retirement as a second spelling of `columns` with no contract deciding who wins. They never compete: one selects, the other sorts. Maintainer decision batch #115 (2026-09-11) kept the key and ruled the composition into the contract, which is what this change lands.

⛔ **No accept set moves.** No key is added, removed, narrowed or widened; no parse verdict changes; the four `@objectstack/lint` list-view validators are untouched. What changes is the published description of three keys that were already there, plus one ledger row's evidence.

**`packages/spec/liveness/view.json` — the `/props/list/children/fieldOrder` row is re-cited**, `verifiedAt: 2026-09-21`. The ledger ships in this package's `files[]`, so the pointers an upgrading reader follows are these, and both halves of the 2026-08-10 citation had rotted: its first path (`objectui packages/react/src/spec-bridge/bridges/list-view.ts`) no longer exists, and its second had drifted in range through three sets of line numbers. The row now anchors both pointers on symbols, splits the relay rung out into `producer`, and names the measurement it was taken at.

The declaration and the accept set are held together by `packages/spec/src/ui/view-field-order-composition.pin.test.ts`: it reads the three descriptions off the live schema and parses a document carrying all three keys through the page-list, object-views, `defineView` and registered-metadata doors, asserting the arrays come back verbatim — the spec declares the composition, it does not perform it.
