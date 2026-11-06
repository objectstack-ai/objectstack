---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-audit': patch
---

fix(plugin-auth,plugin-audit): a SCIM-driven write names the SCIM connection that performed it, on its audit row

Clause-②: yes (widening) — `authSystemWriteContext()`, published through `export * from './auth-actor-attribution.js'`, now declares an optional `actor` member on the context it returns; nothing it returned before is removed or narrowed.
Metadata-protocol: none

An identity provider's SCIM writes (the `sys_user` create, the deactivation's ban update, the delete, and the `sys_scim_*` rows written beside them) used to leave `sys_audit_log` rows with `actor`, `user_id` and `metadata` all null, so no row said which SCIM connection (which IdP) acted, and "who deactivated this account" had no answer.

- **`@objectstack/plugin-auth`.** The SCIM request scope `handleRequest` opens around every `/scim/v2/*` request now carries the connection the bearer verified as: the bearer verifier records it, and `authSystemWriteContext()` gives every write of that request `actor: 'svc:scim:CONNECTION_ID'` on `ExecutionContext.actor`, with no `attributedUserId`. The connection id is the label's identifier because it is immutable and keys every resource the connection provisions. Writes outside a SCIM request are unchanged.
- **`@objectstack/plugin-audit`.** The audit writer records that label on `sys_audit_log.actor`, as it records any service principal, and the connection id alone as `metadata.scim_connection_id`, read off the same label so the two never disagree. `user_id` stays null, because no human acted. Rows of every other actor are unchanged.
- **Never on a row:** the bearer, its digest and the credential row stay out of the write context, so none of them can reach `actor`, `metadata` or any other column.
