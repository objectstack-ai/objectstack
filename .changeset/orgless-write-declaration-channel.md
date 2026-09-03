---
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
"@objectstack/plugin-audit": minor
"@objectstack/plugin-auth": minor
"@objectstack/service-settings": minor
---

feat(objectql): an explicit per-write declaration for a legitimately org-less row

Until now one `NULL` organization on a platform object meant two different
things — a deliberate environment-level row, and a write that forgot to thread
an organization — and `resolveSystemInsertOrganization` had no way to tell them
apart. So the two objects that hold BOTH populations, `sys_metadata` (whose
non-overridable-type write lands env-wide by adjudication) and `sys_audit_log`
(whose writers enumerate their own legitimate org-less cases), had to stay
outside the tenant-audit control entirely. They are two of the largest write
populations in the platform namespace, which put the control's blind spot
exactly where it was least affordable.

Writes may now DECLARE that their rows belong to an adjudicated org-less
population:

```ts
await engine.insert('sys_metadata', row, {
  context: { isSystem: true },
  orgLessWrite: { object: 'sys_metadata', reason: 'env-level-metadata' },
});
```

The platform tenancy ledger gains a fourth verdict, `conditional`, and both
objects are admitted under it. ⚠️ Admission makes them STRICTER, not looser: an
org-less system write on either is now derived on a single-organization install
and refused loudly on a walled one, exactly as a `tenant-scoped` object's is,
and the declaration is the only way through. It is checked against the ledger
before anything else the resolver does, so a declaration naming an object the
ledger has not admitted, a reason that object does not admit, or an object other
than the one being written throws `ERR_ORGLESS_WRITE_DECLARATION_REFUSED` — no
spelling of the option is silently ignored, which is what separates a
declaration from a bypass flag. ⛔ It is not a way to quiet a refusal: a write
that simply forgot to thread an organization is the defect the refusal reports.

The platform's own six org-less writers declare, each on a test a reader can
check — the metadata repository on its own env-level scope, the audit writers on
whether the audited subject resolves an organization column at all. A new gate,
`pnpm check:orgless-write-declarations`, enumerates every declaration in the
tree, holds each to the same ledger the runtime does, and prints the count.
