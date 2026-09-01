---
"@objectstack/spec": minor
---

feat(spec): the release artifact may carry N package manifests — optional `packages[]` on `ObjectStackDefinitionSchema` (ADR-0130 D4, #14161)

`ObjectStackDefinitionSchema` gains an **optional** `packages` key: an array of
package entries, so one release artifact can deliver a product split into
modules **without renaming a single object**. Renaming is what separate
namespaces would cost — the object `name` IS the table name, the REST path, the
formula token and the saved-view key (ADR-0129 D1–D2) — and rename-on-install is
ADR-0048's standing non-goal.

**`manifest` (singular) is RETAINED, not replaced**, and both shapes are read:
`packages` present → iterate it; `packages` absent → treat `manifest` as a
single-element list. A replacement would break every artifact already built and
sitting on disk at every customer, which is why ADR-0130 states the read-both
rule as the schema decision rather than an implementation note: the schema shape
IS the compatibility mechanism.

**Each entry is a wrapper object** — `{ manifest: { … } }` — never the manifest
body inlined flat as the array element. That position is reserved deliberately,
at schema time: when a future external-segment form lands it is
`{ ref, integrity }`, an **additive key on an existing object**, rather than a
reshape that would have to bolt transport keys onto the shared `ManifestSchema`
and make every required manifest field optional. ⛔ Segmented loading itself is
**not** implemented and is an explicit ADR-0130 Non-goal. Forward compatibility
rides the mechanism that already exists, `manifest.engines.protocol` (ADR-0025);
⛔ no new version-negotiation mechanism is introduced.

**Graded `minor`: a pure widening, with no accept-set narrowing anywhere.** The
new key is optional, no existing key changed shape, and nothing that parsed
before is refused now. Measured rather than asserted — the acceptance criterion
was that existing single-`manifest` artifacts do not move, and both halves are
pinned:

- schema layer (`packages/spec/src/stack-artifact-packages.test.ts`): parsing a
  single-`manifest` artifact adds **no** top-level key, materialises no
  `packages` list, and the serialised result contains no `"packages"`. The
  near-miss this guards is a `.default([])`, which would have rewritten every
  project's artifact on its next build;
- compiler (`packages/cli/test/compile-artifact-packages.e2e.test.ts`): the
  artifact `os build` writes for a single-package project has the exact
  top-level key set it had before.

**No `@objectstack/cli` release is graded, and that is a measurement, not an
omission.** `os compile` / `os build` needed **no source change** to align:
`normalizeStackInput`, `lowerCallables` and the artifact write each shallow-clone
the top level, and the validation step parses with this very schema, so the new
key flows through end to end. What moved is the CLI's accept set, and it moved
**entirely through this package** — the CLI ships no changed line and takes the
new behaviour with its `@objectstack/spec` bump. The pass-through was verified by
compiling real projects in the e2e file above rather than read off the source,
because "it works by construction" is exactly the claim that stops being true the
day someone adds a whitelist to one of those three steps.

⚠️ This ships the **shape** only. The load path that iterates the list in
dependency-topological order (ADR-0130 D5, through the one sorter
`resolvePluginOrder`) and the `installPackage` co-ownership gate with its
install-time object-name uniqueness check (D1/D3, which ADR-0130 requires to land
as one inseparable change) are separate, dependent cards. Until they land, a
multi-package artifact parses and carries its list and nothing downstream
iterates it — so authoring `packages` today registers no extra package.
