---
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
---

feat: at boot, an administrator is told when a package upgrade renamed, removed or collided with an access item the customer switched off, cloned or authored

Clause-②: no (a boot report: it refuses nothing, writes no row, and adds no key, code or setting; the notification topic is a free-form string on the existing ingress)
Metadata-protocol: none

ADR-0126 §6 wall 3 says no upgrade un-makes a customer's choice. A switch-off, a clone or a sharing rule row is kept by name, so a vendor rename made a switched-off item active again under its new name, and nothing told anyone. At `kernel:bootstrapped`, beside the catalog reference report, `SecurityPlugin` now compares the customer's access state with the registry this boot registered. It covers sharing rules, permission sets, positions and capabilities, and lists:

- **Orphans:** activation-ledger rows (`position`, `permission`, `sharing_rule`) whose name the registry no longer resolves.
- **Suspected re-enablements:** a switched-off orphan whose recorded `package_id` is P, with every name of the same type P now ships that no ledger row covers. A permission-set candidate names the positions that bind it.
- **Sharing-rule collisions, per organization:** a `sys_sharing_rule` row holding a declared rule's name, so the declared rule is served nowhere in that scope. A position, permission-set or capability collision is already refused at registration or at boot.
- **Broken references in the customer's items:** a permission set authored in this system naming an object, field or capability the registry lacks, and a `sys_sharing_rule` row naming an object or criteria field the registry lacks.
- **Field denies a customer set lacks:** a package-shipped set that denies a field, beside a set authored in this system that grants the same object with no entry for that field. An unlisted field is visible.

The findings are logged once per category, as now. They are also raised through the existing notification ingress (`messaging.emit()`, topic `security.access_upgrade`, severity `warning`), which writes a Notification Events row in Setup and the in-app inbox:

- under `single`, to the Default Organization's `admin_full_access` holders and any `OS_PLATFORM_OWNER_EMAIL` address;
- under `group` or `isolated`, to the `OS_PLATFORM_OWNER_EMAIL` operator(s) only, because the ledger and the catalog are deployment-level.

The `dedupKey` is the finding set's digest, so an unchanged set notifies once, not at every boot. With no messaging service, or nobody to tell, one log line says the findings reached no administrator and names the fix. The notification is not mandatory: the ingress has no per-emit flag, so a recipient's mute hides it. To make it mute-proof, add `security.access_upgrade` to the messaging plugin's existing `mandatoryTopics` option.

Two limits follow from ADR-0126 §9, under which a clone records no base, and from the bare `(metadata_type, name)` ledger key:

- A re-enablement is **suspected** and may list several same-package candidates. Nothing records which name replaced which.
- The field-deny check reads "grants the same object", not "copied from that set", so it may name an unrelated set. It is a review item.

"The old name carrying a clone" is carried by the switch-off half. The sanctioned ceremony is clone plus switch-off, and a clone whose base stays on is not a choice a rename un-makes. A read that fails stops the report for that boot, and nothing is judged from an unread store.

- **`@objectstack/plugin-sharing`:** `SharingRuleService.listDeclaredRules()` answers every declared rule with its `packageId`, or `null` when the service reads no declarations.
