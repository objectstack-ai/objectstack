---
'@objectstack/rest': patch
---

fix(rest)!: the public form submit door refuses a value outside a form row's declared `options` subset (#27606)

Clause-②: no (narrowing) — `POST /forms/:slug/submit` now refuses a value outside the `options` subset a form entry declares, which it used to store with `201`. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: one REST door now enforces the `options` subset a form entry already declares and `GET /forms/:slug` already serves. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the anonymous public form submit door (`@objectstack/rest`).

- **Before.** A form entry such as `{ field: 'priority', options: [low, medium, high] }` narrowed what the form offered, and `GET /forms/:slug` served that subset, but `POST /forms/:slug/submit` judged keys and the form's `required` only. The engine judges a value against the object's options, so a guest could store `critical` through that form with `201`.
- **Now.** The door answers `400 VALIDATION_FAILED` before anything is written, naming the field in `fields[]` with the ADR-0114 code `invalid_option`, the catalog's message, and `constraint.allowed` listing the subset's values only. It is the same envelope the form's `required` and file refusals use, so a submission with several problems is told all of them at once. A multi-valued field is judged element by element, the first outside element named.
- **Unchanged.** A value inside the subset saves as before. An empty or absent optional value is not judged. An entry that lists no `options` keeps the object's full set, judged by the engine as before, and so does a field that another entry of the same form offers without a subset.
- **Who sees it.** A client posting to a published form a value the form does not offer: a script or bot, or the console's public form page, which still lists every option of the field until its renderer reads the row's subset (a separate `domain:ui` change).

**The remedy.** Send one of the values the form serves for that field in `GET /forms/:slug`, or remove the entry's `options` to offer the object's full set.
