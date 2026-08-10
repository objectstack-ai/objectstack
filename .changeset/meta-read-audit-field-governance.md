---
"@objectstack/metadata-core": patch
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
---

fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

`#4447` made the audit-provenance family (`created_at`, `created_by`,
`updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
`applySystemFields` forces `{ readonly: true, system: true }` over a *declared*
audit field, and `ObjectQL.update` strips a non-system caller's write to it.

The **read** path never learned it. A `/meta` object read resolves through
`sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
those three has been through `applySystemFields` — so an object whose built
artifact ships a materialized `created_at` carrying FieldSchema defaults
(`readonly: false`) reported that value to every client while writes to that
same field were being refused. Measured before the fix, all of the read exits
agreed with each other and disagreed with the engine:

```
single  read: {"type":"datetime","label":"Created At","readonly":false}
list    read: {"type":"datetime","label":"Created At","readonly":false}
cached  read: {"type":"datetime","label":"Created At","readonly":false}
layered read: {"type":"datetime","label":"Created At","readonly":false}
```

One field, two answers — and the machine-readable one, the only face a client
or an AI author writing code off `/meta` can see, was the wrong one.

**What changes.** Every `/meta` object read exit now reports the audit family
the way the engine enforces it. That covers the single-item read (both the
singular and plural type spelling), the list read, the cached/ETag branch, the
`?preview=draft` and `?state=draft` reads, and the layered read's `effective`
layer. `GET` bodies for objects that declare an audit field will show
`readonly: true, system: true` where they previously showed `readonly: false`
or omitted the keys; nothing else about the document changes, and the ETag for
such an object changes once.

**What deliberately does not change.**

- The layered read's `code` and `overlay` layers stay raw — showing the
  package's declaration beside the governed `effective` value is the
  diagnostic's whole point.
- `sys_metadata` still stores exactly what the author saved; the correction is
  applied on the way out, so no phantom customization appears in the diff.
- An object that opts out of the audit family (`systemFields: false`,
  `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
  engine enforces nothing there, so a read that claimed otherwise would be the
  same lie pointing the other way.
- Only `readonly` and `system` are forced. Every other key an author writes —
  `label`, `description`, `hidden`, `group`, and `type` for an external object
  mapping a differently-typed remote column — stays theirs.

The governance table moved from `packages/objectql/src/registry.ts` to
`@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
`applyAuditFieldGovernance` normalizer the read path applies), by the same
criterion and for the same cycle as the `#5619` engine-dispatch predicates:
`@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
read path cannot import the table from the registry that enforces it, and a
second copy would agree only until someone edited one side. `objectql`
re-exports the symbol from its original path, so its public API is unchanged.
