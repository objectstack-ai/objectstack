---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): "New similar" on a flow in the Automations pillar, opening the copy where the clone door landed it

Clause-②: no
Metadata-protocol: none

An admin who wants a second flow like one a package ships, for another rule, gets it without changing the package's flow (ADR-0146 D4). The flow clone door lands the copy switched off in a writable package, by default the source's paired `<base>.custom`, so Studio can offer the gesture where the flow is designed.

- **New similar in the flow's menu.** The open flow's ⋯ menu offers "New similar" on a read-only package's flow and on a writable package's flow. It asks for a new machine name and a label, both mandatory, and posts them to `POST /api/v1/automation/:name/clone`. On a read-only base the request names no package, so the door picks the pair; on a writable package it names the open package.
- **The copy opens where the answer says.** The door's answer names the package the copy landed in. A copy in another package opens on that package's Automations pillar (`/studio/<package>/automations?surface=flow:<copy>`); a copy in the open package opens in place after the rail re-reads. Either way the server's sentence that the copy is switched off is shown as sent. An answer that names no package says so and opens nothing. Nothing records or draws what the copy was made from.
- **Refusals and gates.** A refusal, a `409` for a taken name included, is the server's sentence, shown in the dialog, which stays open. A caller without `manage_metadata` sees the item disabled with the console's sentence for why. A read-only package's flow still offers no Delete, and the package-less scope draws no menu.
