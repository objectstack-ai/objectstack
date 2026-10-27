---
'@objectstack/service-messaging': patch
---

fix(service-messaging): the email and inbox channels grade a `TEMPLATE_INVALID` template failure permanent, like the other template failures

Clause-②: no
Metadata-protocol: none

`@objectstack/plugin-email`'s `sendTemplate` and `renderTemplate` now fail with `TEMPLATE_INVALID` for a stored template whose hole the mail grammar refuses (a second formatter, or a `currency` argument that is not a literal ISO 4217 code). Retrying cannot succeed until the template is republished, so `classifyError` on both channels grades it `permanent`, as it already grades `TEMPLATE_NOT_FOUND`, `TEMPLATE_INACTIVE`, `MISSING_VARIABLES` and `TEMPLATE_UNSUPPORTED`: the delivery goes dead at once with the code on its row, instead of spending the whole retry schedule first. Every other failure keeps its grade.
