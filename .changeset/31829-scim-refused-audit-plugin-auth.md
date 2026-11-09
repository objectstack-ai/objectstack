---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a SCIM request the door refuses is handed to the `audit` slot as a bounded `scim_refused` event

Clause-②: yes (widening)
Metadata-protocol: none

A `/scim/v2/*` request answered 400 or above (a bearer that verifies as no connection, a duplicate create, a malformed PATCH, an unknown user) used to leave no trace anywhere, so a SCIM console or a SIEM feed could not show a connection's errors. `handleRequest` now observes the answer in its SCIM arm and hands the `audit` service slot's new optional `recordScimRefusal` member one event per refusal, after the response: the connection the bearer verified as and the organization its credential belongs to (or, when it verified as none, which kind of credential was presented: `scim_bearer`, `other` or `none`), the resource type and method, the status, the SCIM `scimType` or machine `code` the answer carried, and the client address. Never the request body, the bearer or any part of it, its digest, an attribute value, the resource id or the error's `detail` text.

The events are bounded per process: at most 20 per connection (or, for a bearer that verified as no connection, per client address) in a 10-minute window, and at most 1000 per window across all keys, with one `warn` line when that cap drops one. Every dropped refusal is counted, and the next event for the same key carries the count as `suppressed`.

`AuthEventAuditSurface` (the locally declared shape of the `audit` slot) gains the optional `recordScimRefusal` member and the `ScimRefusalAuditEventInput` type. An `audit` service without the member, or no `audit` service at all, writes nothing, and the SCIM answer is the same either way. Some refusals are answered before the bearer is verified, so their event names no connection, as a 401's does.

The bearer verifier now hands back the credential row's `organization_id` on the verification's `connection` (`organizationId`, read in the probe it already makes; the vendor copies only `id` and `provisioningDomainId`), and `recordScimRequestConnection` keeps it on the request scope (`ScimRequestScope.organizationId`) beside the connection id, under the same first-verified-wins rule.
