---
'@objectstack/plugin-security': patch
---

feat: a boot upgrade impact report for the non-access classes (flows, actions, webhooks, overlays, object extensions, navigation contributions, settings), raised to the administrator like the access upgrade report

Clause-②: yes (widening: a new boot report and a new notification topic, `system.upgrade_impact`; nothing is written or refused, and no existing path changes)
Metadata-protocol: none

A package upgrade that renames, removes or collides with a name could leave the customer's stored state meaning something else, with nothing said beyond a scattered log line. At every boot, beside the access upgrade report, the security plugin now reads that state against the registry and lists:

- **Flow, action and webhook switches:** an activation ledger row whose name no package ships any more, and a switched-off one whose package now ships unswitched names of the same type (a suspected rename that makes the item active again). Also a switched-off action whose name more than one object now declares, because the one row switches every one of them off.
- **Stored rows a package now overrides:** a stored flow whose name a package ships (the packaged flow runs, the stored one never does), and a `sys_webhook` row holding the name of a webhook a package declares (the declaration is withheld for the whole deployment).
- **Overlay orphans:** a customization of a view, dashboard, report, translation or email template bound to an installed package that no longer ships the item. It keeps serving as an item of its own.
- **Object extensions:** a field an extension declares that the object it extends (or another package's extension) also declares, where the last declaration silently wins. Also a stored object row bound to a package that does not own the object, because another package now ships the name, which the boot refuses to serve. And a navigation contribution whose group its app no longer has.
- **Settings:** a stored value whose namespace no longer declares its key. The value is never read, and the default applies. The report never reads a value.

Each category logs one `error` with its fix. The finding set is raised through the same delivery as the access report, under its own topic and `dedupKey`. Under `single` it goes to the Default Organization's administrators. Under a wall it goes to the operator alone, and in-app in the organization `OS_PLATFORM_OWNER_ORGANIZATION` names when that is set. A clean boot logs one `info` line. A store that cannot be read stops the report for that boot, and it says so.
