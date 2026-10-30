---
'@objectstack/runtime': patch
---

fix(runtime): the flow clone notice is one line in business words

Clause-②: no
Metadata-protocol: none

The notice returned by `POST /api/v1/automation/:name/clone` (`FLOW_CLONE_NOTICE`) was seven sentences that named `status draft`, lifecycle labels, the Packaged automation switch and the Studio Enabled switch. The console shows it verbatim beside a "Switch the original off" button, so most of it repeated the screen. It now reads: "The copy runs alongside the original until you switch one of them off, and it still uses the same subflows, actions and objects as the original." The detail (`draft` is not an off-switch, references are not re-pointed, where each switch lives) stays in the constant's TSDoc; the REST recipe stays in the client SDK's `automation.toggle` TSDoc.
