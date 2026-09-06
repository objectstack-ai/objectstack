---
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

docs(runtime,metadata-protocol): correct the `writable` verdict's illustration — the scope-less booted row is a marketplace / offline import, never a multi-package artifact's module (#14803)

Comment and prose only. No predicate, no assertion and no served shape changes;
every pin behind the `writable` verdict stays green as written.

The `writable` verdict shipped in 17.3.0 with a **false attribution** in its own
explanation, and this corrects it at every site that repeated it. The claim was
that the scope-less booted row `isWritablePackage` answers `false` for is *the
`type: module` sub-package a multi-package artifact carries*. It is not, and it
never was:

- `defineStack` parses every `packages[]` entry through `ManifestSchema`
  (`spec/src/stack.zod.ts`, `ArtifactPackageEntrySchema`), whose `scope` is
  `.default('project')` (`spec/src/kernel/manifest.zod.ts`), so **no** package of
  a compiled artifact is ever scope-less — `dist/objectstack.json` and both
  served rows carry `scope: "project"`.
- A genuinely scope-less row arises only where a manifest reaches the registry
  **without** that parse, because `installPackage` stores a key-by-key copy that
  applies no defaults: a marketplace install / offline file import
  (`manifestService.register(rawBody)` to `ql.registerApp`) for the **booted,
  read-only** half, and `POST /api/v1/packages` (`body.manifest || body` to
  `installPackage`) for the **database base, writable** half.

Measured: `ManifestSchema.parse` of the `app-multi-package` orders body turns an
unauthored `scope` into `scope: "project"`, while `SchemaRegistry.installPackage`
of the same unparsed body yields a record with no `scope` key at all.

What stays, because it is true and load-bearing: a scope-less **booted** package
is read-only while a scope-less **database base** is writable, and only
`engine.manifests` tells them apart — which is why the server owns the verdict.
