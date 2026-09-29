---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
---

fix(plugin-security): `security/explain` answers enforcement's refusal at the object level too, and explains another user in the organization they are resolved in (#20604)

Clause-②: no

Two answers of `POST /api/v1/security/explain` disagreed with what the same principal's own request gets from enforcement.

**A row-level policy that compares two fields of no shared comparison class** (text against a number, or any field against a file field, a formula field, or a field that holds a list or an object). The SQL driver refuses to compile such a read, so the find answers `INVALID_FILTER` / 400. A by-id update or delete fails closed at its row-level gate, and an insert whose check judges the policy is refused with `INVALID_FILTER` / 400. An object-level explanation (no `recordId`) still answered `allowed: true`, the `rls` layer `narrows`, and the predicate as `readFilter`, for every operation. A `recordId` that no row carries was answered `visible: false` with no deciding layer. Both are now refused with the envelope a record-grained explanation already gives: `INVALID_FILTER` / 400, with the message that names the policy and both fields. A request that the capability gate or the CRUD grant denies is still explained as denied there.

**Another user explained by an administrator.** The explanation now carries the organization the user is resolved in, as enforcement's context for that user does. Before, a current member of the administrator's organization was explained with no organization. Under `isolated`, that member was reported denied on a tenant object their own find reads. Under every posture, a permission set that their organization authored (a `sys_permission_set` row scoped to that organization) was missing from the explanation and from the verdicts it decides.

`@objectstack/core`: the API-key arm of `resolveAuthzContext` asks `vetOrganizationClaim` for its membership rule, as the session arm does. This is a refactor with no behaviour change. A key whose owner is no longer a member of its organization is still refused.

Unchanged:

- Enforcement admits and refuses exactly what it did before.
- A comparison between two fields of one class keeps its verdicts, at the object level and per record.
- Explaining yourself.
- A removed member's explanation (no organization, as enforcement resolves them).
