---
'@objectstack/spec': minor
---

A navigation entry whose `visible` reads `data` must declare `dataSource`: an entry with no `dataSource` whose `visible` predicate reads the top-level `data` root is refused at parse, at the entry's own `visible`, with the fix.

Clause-②: no (narrowing)

<!-- adr-0087: registered nav-item-visible-data-needs-data-source -->

**BREAKING** (an accept-set narrowing on a published authoring surface: `NavigationItemSchema`), shipped as `minor` under the launch-window convention for breaking changes (Changesets is in pre mode on `main`, tag `next`).

**Why.** A navigation entry may declare one API `dataSource`, whose selected value its `visible` reads as `data`. That is the only thing that puts a `data` root in a navigation predicate's scope: the console shell's ambient roots are `current_user`, `user`, `ctx.user`, `os.user` and `features`, and a group's `dataSource` is not published to its children. An entry that reads `data` without declaring a source has nothing to read, so until now it parsed, passed `os validate` and shipped as an entry the console never shows, with the author told nothing.

**What is refused.** A navigation entry of any type (a `group` included) with no `dataSource` whose `visible`, a CEL predicate, reads the root `data`: `data.total == 1`, `!data.has_more`, `has(data.total)`, `.data.total == 1`, or `${data.total == 1}`. The answer is one `custom` issue at the entry's `visible` (for example `navigation.0.children.2.visible`), whose message begins *This navigation entry's `visible` reads `data`, but the entry declares no `dataSource`, so there is no `data` to read*, and names the fix. It is a check on `NavigationItemSchema` itself, so it reaches every door that parses a navigation entry: `app.navigation`, `app.areas[].navigation`, every `children` array at any depth, and a navigation contribution's `items`, through `defineApp`, `defineStack`, `os validate` / `os build` and the metadata write door.

**What stays accepted, byte for byte.** An entry that declares `dataSource` and reads `data`; an entry whose `visible` reads only `current_user`, `features` or other ambient roots; a `data` that is a member name (`current_user.data.total`), text inside a string literal or a `//` comment, or a comprehension macro's own iteration variable (`current_user.positions.exists(data, data == 'org_admin')`); an entry with no `visible`; and a separator.

**FROM → TO.**

- FROM `{ id: 'nav_environments', type: 'object', objectName: 'sys_environment', visible: 'data.total == 1' }`
- TO `{ id: 'nav_environments', type: 'object', objectName: 'sys_environment', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' }, visible: 'data.total == 1' }`, or drop the `data.*` read and gate on `current_user` / `features`.

One-line fix: declare `dataSource` on the entry whose `visible` reads `data`, or drop the `data.*` read. A child of a group that declares a `dataSource` declares its own. No conversion can do this for you: only the author knows which endpoint the entry was meant to read.

**Who is affected, measured.** No navigation entry in this repository reads `data` without a `dataSource`: an AST census of every tracked `.ts` / `.tsx` / `.mts` file found 11 navigation entries with a `visible`, of which 2 read `data` (both spec tests, both declaring a `dataSource`) and 3 read `current_user`. Deployed metadata was not measured.

### The kit

- **The refusal.** A module-private CEL root reader and the refinement that uses it, mounted once on `NavigationItemSchema` in `ui/app.zod.ts`. The `visible` description now says the read is refused without a `dataSource`, and the generated reference page carries it.
- **The ledger.** The D3 semantic entry `nav-item-visible-data-needs-data-source` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion.
