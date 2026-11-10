---
'@objectstack/service-automation': patch
---

fix(service-automation): a failed `http` node names the target host and the underlying cause

A flow's `http` node that could not reach its target used to record only `http: fetch failed`, which hides whether DNS, a refused connection, a proxy or TLS failed. The step error now reads like `http: fetch failed — api.partner.test: ENOTFOUND getaddrinfo ENOTFOUND api.partner.test`: the host (never the path, query string or userinfo, which can carry a secret) and the cause code and message, capped at 200 characters. A url that carries a password no longer echoes it in the error. A timeout still reads `http: timeout after Nms`, and an HTTP error status still reads `HTTP <status>`.

Clause-②: no
Metadata-protocol: none
