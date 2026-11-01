---
'@object-ui/app-shell': minor
'@object-ui/types': minor
'@objectstack/spec': minor
---

feat(console)!: an app opens on the first `landing` entry whose `visible` holds for the reader

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The one value the spec newly refuses is a `landing` entry whose `item` names a `url` navigation entry, and `landing` itself has not shipped in any published `@objectstack/spec` (it arrived in #28449, whose changeset is still pending), so no stored app carries one for a migration to rewrite; the FROM → TO line below is author guidance for a draft written against the unreleased key. objectui's `app` node now runs the spec's own check, so an app that passes the spec passes objectui unchanged. -->

**BREAKING** accept-set narrowing in two places: `@objectstack/spec` refuses a `landing` entry that names a `url` navigation entry, and objectui's `app` node (`@object-ui/types` `AppComponentSchema`, and the published `objectui validate` door on it) runs the spec's landing check, so it refuses what the spec refuses.

- **The console reads `landing`.** On the app root (`/apps/:app`), the console asks the app's `landing` entries in order and opens the navigation entry named by the first one whose `visible` holds for the signed-in member. Before, every reader opened on the app's first navigation item whatever the list said. No match, or no `landing` key, keeps that rule: the first navigation item by `order`.
- **The predicate's scope.** `visible` is asked with the evaluator the app's navigation `visible` uses, over the same roots: `current_user` (and its `user`, `ctx.user` and `os.user` aliases) and `features`. No `data` is bound. A predicate naming any other root (`record`, `app`) faults.
- **A fault passes the entry over.** A predicate the evaluator cannot answer is reported once in the browser console (the navigation gate's `withholding` line) and its entry is skipped; the next entry is asked. The landing only decides where a reader opens: every navigation entry keeps its own `visible`, `requiredPermissions` and `requiresObject` gates.
- **Only an entry the member is shown.** The `item` is looked up, at any depth, in the app's `navigation` and then each `areas[].navigation`, as the member is shown them. An entry the member's navigation gates hide is passed over. A `doc` entry lands: it opens the in-app docs portal, and which docs a reader may open stays the server's audience gate on the doc.
- **objectui refuses what the spec refuses.** `AppComponentSchema` now runs `checkAppLandingItems`: a `landing` entry whose `item` names no entry of the app's own navigation, or names a `group`, `separator` or `action` entry, is refused at `landing.N.item`, and a `visible` that reads `data` at `landing.N.visible`, with the spec's own message. To fix such a document, name an entry the app declares that opens a page, and gate on `current_user` or `features`.
- **Deriving from `AppComponentSchema`.** It now carries a refinement, and zod refuses `.extend()`, `.omit()` and `.pick()` on an object that carries one. Derive from it with `AppComponentSchema.shape` or `.safeExtend()`.
- **`@objectstack/spec` refuses a `url` landing.** A `url` navigation entry opens an external address, and the app-root landing is an in-app redirect, so a `url` landing would land nobody. `checkAppLandingItems` now refuses it at `landing.N.item` with the `group` / `separator` / `action` refusal, and the message no longer lists `url` among the entries that open something.

  FROM → TO: `landing: [{ item: 'nav_help_site', visible: … }]` naming a `url` entry → `landing: [{ item: 'nav_help', visible: … }]` naming an in-app entry the app declares (an `object`, `page`, `dashboard`, `report`, `component` or `doc` entry).
- **The liveness row flips.** `app.landing` (with `item` and `visible`) is `live` in `@objectstack/spec`'s liveness ledger, and its author warning is dropped.
