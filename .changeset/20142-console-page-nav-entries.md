---
'@objectstack/platform-objects': patch
'@objectstack/plugin-audit': patch
---

fix(platform-objects,plugin-audit): Setup and Studio navigation entries for the console's Audit Log and Integrations & APIs pages (#20142)

The console retired its System Hub card wall and its Developer Hub, which had been the only in-app links to several pages, and registered each page under a component-registry key instead. Framework navigation reaches a console page only through a `type: 'component'` item that names such a key, and no item named them, so each page was reachable only by a typed URL. Two entries now name the pages whose capability ships in the open framework:

| Entry | App / group | `componentRef` | Contributed by | Gate |
| --- | --- | --- | --- | --- |
| `nav_audit_log_browser` ("Audit Log Browser") | Setup / Diagnostics, directly under Audit Logs | `audit:log` | `@objectstack/plugin-audit` | none: it lives and dies with the plugin that owns `sys_audit_log` |
| `nav_integrations` ("Integrations & APIs") | Studio / Developer, after Public Forms | `developer:integrations` | `@objectstack/platform-objects` | none beyond Studio's own `studio.access` |

**Two audit entries, on purpose.** The existing Audit Logs entry (the `sys_audit_log` object view) stays. It carries the named list views, search, and the actor and tenant rendered as resolved lookups. The new page adds one filterable table whose detail drawer pretty-prints a change's before and after JSON, where the record page shows `old_value` / `new_value` as raw text. Neither surface replaces the other.

**No entry for the console's AI Approvals page (`ai:approvals`) here.** Under ADR-0029 D7, each capability plugin contributes its own navigation entries into a Setup slot, and the Setup shell does not enumerate capability objects. The AI pending-action queue belongs to the AI capability, whose provider (`@objectstack/service-ai`) ships in Cloud/Enterprise, not in the open framework. Its entry is therefore that capability's to contribute.

The keys are the ones the console registers at the objectui commit this release's console is built from. Labels ship in all four locales (en, zh-CN, ja-JP, es-ES), with their source hashes recorded. Nothing is removed or renamed, and there is nothing to migrate.
