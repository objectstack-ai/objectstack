---
'@objectstack/cloud-connection': patch
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat(cloud-connection, plugin-security, spec, cli): a marketplace upgrade that would un-make an access choice is refused until it is confirmed (ADR-0126 §6 wall 3)

Clause-②: yes (narrowing): a marketplace re-install that installed before is now refused `409` while it would un-make an access choice made in this system, until the same call confirms it (narrowing); the door gains the `confirmAccessUpgrade` body field and the `ACCESS_UPGRADE_CONFIRMATION_REQUIRED` code, plugin-security gains the `security.accessUpgradeCheck` service and its exports, and the CLI gains `--confirm-access-upgrade <token>` (widening).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What narrows is one install door's answer on an upgrade that would un-make an access choice; the caller's migration is the confirmation the refusal itself names (`confirmAccessUpgrade` with the finding set's token), stated below. -->

**BREAKING** — `POST /api/v1/marketplace/install-local` stops an upgrade it used to run. A managed re-install over an installed package now asks the security plugin what replacing that package with the incoming version would un-make, and refuses when the answer is not empty.

- **What it compares.** The boot report's comparison (`collectAccessUpgradeFindings`, unchanged) runs twice: over the registry as it stands, and over the registry with the package's permission sets, positions, capabilities, declared sharing rules, objects and fields taken from the incoming manifest. The door refuses on what the second run finds that the first does not, so a finding that predates the upgrade, or that another package caused, never blocks it; the boot report keeps raising those.
- **What it refuses on.** A switch-off whose name the upgrade drops while it ships a new name of the same type (a suspected re-enablement, naming the positions that bind a renamed permission set), a switch whose name it drops, a declared sharing rule whose name a rule authored in this system holds, an object, field or capability a permission set or sharing rule authored in this system names and the upgrade drops, and a field deny the upgraded set gains that a permission set authored in this system granting the object lacks. A clone records no base (ADR-0126 §9), so "the old name carrying a clone" is carried by the switch-off half: the sanctioned ceremony is clone plus switch-off.
- **The refusal.** `409 ACCESS_UPGRADE_CONFIRMATION_REQUIRED`, before any write. `error.details.findings` names each finding with a one-line `describe`; `error.details.findingSet` is the finding set's token; `error.details.confirmWith` is the retry.
- **The confirmation.** FROM a re-install that ran on any answer TO the same request carrying `"confirmAccessUpgrade": "<findingSet>"` (CLI: `os package install <package> --confirm-access-upgrade <findingSet>`). The token confirms exactly the findings it names: when they change, it no longer matches and the call is refused again with the fresh set. A bare `true` confirms nothing. A confirmed install records `accessUpgradeConfirmation` (the token, who, when) in its ledger entry; the next boot's report still raises whatever stands.
- **Who sees it.** Under `group` and `isolated` the platform operator alone reaches the check: the walled-catalog refusal answers a tenant administrator `403` first, and shows no finding. Under `single`, the administrator (`manage_metadata`).
- **Fail closed.** A check that could not read the activation ledger, the security catalog or the declared sharing rules answers `503 SERVICE_UNAVAILABLE` and writes nothing: a comparison that did not run is never "no finding". A composition without the security plugin does not check the re-install against the access choices it could un-make; the upgrade proceeds and one `warn` line says no check ran.
- **Unchanged.** A fresh install is never checked. An upgrade with no finding installs exactly as before.

The error-code ledger registers `ACCESS_UPGRADE_CONFIRMATION_REQUIRED` under `@objectstack/cloud-connection`. `@objectstack/plugin-security` exports `ACCESS_UPGRADE_CHECK_SERVICE`, `createAccessUpgradeCheck` and `accessUpgradeDelta`, and `SecurityPlugin` registers the check under `security.accessUpgradeCheck`.
