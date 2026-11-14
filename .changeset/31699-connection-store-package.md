---
'@objectstack/service-automation': patch
---

feat(service-automation): the connector connection store, the connect door and the OAuth callback read and write one instance by its package and name (ADR-0150 D4, #31699)

Clause-②: yes (widening) — the connect door (`getConnectorConnection`, `beginConnectorConnection`, `completeConnectorConnection`, `revokeConnectorConnection`) and a dispatch answer new refusals, each listed under "What answers differently"; a connection row now carries its instance's package. The one-holder backstop still keeps every connector name to one package at boot, and while a name has one holder every row of the name answers its one instance, as the read by name did, so on a database where each organization keeps one connection of an instance and the name has one holder, every answer is as before, a declaration that moved to another package or to the environment included.
Metadata-protocol: none
Skills-docs: `content/docs/automation/connectors.mdx` says a callback completes the instance its connect was begun for and the door refuses a name two packages hold. `skills/**` teaches "connect once per organization", which still holds per instance.

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped: the store, the door and the pending authorization are runtime, and `connector_package` is the column PR 3a added. -->

Part of #31699 (ADR-0150 child B, PR 3a-ii). PR 3a widened `sys_connector_connection`'s key to `(organization_id, connector_package, connector_name)`; this PR makes the store and its callers use it.

**The store: `ConnectorConnectionStore`.**

- `connect`, `read`, `readOrRefuse`, `revoke` and `listFor` take the instance's package (`string`: a package's instance; `null`: no package's). `revoke` and `listFor` require it; on `connect`, `read` and `readOrRefuse` an absent package still reads the bare name, for the callers that know no package. A connect writes `connector_package` on the row it inserts.
- While the name has one holder (its durable resolution, the question the boot backfill asks, disabled packages included, answers one), or no registry can judge it, every row of the name answers its instance, whatever package the row names: a row naming no package, and a row a moved declaration left under its old package, are the instance's connection, as the read by name answered. A connect adopts the row and stamps it with the instance's package in place (design M2; `null` for the environment's or the platform's instance): one row, never two. A revoke removes it. While two packages hold the name, each package reads its own row; a row naming no package, or naming a package that is not one of the holders, is no package's, and with no row of its own the package's read is refused `409` naming `os migrate stored-references bind --table sys_connector_connection`.
- Two rows answering one instance (a package's own row and another row of the name under one holder, or two rows a guard-less database admitted) are refused `409` by the door and `503` by a dispatch, with or without the run's organization, never one of them used; a revoke removes every row that answers. The connection list (`listFor`) still counts such an organization, carrying the refusal: a dispatch with no organization is refused `422` where another organization is connected too, as before, and the materializer does not count it as connected.
- The post-insert take-back that PR 3a added now counts by `(organization, package, name)`.

**The door and the callback.**

- The connect door resolves the name to one declared instance and its package: the resolved package's entry; with no registry to ask (a code-registered instance, a composition with no ObjectQL) or no holder, the one declared entry with the package it carries; two holders, or two declared entries with no registry, `409`.
- The begin records the package in the pending authorization (`packageId`, `null` for the environment's or the platform's instance). The callback completes exactly that package's entry, never the name resolved again; when that package no longer declares the instance, the callback is refused `404` before its code is exchanged. A pending record written before this change (no key, at most ten minutes old) resolves the name, as the begin did.
- An instance's package is its entry's stamp when that is a real package, none for the environment's stored entry, and, for an entry with no stamp or the compatibility API's default, the package the name's durable resolution holds it under (the package the boot backfill binds a package-less row of the name to, so a row the instance connected stays its own once bound), else none. The door, the dispatch handle, the materializer and the reconnect-required mark all read by that one rule. When the name resolves to a package no declared entry is the instance of, the door serves the one declared entry with its own package, as with no registry.

**What answers differently.**

- `409` at the door where a name has two holders, and where two declared entries share a name with no registry to resolve it; before, the first declared entry was served.
- `409` at the door, and `503` at a dispatch, where two rows answer one instance in one organization (above). Before, the old key kept one row per organization and name, so this needs a database where the guard was refused or a package's row beside an adopted package-less one; when the two rows are met only at the callback, the code has already been exchanged and the connect is refused after it.
- `409` on the read and the revoke of a row of a name two packages hold that names no package, or a package that is not one of the holders (a disabled holder counts: the question is the boot backfill's), where the read answered the row before. Bind it with `os migrate stored-references bind --table sys_connector_connection` and revoke it as its package's, or uninstall one of the holders, after which a revoke of the one remaining instance removes it.
- `404` at the callback when the package its connect recorded no longer declares the instance; before, any entry of the name completed it.

**Declared deviations from the design review.**

- M5: no `?package=` on the HTTP door and no spec change. The door addresses one instance by resolving its name; addressing a second holder's instance explicitly comes with the PR that narrows the one-holder backstop, which is the first PR under which two holders can boot, and no later. Until then a name with two holders (a package installed after boot) is refused at every leg of the door, revoke included: its connections stay stored and keep no dispatch, and the remedy is to uninstall one holder or bind the row.
- M6: where the name has no holder or no registry answers, the door serves the one declared entry with the package that entry carries, not `null`: the row a code-registered package instance connects is that package's, as the backfill would bind it. That stamp is durable while the judgment is not (a later registry may resolve the name elsewhere); it never loosens: while two packages hold the name, the stamped row answers only its own package.
- S3: under two holders a package's own row wins over a package-less row of the name, and the package-less row answers neither (ADR-0150 R9 refuses such a row; the store reads around it rather than refusing the package's own connection). The stray row keeps its encrypted refresh token until it is removed: the door is refused `409` at every leg while two packages hold the name (M5), so it is removed by uninstalling one of the holders, after which the name has one holder, every row of it answers that instance, and a revoke removes them all.

**In-process APIs.** None public: the store, the pending authorization and the grant handle are internal modules of `@objectstack/service-automation`, none exported from its entry point.
