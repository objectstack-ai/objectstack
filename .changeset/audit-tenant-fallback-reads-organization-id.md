---
"@objectstack/plugin-audit": patch
---

fix(audit): the NULL-tenant guard on audit rows reads the session key the engine actually emits (#9516)

`writeAudit`'s organization fallback read `sess.tenantId`. That key does not
exist on the hook session: `ObjectQL.buildSession` constructs it as an object
literal with a fixed key set (`userId`, `organizationId`, `positions`,
`accessToken`, plus conditional flags) and no spread, and the deprecated
`session.tenantId` alias (#3280) was removed repo-wide in the v11 major
(#3290). The arm therefore resolved to `undefined`, which made the guard it
belongs to unable to fire.

That guard is load-bearing. Its own comment states the consequence: an audit
row must never be written with `organization_id = NULL`, or the SecurityPlugin's
RLS predicate hides it from everyone forever while the write reports success.
The two cases the fallback covers are exactly the ones where the record cannot
supply an organization — an object with no organization column at all
(single-tenant stacks, ADR-0066 platform-global objects) and a row whose
organization column is NULL or empty. On both, the row was stamped
`organization_id: null` and became permanently invisible in the audit log UI.
Nothing reported it: every `sys_audit_log` field is `readonly: true` so
`validateRecord` skips it, and the write path is wrapped in swallow-and-report.

Both readers of the removed alias in this package now read
`sess.organizationId`. Precedence is unchanged at both sites: the audited
record's own organization still wins over the acting session (#8707, honouring
the ruling on #8287), and the `@mention` notification scope stays session-first
— #8707's reasoning is about an audit row read through the record's tenant
wall, which a notification is not, so only the key changed there.

Deployments on a single-tenant stack, and any multi-tenant deployment auditing
a platform-global object or a row with an empty organization column, stop
accumulating audit rows that no one can read. Rows already written with a NULL
organization are not repaired by this change.
