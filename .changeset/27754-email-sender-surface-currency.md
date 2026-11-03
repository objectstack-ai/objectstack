---
'@objectstack/service-messaging': patch
---

fix(service-messaging): `EmailSenderSurface.sendTemplate` and `renderTemplate` declare the optional `currency` the email and inbox channels already send

Clause-②: yes (widening)
Metadata-protocol: none

- **Before.** Both channels passed the organization's default currency to the email service's template render (#26939), and the trial render that grades a refusal after a failed currency read passed `XXX` (#27257), but the published `EmailSenderSurface` (re-exported from the package entry) named no `currency` on either input. The key reached the call only through an object spread, which TypeScript does not check against the target type, so a typed implementer of the surface was never told the key is sent and a rename on either side compiled.
- **Now.** Both input types declare `currency?: string`, mirroring `RenderTemplateInput.currency`. The channels build the input by name and set `currency` with a plain assignment, and the trial render writes `currency: probe` as a plain property, so TypeScript checks the key on every call.
- **Unchanged.** No default currency still sends no `currency` key; a default is still passed as is; the trial render still passes `XXX`. No delivery, grade or error text changes.
