---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a packaged position's refusal names its activation switch

Saving over a position a managed package ships is still refused `403 NOT_OVERRIDABLE`. What changes is the remedy the refusal names. It used to read the generic managed seal, "Edit the source artifact and redeploy". It now names the switch that exists for a position:

> Switch it off (POST /api/v1/security/_activation/position/:name, body {enabled: false}; operator-only where one install serves several organizations).

The audience anchors `everyone` and `guest` keep the generic sentence, because the activation route refuses them. The refused writes, the error code and the status are unchanged. A position has no clone door, so none is named. Removing a position's overlay is still not refused (a position merges its overlay at read).
