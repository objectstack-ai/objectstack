---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): the protocol install primitive parses the manifest's `id` leg, and the duplicate door parses its target id (#19417)

Clause-②: no (narrowing)

**BREAKING for callers of the protocol install and duplicate doors** —
`ObjectStackProtocolImplementation.installPackage` and `duplicatePackage` now
refuse a package id that is not reverse-domain notation, throwing a `400`-tagged
error carrying the declaration's own sentence. Both used to install and report
success.

The accept set only shrinks back to what the published declaration has always
said. `MANIFEST_ID_PATTERN` is declared once in
`packages/spec/src/kernel/manifest.zod.ts` and referenced by both faces of one
identity — `ManifestSchema.id`, what an author writes, and
`PackageSchema.manifestId`, what the registry stores and publishes by.
`installPackage` parsed nothing at all: it spread the request into `any` and
handed it to `SchemaRegistry.installPackage` with a second `as any`, so
`id: 'pkg-a'` — or `com.example.my_erp` — installed and PERSISTED while
`defineStack()`, `os build`, `os validate` and the publish face all refused the
same id. That is «declared ≠ enforced» on a published contract, and nothing in
`packages/spec` moves for it: the declaration was already right.

**Why the primitive and not only a door.** #19473 landed the same parse at the
HTTP door (`POST /api/v1/packages`). That door is ONE caller of this primitive —
it routes through `protocol.installPackage` whenever the protocol service
resolves. `duplicatePackage` is a second, and an embedder holding the protocol
object is a third. A gate on one door buys that door; this one is on the method
every caller passes through.

The gate asks the declaration **by reference** — `ManifestSchema.shape.id` —
rather than keeping a copy of the grammar, so a future move of the
reverse-domain rule reaches this seam with no further edit. The sentence the
caller reads is the declaration's own (`manifestIdRefusal`), **surfaced rather
than reworded**: it names the key, echoes the value, lists the two examples and
carries a suggestion arm that verifies its candidate against the pattern before
offering it. Installing `id: 'com.example.my_erp'` now throws, with:

```text
Invalid package id 'com.example.my_erp' on `manifest.id`. Expected
reverse-domain notation ('com.steedos.crm', 'org.apache.superset') — lowercase
dot-separated segments; hyphens allowed inside a segment, underscores are not.
Did you mean 'com.example.my-erp'?
```

**The duplicate door refuses BEFORE it mints anything.** `duplicatePackage`
builds its target manifest and writes it through `installPackage` inside a
deliberately best-effort `catch {}` — a refusal raised only there would be
swallowed and the caller would read `success: true` on a package with no
manifest row. So the target id is parsed at the top of the method, ahead of the
row scan and ahead of the copy loop, and the refusal names the key the caller
actually wrote (`targetPackageId`).

**One assumption, one implementation.** The duplicate door derived both
namespaces with a raw `id.split('.').pop()` while `installPackage` derived the
same default with the spec helper `deriveNamespaceFromPackageId`, which
sanitises to the namespace charset, truncates to 20 and answers `null` when
nothing valid comes out. That mattered: the target namespace is spliced into
every copied object name as `${namespace}_${short}`, and an object name is
`/^[a-z_][a-z0-9_]*$/`. The Studio's own default duplicate id —
`<sourceId>-copy` — therefore minted `leave-copy_ticket`, a name the object
declaration refuses. Both sides now use the helper, so a duplicate of
`com.example.leave` into `com.example.leave-copy` is namespaced `leave_copy`.
An explicitly declared `targetNamespace` still wins untouched; when neither an
explicit nor a derivable namespace exists the door refuses loudly, naming
`targetNamespace` as the remedy, instead of renaming rows with an empty prefix.

**What is not affected.** Boot-time and in-process installs that reach
`SchemaRegistry.installPackage` / `ObjectQL.registerApp` directly never pass
through this primitive, so nothing about how a package is loaded from disk or
registered by a plugin changes. A conforming manifest installs exactly as
before, versionless and namespace-less manifests included — the version default
and the namespace default still run, now behind the id gate rather than ahead of
it.

**Scope — the `id` leg alone.** `InstallPackageRequestSchema` / `ManifestSchema`
are still not parsed whole here. The residual classes the HTTP door's own
docblock records are untouched by this change and are each their own narrowing
of a published contract.

**If you are refused.** Give the package an id in reverse-domain notation —
lowercase dot-separated segments, hyphens allowed inside a segment, underscores
not. The refusal names the key, echoes what you wrote and, where a mechanical
repair exists, offers one it has already checked against the rule, so the
prescription arrives with the failure rather than in a changelog.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — a caller supplies an id the declaration already required, and an id's repair changes the package's identity, so no mechanical mapping could be prescribed even in principle. The refusal itself carries the remedy. -->
