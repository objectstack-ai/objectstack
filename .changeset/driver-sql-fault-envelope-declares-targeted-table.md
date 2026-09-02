---
'@objectstack/driver-sql': patch
---

fix(driver-sql): the terminal backend-fault envelope declares the table the statement targeted, so a genuinely absent federated remote reads benign again (#13438)

`isMissingTableError(error, readObject)` compares the dialect's missing-table
phrase against the name the **caller** read — its API object name (#13324). For a
federated object (ADR-0015) that is not the name in the statement:
`registerExternalObject` records `external.remoteName` and `getBuilder` targets
it. So a caller reading `crm_order` from an absent `legacy_orders` got a phrase
naming `legacy_orders`, compared it against `crm_order`, and was told the failure
was about some other relation — the **loud** verdict, for the one case the benign
licence exists for. Nothing at the call site knows the mapping; it lives on the
driver instance.

Maintainer ruling 2026-09-01 (option 2 on the card): the driver declares the table
it targeted on the envelope. `backendStatementFaultError` — the terminal of the
`find` / `count` / `aggregate` read exits — now stamps the physical table the
statement was compiled against (a federated object's `external.remoteName`,
otherwise the object's own name, resolved exactly as `getBuilder` resolves it)
onto the envelope under `@objectstack/types`' `DRIVER_TARGETED_TABLE` symbol.

The member is **code-readable and serialisation-invisible** — a non-enumerable
symbol key, the same discipline the envelope already applies to `cause`:
`JSON.stringify(err)`, `{ ...err }` and `Object.keys(err)` never carry it. ⛔ It is
never written into the message: #8931's disclosure clause stands, and the
composed message still names only the caller's object. No new export from this
package and no new error code; the envelope's `code` / `status` / `message` are
byte-identical to before.

Pinned live on SQLite, Postgres and MySQL: the declared table is the name the
dialect's own phrase carries; an absent remote now reads benign through the real
predicate while the same envelope without the declaration still reads loud (the
control); a native object declares its own name and matches as before; and a
relation the statement did **not** target (a view over a dropped base table)
stays loud with the declaration present — the #13324 narrowing does not reopen.
