---
'@objectstack/skills': patch
---

docs(skills): the authoring skills teach one naming rule, every metadata name a package authors starts with its namespace

Clause-②: no
Metadata-protocol: none

- **Before.** `objectstack-platform` stated the prefix rule for objects only, and claimed `os lint` warns on bare app, page, dashboard, flow, action, report and dataset names whenever a namespace is set. The examples across the skills named flows, actions, hooks, pages, dashboards, reports, datasets, queues, positions, permission sets, assignment rules, agents and skills bare (`lead_conversion`, `sales_rep`, `support_intake`).
- **Now.** `objectstack-platform` states the rule once, beside the object rule: every metadata name a package authors starts with its namespace (`crm_send_email`, `crm_sales_rep`). The exceptions are fields, object extensions, container views and translations (`<ns>_<locale>`). It also says what is enforced today: `defineStack` refuses a bare object name, `os build` refuses a bare doc name, and `os lint`'s `naming/namespace-prefix` warns only on a name one package declares twice. Every example and eval that showed or generated a bare non-object name now carries `crm_` (or its package's namespace where the snippet has one), cross-references included.
- Connector ids, the inbound api flow whose name is part of its webhook URL, and the datasource whose name keys its password variable keep their names. No schema, key or behaviour changes.
