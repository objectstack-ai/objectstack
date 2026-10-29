---
'@objectstack/objectql': patch
---

fix(objectql): an artifact hot reload refreshes every registry entry the boot registered, so an edited email template is what the next send renders

Clause-②: no
Metadata-protocol: none

On the dev loop (`os dev`, artifact watcher on), editing a declared item and letting the artifact reload used to refresh only the by-name read. The list read (`GET /api/v1/meta/<type>`) and its execution face (`getMetaItemsForExecution`) kept the boot copy until a cold restart, because the `metadata:reloaded` hook re-ingested objects alone and those reads lay the SchemaRegistry over the metadata service. The execution face is what the email plugin renders a send from and what the automation engine re-binds flows from on the same reload, so recipients kept getting the old wording and an edited flow kept its old body.

Now the hook re-registers each reloaded package body the registry already holds, through `registerApp` (the door the boot registered it through), under the source it was installed with. Every collection that door decomposes (email templates, flows, views, dashboards, pages, actions and the rest) holds the reloaded item, and the package's lifecycle is kept: a disabled package stays disabled. A package the boot never registered into the registry is left to the artifact door, as before. Items removed from the artifact stay registered until restart, as objects already do. A package that fails to re-register is named in a `warn` line and keeps serving what it served before.

Cold boots and `PUT /api/v1/meta` saves are unchanged.
