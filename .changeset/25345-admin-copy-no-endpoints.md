---
'@objectstack/service-sms': patch
'@objectstack/runtime': patch
---

fix(service-sms, runtime): the Send test SMS refusals and the flow clone notice name the admin's controls instead of a REST recipe (#25345)

Clause-②: no
Metadata-protocol: none

Two pieces of copy the console shows an admin told them to call the REST API.

- **Send test SMS** (`sms/test`): when the test could not go to the signed-in admin's own number, the refusal said to pass "to" in the request body. The settings page has no recipient field, so that advice could not be followed from it. Each refusal now says that nothing was sent and what the admin can do on the page: press Send test SMS signed in as an admin whose account has a phone number, or retry once the account can be read. A `to` in the request still wins, as before. It is now documented only in the handler's TSDoc, for API callers.
- **Flow clone notice** (`FLOW_CLONE_NOTICE`, returned by `POST /api/v1/automation/:name/clone`): the notice told the admin to `PUT` the clone's complete definition with `status: 'obsolete'`, and named the toggle endpoint. It now names the two switches the console has. A packaged original is switched off with its Switch "…" off action on the Packaged automation page, and that switch does not reach the clone. The clone is switched off in Studio, with its Enabled switch and a publish. The REST recipe stays in the client SDK's `automation.toggle` TSDoc.

No route, response shape, status or code changes: only the message text does. A caller that compared either string verbatim must update its copy.
