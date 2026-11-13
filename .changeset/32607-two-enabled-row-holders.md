---
'@objectstack/metadata-protocol': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol)!: a name two enabled packages hold only as stored rows is refused by the plain read, never served by save order (ADR-0150 D3, #32607)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill and no doc teaches what the read naming no package answers for a name only stored rows of several packages hold (`skills/**` and `content/docs/**` grepped: the `ambiguous-in-environment` mentions are about flow, queue and permission-set references, not `/meta` reads); the refusal's own sentence names the `?package=` remedy.

<!-- adr-0087: registered two-row-holders-bare-read-refused -->

**BREAKING** answer narrowing at the `/meta` bare item reads: a name that two or more enabled packages hold only as stored rows, and that no package ships in code, answers 409 `RESOURCE_CONFLICT` naming each of them, where the plain read and `/published` served one of the rows. `/layers` already refused it.

The row-aware served-holder judgment that a disabled holder brings in (#32354) now also judges, on the item read, a name with no disabled holder: the holders are the registry's holders and the packages the active stored rows are bound to, and two or more of them are refused as the by-name read refuses two package holders (`ambiguous-in-environment`). One holder reads as before. It applies to a type the registry reads by package, when no enabled package ships the name in code at any member, and when no package-less row or environment item of the name is stored.

**Every moved answer, before → after.** Both transports (`RestServer` and the runtime `HttpDispatcher`), both registration orders, both save orders, and on the runtime dispatcher before and after a reboot. First-party count 0: no first-party app saves one name into two packages' stored rows.

Narrowing:

- Bare `GET /meta/:type/:name`: 200 with the row saved first → 409 `RESOURCE_CONFLICT` naming each holder, with `details.candidates`.
- Bare `GET /meta/:type/:name/published`: 200 with a row (on `RestServer` the row saved first; on the runtime dispatcher the same package in every save order) → 409 `RESOURCE_CONFLICT` naming each holder.
- The execution face (`getMetaItemForExecution`) of the same name: the row saved first → the same refusal.

**Not moved.** Bare `GET /meta/:type/:name/layers` keeps its 409 `RESOURCE_CONFLICT`, the package-less writes' own refusal naming the same holders with its `?package=` prescription (#28337), on both transports: each transport's layered chain (`RestServer`'s and the runtime `HttpDispatcher`'s) reads the plain read first to find a disabled owner, and now leaves that read's refusal of row holders to the package-less refusal step, rethrowing every other refusal as before (two code holders, and two row holders beside a disabled one, keep the plain read's refusal). `?package=` naming either holder serves that holder's row. A name one package holds as a stored row is served as before. A row the reads decline (a shipped flow name's undeclared row, a sealed managed name's row) and a row bound to a holder's customization pair make no holder here, as they make none beside a disabled holder (#32354), so they never turn one holder into a refusal. A name an enabled package ships in code at any member (for a bundled type such as `email_template`, a base shipping `en-US` beside another package's `fr-FR` row: the package-less `fr-FR` read keeps its answer), or one with a package-less row or an environment item, is judged as before. The paired customization addresses (`?package=HOLDER.custom`), which after a reboot follow the registry's one bare slot, are unchanged here (#32662 carries them).
