---
'@objectstack/plugin-email': patch
---

fix(plugin-email): the Send test email refusals name what the admin does on the page instead of a REST recipe (#25424)

Clause-②: no
Metadata-protocol: none

When **Send test email** (`mail/test`) could not go to the signed-in admin's own address, its refusal said to pass "to" in the request body. The mail settings page has no recipient field, so that advice could not be followed from it. Each refusal now says that nothing was sent and what the admin can do on the page: press Send test email signed in as an admin whose account has an email address, or press it again once the account can be read. A `to` in the request still wins, as before. It is now documented only in the handler's TSDoc, for API callers.

No route, response shape, status or code changes: only the message text does. A caller that compared these strings verbatim must update its copy.
