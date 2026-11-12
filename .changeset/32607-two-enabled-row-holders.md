---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a name two enabled packages hold only as stored rows is refused by the plain read, never served by save order (ADR-0150 D3, #32607)

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill or doc teaches the by-name answer for a name only stored rows of several packages hold; the refusal's own sentence says to address it by its package.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are reads of stored rows, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** answer narrowing at the `/meta` bare item reads: a name that two or more enabled packages hold only as stored rows, and that no package ships in code, answers 409 `RESOURCE_CONFLICT` naming each of them, where the plain read and `/published` served one of the rows. `/layers` already refused it.

The row-aware served-holder judgment that a disabled holder brings in (#32354) now also judges, on the item read, a name with no disabled holder: the holders are the registry's holders and the packages the active stored rows are bound to, and two or more of them are refused as the by-name read refuses two package holders (`ambiguous-in-environment`). One holder reads as before. It applies to a type the registry reads by package, when no enabled package ships the name in code, and when no package-less row or environment item of the name is stored.

**Every moved answer, before → after.** Both transports (`RestServer` and the runtime `HttpDispatcher`), both registration orders, both save orders, and on the runtime dispatcher before and after a reboot. First-party count 0: no first-party app saves one name into two packages' stored rows.

Narrowing:

- Bare `GET /meta/:type/:name`: 200 with the row saved first → 409 `RESOURCE_CONFLICT` naming each holder, with `details.candidates`.
- Bare `GET /meta/:type/:name/published`: 200 with a row (on `RestServer` the row saved first; on the runtime dispatcher the same package in every save order) → 409 `RESOURCE_CONFLICT` naming each holder.
- The execution face (`getMetaItemForExecution`) of the same name: the row saved first → the same refusal.

**Not moved.** Bare `GET /meta/:type/:name/layers` keeps its 409 `RESOURCE_CONFLICT`, the package-less writes' own refusal naming the same holders with its `?package=` prescription (#28337). `?package=` naming either holder serves that holder's row. A name one package holds as a stored row is served as before. A name an enabled package ships in code, or one with a package-less row or an environment item, is judged as before. The paired customization addresses (`?package=HOLDER.custom`), which after a reboot follow the registry's one bare slot, are unchanged here (#32662 carries them).
