---
"@objectstack/service-datasource": patch
---

`os datasource introspect` now generates an object draft that `os build`
accepts (#10712). The review-before-commit flow was handing the user a
`*.object.ts` the platform's own validator refuses, on two independent counts:

- **The object name carried no `${namespace}_` prefix**, so `defineStack()`
  refused it outright (ADR-0028) — measured as
  `Object 'customers' is missing the package namespace prefix.` The prefix is
  now derived from the datasource's OWN owning package (`_packageId` →
  that package's `manifest.namespace`), and applied through
  `validateObjectNamespacePrefix` — the same function `defineStack()` and the
  runtime publish gate call, so an already-prefixed remote table
  (`wh_accounts` under namespace `wh`) is not double-prefixed.
- **No `sharingModel` was emitted**, so the author-time rule set refused it
  (`security-owd-unset`, ADR-0090 D1) — the same rule family #9666 hit for the
  `os init` template. The draft now declares `sharingModel: 'private'`
  explicitly, following the shape #9666 settled on for generated scaffolds:
  the rule's own recommended default, rendered with the reason attached.

When no namespace can be resolved (a datasource with no package provenance, or
a package that declares none) the draft keeps the bare remote-table name and
the rendered source carries a loud `TODO(namespace)`. It does not invent a
prefix — mirroring `defineStack`, which skips the check entirely rather than
inventing one, and avoiding an `_customers` that would trade one invalid draft
for another.

At the time this landed, the `opts.primaryKey` path still did not build: it
emitted `fields.<f>.primaryKey`, which is not an authorable spec field key.
That was #11000, and it is fixed separately in this same release — both paths
build now. See that changeset for what replaced the key.
