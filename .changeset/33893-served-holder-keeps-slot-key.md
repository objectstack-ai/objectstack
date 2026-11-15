---
'@objectstack/service-automation': patch
---

fix(service-automation): the served holder of a flow name a disabled package also ships keeps its slot key and its trigger

Clause-②: no
Metadata-protocol: none

When two packages ship a flow of the same name and one of them is disabled, the engine holds the served package's flow in its own slot, filed under `PACKAGE/NAME`. Two paths lost that slot's trigger:

- At boot, with one holder disabled, only the served holder's flow is pulled. Its slot was filed under the bare name and declined as if the other package's body had been refused, so its trigger never ran, behind a warning that named a refused body.
- At runtime, the re-sync that follows a disable withdraws the disabled holder's slot. The served slot was moved to the bare name and its trigger binding was stopped, and not armed again.

Now a disable moves no key: in both cases the served holder's slot stays under `PACKAGE/NAME`, armed, and runs on its trigger; the bare name reaches it as the name's one served holder. When the other package is enabled again, its re-sync registers both packages' flows, in either order, and both slots end armed on their triggers. The warning about a refused body is said only once another package's body of the name is recorded as refused. When the other package is uninstalled, the name goes back to its bare key, as before. Before its slot is withdrawn, that happens at the withdrawal. After the withdrawal, it happens the first time the engine registers the served holder's flow again, fires its trigger or is asked for the name. Every bare entry (`execute`, `getFlow`, removal, version history, rollback, the bare inbound hook, credentials) then serves the name as one package's, and a re-sync that fails leaves no flow unreachable.
