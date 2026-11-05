---
'@object-ui/app-shell': patch
---

feat(app-shell): Studio customizes an installed app's navigation into the base's customization package (#30059)

Clause-②: no
Metadata-protocol: none

On a read-only (installed or code-shipped) package that has a paired customization package (`<base>.custom`), the Interfaces rail now edits the app's navigation. Before, the rail's Edit button showed only on a writable package and its "+" offered only new pages, dashboards and reports, so an object made in the pair could be reached only by a typed URL.

- Edit and the "+" open the same navigation editor a writable package uses (add, rename, reorder, group and remove entries, including the ones the base shipped). Nothing is written until an edit is saved. The first saved edit copies the whole app into the pair, declaring `overrides: { package: <base>, basedOn: <base manifest version> }`, the same route a view's Customize takes. Later edits update that copy. The base package is never written.
- The entry pickers list the pair's objects, pages, dashboards, reports and views after the base's, so a new object in the pair can be put on the menu. An entry bound to an object only the pair holds carries `requiresObject: <object>`, so the runtime hides it if the object is later removed instead of linking to a missing object.
- The navigation change is a draft in the pair's pending changes and publishes in the same batch (one commit) as the object it opens.
- The rail marks a customized navigation with the same compact "customized" mark its rows carry, "only customizations" counts it and keeps the navigation listed, and the mark's popover offers "Restore package original", which deletes the pair's draft and copy of the app after a confirmation.

A customized app is a whole copy: a navigation entry the vendor adds in a later version does not appear until the customization is restored and redone. A writable package's navigation editing is unchanged. No spec, server or metadata-type change.
