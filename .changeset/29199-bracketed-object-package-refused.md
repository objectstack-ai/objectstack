---
'@objectstack/rest': patch
---

fix(rest)!: a bracketed `object` key on the view list (`?object[]=NAME`, `?object[0]=NAME`) and a bracketed `package` key on the `/meta` list and book tree (`?package[]=ID`, `?package[0]=ID`) are refused 400 naming the key instead of being ignored and answered with every view or every package

Clause-②: no (narrowing) — `GET /meta/view` / `GET /meta/views` with any query key that opens `object[`, and `GET /meta/:type` / `GET /meta/book/:name/tree` with any query key that opens `package[` (on `RestServer` and on the runtime dispatcher, which share the list chain and the arity decision), are refused with `400 VALIDATION_ERROR`; they answered 200 with every view, or across every package, before. No package export, answer member, error code or status is added; the shared refusal record's `rule` tag names one more reason (`bracketed-parameter`), which no transport writes to the wire.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a list or tree request that spells its one-object filter or its one-package scope as an array key is refused instead of served unfiltered. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `/meta` list and book tree reads (`@objectstack/rest`).

- **Before.** `?object[]=lead` and `?object[0]=lead` (the qs-style array spellings) reached the view list under the key as spelled, which the view switcher never read, so a caller who asked for one object's views got every view it may see. `?package[]=ID` and `?package[0]=ID` reached the list and the book tree the same way, which read no package, so a caller who named one package was answered across every package.
- **Now.** The list chain refuses a key that opens `object[` on the view list, after the per-caller visibility gate, as it refuses a bracketed `id` on the app list: `400 VALIDATION_ERROR`, message `Query parameter 'object[]' names no object; the 'object' filter takes exactly one object name, spelled ?object=NAME. …`, and no list in the body. The list and the book tree refuse a key that opens `package[` at their entry, before any read: `400 VALIDATION_ERROR`, message `Query parameter 'package[]' names no package; the 'package' filter takes exactly one package id, spelled ?package=ID. …`. A bracketed key beside the plain one is refused too.
- **Unchanged.** `?object=NAME` switches to that object's views; `?package=ID` scopes to that package (`?package=all` and no `package` read every package); an empty `?object=` and a repeated `object` or `package` keep their 400s; a bracketed `object` key on any type but `view` is still ignored, as `?object=` is there. Every by-name `/meta` door (the item read, `/layers`, the save, the reset, `/publish`) and the diagnostics sweep already refused a bracketed `package` key as an unknown name, and still do.
- **Who sees it.** An API client that serialises arrays qs-style. `@objectstack/client` builds `?package=` with `URLSearchParams` (no brackets), and the console sends neither key bracketed.

**The remedy.** FROM `?object[]=NAME` (or `?object[0]=NAME`) TO `?object=NAME`; FROM `?package[]=ID` (or `?package[0]=ID`) TO `?package=ID`; leave the key out to list every view, or every package.
