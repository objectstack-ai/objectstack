---
'@objectstack/rest': patch
---

fix(rest)!: `GET /meta/app?id=` with an empty value is refused 400 naming the parameter instead of being read as absent

Clause-②: no (narrowing) — `GET /meta/app` and `GET /meta/apps` (on `RestServer` and on the runtime dispatcher, which share the list chain) refuse an empty `?id=` with `400 VALIDATION_ERROR`; they answered 200 with the caller's whole visible app list before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a list request whose app filter names nothing is refused instead of served unfiltered. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the app list read (`@objectstack/rest`).

- **Before.** `?id=` with an empty value was read as no filter, so a caller who asked for one app by a name that came out blank got every app it may see.
- **Now.** The list chain refuses it after the per-caller visibility gate: `400 VALIDATION_ERROR`, message `Query parameter 'id' names no app; …`, `param: 'id'`, and no list in the body. This is the answer #27484 gave a blank `$searchFields`.
- **Unchanged.** A non-empty `id` narrows as before (one app, or an empty list when it names none, including `' '`); no `id` lists every app the caller may see; a repeated `id` is still the arity 400; `?id=` on any other type is still ignored.
- **Who sees it.** An API client that sends `?id=` empty. `@objectstack/client` and the console send no `id` on this read.

**The remedy.** Name the app, or leave `id` out to list them all.
