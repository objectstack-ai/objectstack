---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): switch a read-only package's flow off for this deployment, or clone it, from the Automations pillar

Clause-②: no
Metadata-protocol: none

An administrator who wanted a packaged flow off in their deployment, or a copy of it, had to leave Studio for Setup › Packaged automation. A read-only package's open flow in Studio's Automations pillar now offers both on the item (ADR-0146 D4). The header's switch is the activation-ledger switch: it reads the flag `GET /automation/_status` reports and flips it through `POST /automation/<name>/toggle`, at once, and reads "On for this deployment" / "Off for this deployment" with a power glyph. A writable package's flow keeps its definition switch ("Enabled" / "Disabled", applied on publish) and its Delete. The ⋯ menu offers Clone flow, `POST /automation/<name>/clone` with a new identifier and name; the result shows the server's notice verbatim, offers to switch the original off through the same toggle, and links to the copy where the door puts it today. Under a walled tenancy posture, a caller without the platform-operator rung gets both controls disabled with the console's own sentence, read from `features.tenancyPosture` and `user.isPlatformAdmin`; every server refusal is shown as sent. The toggle and clone requests moved out of Setup's Packaged automation page into a shared `packagedFlowLedger.ts`, so the two surfaces send one request each. The studio namespace gains a contiguous block of `engine.studio.auto.ledger.*` and `engine.studio.auto.clone.*` keys (en, zh).
