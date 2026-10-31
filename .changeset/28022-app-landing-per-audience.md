---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): an app can name a landing per audience with `landing`

Clause-②: yes (widening)
Metadata-protocol: added

An app opens on its first navigation item, one landing for every audience. `AppSchema` now declares `landing`, a list of `{ item, visible }` entries (`AppLandingEntrySchema`): the first entry whose `visible` (CEL, the dialect of a navigation entry's `visible`) holds for the reader names the navigation entry the app opens on. With no match, or no key, the app opens where it did before: its first navigation item by `order`.

- **It cannot dangle.** Every app parse runs `appLandingItemsResolve`: an `item` that names no entry of the app's own `navigation` or `areas[].navigation` (any depth), or names a `group`, `separator` or `action` entry, is refused at `landing.N.item`, and the message lists the entries that do exist. Items another package contributes through `navigationContributions` cannot be named.
- **It is per audience.** `visible` is required, and an empty list is refused. To change where everyone lands, put that entry first in `navigation`, as before. A `visible` that reads `data` is refused: a landing entry has no `dataSource`.
- **Lint.** `os validate` and `os build` check each landing predicate with the shared expression validator (CEL syntax, size, unknown functions). The metadata save door runs the parse refusals above on every app write.
- **Planned.** No console reads `landing` yet. The liveness ledger carries it as `planned` with an author warning, so `os validate` tells an author that every reader still opens on the first navigation item until the console landing redirect ships.

Nothing to do for existing apps. The retired `homePageId` (and its `home` / `homepage` / `landingpage` spellings) still answers with its removal notice, which now also names `landing`.
