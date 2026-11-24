---
'@object-ui/i18n': patch
---

fix(i18n): a flow's node and screen step labels match the session's locale tag the way the flow label does

Clause-②: no
Metadata-protocol: none

The flow designer and the docs viewer's flow drawing read a node's translated label (`flows.FLOW.nodes.NODE_ID.label`) and an untitled screen's translated title (`flows.FLOW.screens.NODE_ID.title`) by the exact language key, so a `zh-cn` session missed a bundle keyed `zh-CN` and showed the authored text. They now pick the bundle row with the spec's `resolveBundleLocale`, the locale matching `translateFlow` and `resolveFlowApprovalStepLabel` already use for the flow label and an approval step's label. One locale, no fallback chain.
