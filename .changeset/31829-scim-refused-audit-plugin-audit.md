---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): `scim_refused` rows in `sys_audit_log`, one per refused SCIM request

Clause-②: yes (widening)
Metadata-protocol: none

`sys_audit_log.action` gains `scim_refused` (label "SCIM Refused"), added with its writer: `createScimRefusalAuditWriter`, registered on the `audit` service slot as `recordScimRefusal` beside `recordAuthEvent`. plugin-auth's SCIM door calls it for each `/scim/v2/*` request it answered 400 or above, after its per-connection bound.

The row names the connection the way an accepted SCIM write's row does: `actor` is `svc:scim:CONNECTION_ID` and `metadata.scim_connection_id` the id, or `actor` null and `scim_connection_id: 'unknown'` (plus `metadata.presented_credential`) when the bearer verified as no connection. `metadata` also carries `resource`, `method`, `status`, `scim_type` or `error_code`, and `suppressed` when refusals of that connection were dropped since its last row; `ip_address` carries the client address. `tenant_id` is the organization the connection's credential belongs to, so an organization's administrators read their own connection's refusals; it is null (a deployment-level row) when the bearer verified as no connection or the credential names no organization. `user_id`, `object_name` and `record_id` are null: no human acted and the request was refused. The request body, the bearer, its digest, attribute values and the error's `detail` text are never written, and every field is re-checked against a bounded token shape before it reaches the row. A failed write is reported at `error` once per cause and never reaches the SCIM answer.

The rows are listed by the unfiltered `recent` and `all_events` views and can be selected with `action = 'scim_refused'`; the `auth_events` view, which lists sign-ins by user, does not list them.

New exports: `createScimRefusalAuditWriter`, `buildScimRefusalAuditRow`, `SCIM_REFUSED_AUDIT_ACTION`, `UNKNOWN_SCIM_CONNECTION`, and the types `ScimRefusalAuditEvent`, `ScimRefusalAuditWriter`, `ScimRefusalAuditWriterOptions`, `ScimPresentedCredential`.
