---
'@objectstack/service-automation': patch
---

docs(service-automation): the `http` node's comments say that the outbox sends a GET or HEAD with no body

Clause-②: no
Metadata-protocol: none

Comments only, no behaviour change. Two comments in the `http` node executor said the messaging HTTP outbox sends and signs `'{}'` for a node with no `body`. They now name the exception: a GET or HEAD goes out with no body and is signed over `''`. The published source maps shift by the added comment lines.
