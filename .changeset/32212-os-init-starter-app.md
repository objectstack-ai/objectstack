---
'@objectstack/cli': patch
---

feat(cli): `os init` scaffolds a starter app and list view, so a new project opens in the Console with its own object

Clause-②: no
Metadata-protocol: none

`os init` (the default `app` template) now writes `src/apps/main.app.ts`, an app whose one navigation entry opens the starter object, and `src/views/NAMESPACE_item.view.ts`, that object's list view, each wired through its directory's `index.ts`. Before, the project booted with its object served over REST and MCP and nothing of its own in the Console, which lists an object only where an app names it. The files are what `os generate app main --object NAMESPACE_item` and `os generate view NAMESPACE_item` write, except that both reference the object through an import of its module (`.name`) instead of typing its name out, so renaming the object moves them with it.

A package whose manifest type is `app` holds at most one app, so in a project scaffolded this way `os generate app` is refused while the starter app is there: add a navigation entry for each new object to `src/apps/main.app.ts` instead (its comment says so), or replace the starter app with your own.

`os init -t plugin` writes the list view and no app: navigation belongs to the stack that loads the package, and the template has no `dev` script with a Console of its own. `os init -t empty` declares no object and writes neither.

Scaffolding into a directory that already holds `src/apps/index.ts` or `src/views/index.ts` keeps that file and appends the template's export line to it, as `os generate` does.
