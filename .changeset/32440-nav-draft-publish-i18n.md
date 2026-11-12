---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a nav entry with no target survives a reload, marked incomplete; the publish sheet names every draftable type and reads its security rows in the console's language

Clause-②: no
Metadata-protocol: none

- **Navigation editor.** A nav entry added with *＋* and not yet linked to a target is left out of what the nav save sends, because the spec's navigation item refuses a target-bearing entry with no target and the draft door judges the schema. The editor kept showing it only until a reload: after one, the navigation panel read "No nav items yet" while *Changes* still counted the app draft, and the next added entry was numbered from 1 again. The entries a save leaves out are now kept in this browser (`localStorage`, keyed by the active organization, the package the save writes to and the app). The next read of the app puts each one back in its place, so it stays in the rail and on the canvas, tagged "Incomplete" (zh 「未完成」), until a target is picked (the save then sends it) or it is removed. The server's draft never holds it, and publishing never carries it. The keys go with the sign-out and owner-change sweeps of `@object-ui/auth`. Another browser or device still shows the app as the server holds it.
- **Publish sheet.** A type with no count row showed as its raw name (`mapping 1`, `seed 1`, uppercased in the group heading). Every type a runtime author can draft now has one: `mapping`, `seed`, `external_catalog`, `doc`, `book`, `position`, `tool` and `skill` join the existing rows, in all eleven locale packs. A test holds the rows to the spec registry's `allowRuntimeCreate` types. The pre-publish security rows now read their rule's verdict in the console's language for the four rules that can fire on an object draft (`security-owd-unset`, `security-owd-alias`, and the two `controlled_by_parent` relation rules). The rule's own English text, which names the exact value and remedy, stays on the row's tooltip, and any other rule still reads its own text.
- **`@object-ui/i18n`:** `preview.changes.typeCount.{mapping,seed,external_catalog,doc,book,position,tool,skill}` and `preview.changes.securityRule.*` in all eleven packs; `engine.appNav.incomplete` and `engine.appNav.incompleteHint` in the `studio` namespace.
