---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): `organizationDeleteGate`, a host check asked by the organization delete admission

Clause-②: yes (widening) — a new optional `AuthManagerOptions` / `AuthPluginOptions` member, `organizationDeleteGate`, and its two exported types, `OrganizationDeleteGateRequest` and `OrganizationDeleteGateRefusal`. Unset, every answer of `POST /organization/delete` is unchanged.
Metadata-protocol: none

A host that must refuse an organization delete for its own reasons (the cloud control plane: a subscription that will charge again, environments that remain) sets `organizationDeleteGate`. It is asked once per delete, from the delete admission in better-auth's `hooks.before`, with the `organizationId` better-auth parsed from the body (any content type), the caller (`userId`, `activeOrganizationId`, `impersonatedBy`) and the request's `Accept-Language`. It runs after the auth mount's gates (a request the IP allow-list refuses never reaches it) and after the platform's own refusals (`403 PERMISSION_DENIED` on the Default Organization's last administrator, `409 DELETE_RESTRICTED` while records remain, `503` on a failed read), and before better-auth's first write.

- Answering `undefined` or `null` lets the delete go ahead.
- A refusal (`{ status, body }`, `status` 400–499, `body.code` and `body.message` required) is answered unchanged, status and body, and nothing is deleted.
- Fail-closed: a check that throws, or answers anything else, is answered `503 SERVICE_UNAVAILABLE` naming the option, and nothing is deleted. The host's error text is not sent to the client.

The option is read per call, so a value an `auth:configure` handler sets is the one asked. A host that parsed the request body ahead of the auth mount to make this check can drop that reader and use the option.
