---
'@objectstack/scenarios': patch
---

fix(scenarios): each card persona's role states the writes its build prompt did not

Clause-②: no
Metadata-protocol: none

The open card library (shipped in `dist/library`) gives thirteen personas a role that names the objects and verbs of the writes the card has them make or refuses them, where the card's build prompt did not state them: crm `sdr` and `partner_user`, invoice `sales_rep` and `warehouse_staff`, project `contractor` and `client_viewer`, leave `hr_officer` and `employee`, service desk `support_agent` and `team_lead`, asset `asset_admin` and `employee`, and travel `employee`. A build is judged on its permission sets against those writes (`persona-grant:*`), so the prompt now asks for each. The role also reads in each persona's run prompt ("You act for …"). No other card text changes.
