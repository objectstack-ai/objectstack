---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): switch a read-only package's flow off for this deployment from the Automations pillar

Clause-②: yes (widening)
Metadata-protocol: none

An administrator who wanted a packaged flow off in their deployment had to leave Studio for Setup › Packaged automation, and the open flow's header showed a locked switch that read the flow's definition beside a status that read the deployment's activation ledger, so the two could disagree. A read-only package's open flow in Studio's Automations pillar now carries the activation-ledger switch on the item (ADR-0146 D4): it reads the flag `GET /automation/_status` reports and flips it through `POST /automation/<name>/toggle`, at once, with Setup's three readings: "On for this deployment", "On for this deployment, not running here" (muted, with the platform's reason as sent) and "Off for this deployment". A writable package's flow keeps its definition switch ("Enabled" / "Disabled", applied on publish) and its Delete. Under a walled tenancy posture, a caller without the platform-operator rung gets the switch disabled with the console's own sentence, read from `features.tenancyPosture` and `user.isPlatformAdmin`; a server refusal is shown as sent. The toggle request moved out of Setup's Packaged automation page into a shared `packagedFlowLedger.ts`, so the two surfaces send one request. The studio namespace gains a contiguous block of `engine.studio.auto.ledger.*` keys (en, zh).
