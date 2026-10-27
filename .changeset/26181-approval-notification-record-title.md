---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an approval notification names the record by its title, as the recipient may read it

Every approval notification body named its record by the object's label and the record id (`Your Contract C8Mp7TjRYta8mOWx was approved.`), so a recipient could not tell which record it was without opening it. Each notification is delivered to one named recipient, so it now names the record by its display title (ADR-0079 `nameField`) as that recipient may read it: the inbox's own rule (the record read under the system context, the title picked from it as served to the reader, narrowed by field-level security), asked as the recipient, whose envelope is resolved through `resolveUserAuthzGrants` in the request's organization. It falls back to the record id when the title is empty, when the recipient may not read the title field or is served it masked, and when anything on the way fails. A notification that names one record to several recipients goes out once per name they read, so no recipient is handed another recipient's title. The message templates keep their `{{object}} {{record}}` shape. The token-bearing one-tap action pages keep naming the record by its id: they have no reader to narrow for.

Clause-②: no
Metadata-protocol: none
