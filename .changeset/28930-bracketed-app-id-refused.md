---
'@objectstack/rest': patch
---

fix(rest)!: a bracketed `id` key on the app list (`?id[]=NAME`, `?id[0]=NAME`) is refused 400 naming the key instead of being ignored and answered with the whole list

Clause-②: no (narrowing) — `GET /meta/app` / `GET /meta/apps` with any query key that opens `id[` (on `RestServer` and on the runtime dispatcher, which share the list chain) is refused with `400 VALIDATION_ERROR`; it answered 200 with the caller's whole visible list before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a list request that spells its one-app filter as an array key is refused instead of served unfiltered. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the app list read (`@objectstack/rest`).

- **Before.** `?id[]=setup` and `?id[0]=setup` (the qs-style array spellings) reached the list chain under the key as spelled, which the one-app filter never read, so a caller who asked for one app got every app it may see.
- **Now.** The list chain refuses a key that opens `id[` after the per-caller visibility gate: `400 VALIDATION_ERROR`, message `Query parameter 'id[]' names no app; the 'id' filter takes exactly one app name, spelled ?id=NAME. …` (the message names the key as sent, in the frame the empty `?id=` refusal uses), and no list in the body. A bracketed key beside a plain `?id=` is refused too.
- **Unchanged.** `?id=NAME` narrows to that app (or an empty list when it names none); no `id` lists every app the caller may see; an empty `?id=` and a repeated `id` keep their 400s; a bracketed `id` key on any type but `app` is still ignored, as `?id=` is there.
- **Who sees it.** An API client that serialises arrays qs-style. `@objectstack/client` and the console send no `id` on this read.

**The remedy.** FROM `?id[]=NAME` (or `?id[0]=NAME`) TO `?id=NAME`; leave `id` out to list every app.
