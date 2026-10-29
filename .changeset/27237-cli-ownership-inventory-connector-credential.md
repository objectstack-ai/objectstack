---
'@objectstack/cli': patch
---

fix(cli): the organization-ownership inventory has a row for `sys_connector_credential`

Clause-②: no
Metadata-protocol: none

The ADR-0131 D10 inventory now has a row for the new environment-level connector credential store (`systemFields.tenant: false`). Its fate is `column-drop`, the same fate the flow credential store has: the upgrade plan treats the table as deployment-level state with no organization column, so a database carrying it is not refused as an uninventoried platform table.
