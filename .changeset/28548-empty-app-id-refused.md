---
'@objectstack/rest': patch
---

fix(rest)!: an empty `?id=` on the app list and an empty `?object=` on the view list are refused 400 naming the parameter instead of being read as absent

Clause-②: no (narrowing) — `GET /meta/app` / `GET /meta/apps` with an empty `?id=`, and `GET /meta/view` / `GET /meta/views` with an empty `?object=` (on `RestServer` and on the runtime dispatcher, which share the list chain), are refused with `400 VALIDATION_ERROR`; they answered 200 with the caller's whole visible list before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a list request whose filter names nothing is refused instead of served unfiltered. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the app and view list reads (`@objectstack/rest`).

- **Before.** `?id=` (app list) and `?object=` (view list) with an empty value were read as no filter, so a caller who asked for one app, or for one object's views, by a name that came out blank got every app or every view it may see (the views unsorted, and including views bound to no object).
- **Now.** The list chain refuses either after the per-caller visibility gate: `400 VALIDATION_ERROR`, message `Query parameter 'id' names no app; …` or `Query parameter 'object' names no object; …`, `param` set to the parameter, and no list in the body. This is the answer #27484 gave a blank `$searchFields`.
- **Unchanged.** A non-empty value narrows as before (one app or one object's views, or an empty list when it names none, including `' '`); no value lists every item the caller may see; a repeated `id` or `object` is still the arity 400; `?id=` on any type but `app`, and `?object=` on any type but `view`, are still ignored.
- **Who sees it.** An API client that sends either parameter empty. `@objectstack/client` and the console send neither on these reads.

**The remedy.** Name the app or object, or leave the parameter out to list them all.
