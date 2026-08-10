---
"@objectstack/spec": minor
---

feat(spec): `manifestId` is optional on `TemplateManifestSchema`, and every shipped template manifest is now parsed against it (#7319)

`TemplateManifestSchema` describes the on-disk `objectstack.manifest.json`, and
the bundled blank template declares it as its `$schema` — but the file did not
satisfy it. The schema inherited `manifestId` from `CreatePackageRequestSchema`
as **required**, and no template has ever declared one. Measured on `main`, that
was the *only* complaint the shipped file produced:

```
manifestId: Invalid input: expected string, received undefined (invalid_type)
```

Nothing broke, because nothing parsed the file. `create-objectstack` reads and
rewrites it as raw JSON and does not depend on `@objectstack/spec` at all;
`objectstack package publish` also reads it raw, resolving the id as
`--manifest-id ?? manifest.manifestId ?? deriveManifestId(artifact, path)`. That
fallback is the measurement: on this file the id is a declarative **default**,
not a requirement — a template tree that declares none publishes fine, deriving
`local.<slug>` from the compiled artifact.

**The key is now optional on the on-disk descriptor**, declared locally rather
than by loosening the shared base:

- `TemplateManifestSchema` omits the inherited field and re-declares it
  `.optional()`, reusing the publish field's value constraints — the same
  omit-then-extend split `namespace` uses (#6861), in the other direction. A
  malformed id is still rejected: optional is not unvalidated.
- **`CreatePackageRequestSchema` is untouched.** The publish request that reaches
  the control plane still requires `manifestId` — the package row is addressed
  by it and it is immutable once set. Widening the base would have made a publish
  request with no package identity parse, which is the collapse the local
  override exists to avoid.

Authoring is unchanged in the accepting direction: a manifest that declares a
`manifestId` still parses exactly as before, and every other required key
(`displayName`, `name`, `specVersion`) is still required.

**New gate — `check:template-manifests`.** Every `objectstack.manifest.json`
under `packages/create-objectstack/src/templates/` is parsed against
`TemplateManifestSchema` on every PR (unfiltered, in the required
`TypeScript Type Check` job). This is the check that would have caught both
drifts this file has now accumulated — #6861's silently stripped `namespace` and
this one — so the `$schema` line those files carry stops being an unverified
claim. It walks the template tree rather than a hand-kept file list, so a
template added later is covered on the day it lands, and it fails rather than
reporting success if it finds nothing to parse.
