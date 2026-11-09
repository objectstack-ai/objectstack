---
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-email': patch
'@objectstack/platform-objects': patch
'@objectstack/trigger-schedule': patch
---

feat(service-automation, plugin-approvals, plugin-email, trigger-schedule): automation stored references gain a package column, and a scheduled flow's dispatch key names its flow's package (ADR-0150 D8 R7–R11, R20)

Clause-②: no
Metadata-protocol: none

Five stored references that name a flow, a connector instance or an email template by its bare name now carry, beside the name, the package that holds it: `sys_approval_request.process_package` on open requests (R7: `pending` and `returned`), `sys_automation_run.flow_package` on paused runs (R8), `sys_flow_credential.flow_package` (R9), `sys_connector_connection.connector_package` (R11) and `sys_email_template.package_id` on legacy template rows (R20). Each is nullable, read-only to users, and filled in by the platform.

At every boot, once the registry has sealed its holders, each table's rows that name no package are walked and asked the one ADR-0150 D3 rule with no caller package: the item's one holder in this environment. An environment override of a package's flow is that package's flow overlaid, so its runs and requests bind to that package. A name only the email service's built-in templates hold binds to `com.objectstack.service.email`. A name two or more packages hold is left null and logged as a warning naming every candidate; it is never bound to the first. A name only the environment or the platform holds, or that nothing holds, is left null and reported. A row that already names a package is never read again, so a second boot writes nothing.

The once-per-window dispatch key in `sys_flow_dispatch` (R10) now names the flow's package: `schedule:PACKAGE:FLOW:WINDOW` and `time-relative:PACKAGE:FLOW:SCOPE:RECORD`. A flow the environment holds, or nothing holds, keeps the old shape. At boot, keys claimed inside the ledger's 30-day retention gain a copy under the new key with the same claim time and outcome, and the old rows stay until the retention reaper removes them. The ledger holds every claim, settle and read until that copy has run, for at most two minutes, so a trigger's first claim after the upgrade sees the window as claimed. A claim also inserts the window's old key first, and the scoped key second: whoever inserts the old key wins the window, so during a rolling upgrade a node of an older release, which claims only the old key, and a node of this release share one arbiter in either order, and the old key settles beside the new one. A replay check and a missed-run check also read a claim under the old key as the window's claim. So no window fires twice across the change. The one case that claims no old key is a flow two packages hold: its old key would be one row for both, so each package claims only its own key. That case is unreachable while a second package's same-named flow is refused at registration.

Nothing else reads the new columns yet, writers do not stamp them, and no other unique key changes. If a boot pass fails, it logs a warning, leaves its rows as they are and is tried again at the next boot.
