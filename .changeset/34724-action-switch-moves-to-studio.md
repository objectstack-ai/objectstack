---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/core': patch
'@objectstack/platform-objects': patch
'@objectstack/types': patch
'@objectstack/objectql': patch
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

feat(studio): an installed app's action is switched on or off on the action itself, in Studio; Setup › Packaged Actions retires (ADR-0146 D4, amended 2026-11-17)

Clause-②: yes (narrowing: the Setup `nav_packaged_actions` entry, its `automation:packaged-actions` page and the public `PackagedActionsPage` export of `@object-ui/app-shell` retire; widening: new studio-namespace locale keys)
Metadata-protocol: none (no spec schema changes; `platform-objects` serves one fewer Setup navigation item, and one `.describe()` sentence changes)

Before this change, the deployment's on/off switch for an installed app's actions lived on a separate Setup page, "Packaged Actions", away from where the action is read. It now sits on the action:

- On the object's Actions view in Studio, a read-only app package's vendor action carries a "Switched on / off for this deployment" switch, the flow switch's twin. A switched-off action is marked in the list. A refusal is the server's sentence, shown verbatim; a caller the deployment's posture walls off sees the switch disabled with the reason.
- A standalone `action` item's page in Studio's "All metadata" area carries the same switch.
- The platform's own actions (any action a kernel package ships) carry no switch anywhere. When the package list cannot be read, no switch is offered.

The doors are unchanged: the read is the `sys_metadata_activation` ledger, the write is `POST /api/v1/actions/_activation/:object/:action` with body `{ enabled }`.

Setup › Packaged Actions is removed in the same change. A bookmark of `/apps/setup/component/automation/packaged-actions` redirects to Studio (to the package's Data pillar when the URL names `?package=`). The runtime's "turned off" sentence for a dispatched app action now points at the action in Studio, and the `disabledActions` description in `@objectstack/spec` says the same; no schema shape changes.

**Platform actions already switched off.** The retired page also listed the platform's own actions (those a kernel package ships, such as `sys_user`'s Ban User), so a deployment may hold ledger rows that switch one off. Those rows stay in force: no boot or upgrade step turns them back on, and the activation door is unchanged. Because Studio has no switch for them, the `409 ACTION_DISABLED` sentence for a platform action now names the activation door instead of Studio. To find them on a deployment, as a platform operator:

1. `GET /api/v1/data/sys_metadata_activation?top=1000` and keep the rows with `metadata_type: "action"` and `active: false`. If the response says `hasMore: true`, the list is incomplete; page through it before concluding.
2. `GET /api/v1/packages`: a row whose `package_id` belongs to a package with `manifest.scope` `system` or `cloud` is a switched-off platform action.

To turn one on again: `POST /api/v1/actions/_activation/<object>/<action>` with body `{"enabled": true}` (use `global` as `<object>` for an action that belongs to no object). The `packagedAutomation.*` console locale keys the page read are no longer read and are left in place for a later sweep.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what retires is a Setup navigation entry, its console page and the PackagedActionsPage export of the private @object-ui/app-shell package. Ledger rows, the activation door and authored metadata are unchanged, so there is nothing for objectstack migrate meta to rewrite. -->
