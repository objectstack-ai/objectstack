---
"@objectstack/plugin-security": patch
---

fix(plugin-security): the tenant wall no longer scopes a federated object by a column it does not have (#7835)

A **federated** object (ADR-0015 — `external`, bound to a remote table) is
registered like any other, which means the ObjectQL registry injects the
platform's system anchors into it: `organization_id`, `owner_id`,
`owning_business_unit_id` and the audit `*_by` lookups. But the platform issues
no DDL for a federated object — `Engine.syncObjectSchema` returns early, because
the remote schema is owned externally. Those columns therefore exist in the
registered schema and **in no backing store**.

Layer 0 (the tenant wall, ADR-0095 D1) decides "is this a tenant object?" by
asking whether the object carries `organization_id`, so it was answered yes about
a phantom and AND-composed `organization_id = <active org>` onto every federated
read under a walled (`isolated` / `group`) posture. Measured on the shipped
showcase: the composed read filter for `showcase_ext_customer` was
`{ organization_id: 'org_alpha' }`, and `GET /data/showcase_ext_customer`
answered **HTTP 200 with zero rows**.

The symptom is dialect-dependent and the defect is not. On SQLite an identifier
that resolves to no column is reinterpreted as a string literal, so the
comparison is constant-false: no error, no rows, a success status. Postgres and
MySQL raise `column "organization_id" does not exist` instead. Either way the
wall isolates nothing while the federated catalog stops answering the moment a
deployment turns the organization wall on.

Layer 0 now discounts an `organization_id` that is the **platform's injected
anchor** on a federated object, so it contributes no predicate there. What is
unchanged:

- **Local objects.** The platform provisions their `organization_id`, so the
  anchor is real and the wall is untouched.
- **A federated object that DECLARES a real remote `organization_id`.** The test
  is provenance — identity against the shipped column definition the registry
  spreads — not "is this object federated", so an author who exposes a genuine
  remote tenant column keeps their wall. Any inexact match is read as "not the
  platform's anchor" and leaves the wall in place: the fail direction is toward
  isolation.
- **Layer 1 (business RLS).** App-authored policies still reach the compiler
  untouched (ADR-0049), including on federated objects.

This is the plugin-security sibling of the engine-layer fix that withheld
`DriverOptions.tenantId` for the same objects; that one cannot reach here,
because Layer 0 is a `where` predicate composed into the query AST rather than a
driver option.

Record-ownership scoping (`__readScope` `own`/`unit` lowered to an `owner_id`
predicate) reaches federated objects through the same phantom column set and is
**not** addressed here — it is produced in `@objectstack/plugin-sharing` and is
tracked separately.
