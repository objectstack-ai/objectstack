---
'@objectstack/rest': patch
---

fix(rest)!: a bracketed `packageId` or `type` key on `GET /meta/_drafts` (`?packageId[]=ID`, `?packageId[0]=ID`, `?type[]=TYPE`, `?type[0]=TYPE`) is refused 400 naming the key instead of being ignored and answered with every package's or every type's drafts

Clause-②: no (narrowing) — `GET /meta/_drafts` with any query key that opens `packageId[` or `type[` (on `RestServer` and on the runtime dispatcher, which share the arity decision) is refused with `400 VALIDATION_ERROR`; it answered 200 with every draft the caller may read before. No package export, answer member, error code, status or `rule` tag is added: the refusal reuses the `bracketed-parameter` rule the list and the book tree already answer.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a drafts request that spells its one-package or one-type filter as an array key is refused instead of served unfiltered. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `/meta/_drafts` read (`@objectstack/rest`).

- **Before.** `?packageId[]=ID`, `?packageId[0]=ID`, `?type[]=TYPE` and `?type[0]=TYPE` (the qs-style array spellings) reached the door under the key as spelled, which neither filter read, so an author who asked for one package's or one type's drafts got every draft, as if it were the filtered list. Beside a plain `?packageId=` the bracketed key was silently dropped.
- **Now.** The door refuses a key that opens `packageId[` or `type[` after its capability gate and its multiplicity gate, before any read: `400 VALIDATION_ERROR`, message `Query parameter 'packageId[]' names no package; the 'packageId' filter takes exactly one package id, spelled ?packageId=ID. …` or `Query parameter 'type[]' names no metadata type; the 'type' filter takes exactly one metadata type, spelled ?type=TYPE. …`, and no list. A bracketed key beside the plain one is refused too.
- **Unchanged.** `?packageId=ID` and `?type=TYPE` narrow as before, and leaving them out lists every draft; a repeated `packageId` or `type` keeps its 400; a caller with no authoring capability is still refused 403 first.
- **Who sees it.** An API client that serialises arrays qs-style. `@objectstack/client`'s `listDrafts` builds both keys with `URLSearchParams` (no brackets), and the console sends `?packageId=` plain.

**The remedy.** FROM `?packageId[]=ID` (or `?packageId[0]=ID`) TO `?packageId=ID`; FROM `?type[]=TYPE` (or `?type[0]=TYPE`) TO `?type=TYPE`; leave the key out to list every draft.
