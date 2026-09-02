---
"@objectstack/metadata": patch
"@objectstack/core": minor
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

fix(metadata): register a `packages[]` artifact per package at the metadata door so every object has one owner across every door (#14599)

A release artifact carrying `packages[]` (ADR-0130 D4) was read at the metadata
door as if it carried one package: `MetadataPlugin._parseAndRegisterArtifact`
iterated the **flattened top level** and stamped every item with the artifact's
own `manifest.id`. For an artifact composed with `composeStacks(…, { manifest:
'preserve' })` that id is one arbitrary member's — `selectManifest`'s `'last'`
pick — so a two-package artifact registered the **module's** object under the
**App** package's identity, while the ObjectQL load path, reading the same
artifact's `packages[]`, owned it under the module's.

The platform then held two answers to "who owns this object", and which one a
consumer saw depended on the door it went through. Measured on a real boot of
`examples/app-multi-package`:

- `GET /api/v1/meta/object` served `crm_order` **twice** — the list merge keys
  slots by `${packageId}${name}`, so the two differently-attributed copies
  landed in two slots;
- `GET /api/v1/meta/object?package=<the App package>` returned the **module's**
  object, because the App-stamped copy was re-ingested into the registry as that
  package's contribution;
- the layers door named the App package while the item door and
  `GET /api/v1/packages` named the module;
- Studio's Data pillar for the App package listed the module's object — ADR-0130
  Consequences §1.3a ("Studio's scope is the package") did not hold.

**The door now reads both shapes, and attributes every item to the body it was
found in.** `packages` present → each assembled package body's collections are
registered stamped with **that body's** id; `packages` absent → the single
`manifest` branch runs exactly as before (D7). The owner is read off the body an
item was found in — never reverse-derived by matching a top-level item's name
against a name-to-package index, which would be the second metadata-identity
resolution path #14512's triage rejected by name.

**Ordering and the entry gate are reused, not re-derived (D5).** The door calls
the same `resolveArtifactPackageOrder` the ObjectQL load path calls, so the two
readers of one `packages[]` cannot disagree about the registration order **or**
about which artifacts are loadable at all.

⚠️ **`resolveArtifactPackageOrder` / `artifactPackageId` moved to
`@objectstack/core`** — hence the `minor` there. They were in
`@objectstack/objectql`, which **depends on** `@objectstack/metadata`, so the
metadata door could not import them from where they lived; `@objectstack/core`
already owns `resolvePluginOrder` and is already a dependency of both readers,
so hosting them there adds **no edge** to the package graph. `@objectstack/objectql`
re-exports both under their existing names — its published surface is unchanged,
which is why it is graded `patch`. `@objectstack/runtime` is `patch` for the
dispatcher error vocabulary's `file:` anchors, repointed at the new path.

**Single-package artifacts are byte-for-byte unaffected (D7)**, measured rather
than asserted: the whole `manager.register` sequence for a single-`manifest`
artifact — every call, in order, with the id and version each item was stamped
with — is pinned as a literal in
`packages/metadata/src/plugin-artifact-packages-attribution.test.ts` and was
recorded identically on both legs of the ablation. A real boot of
`examples/app-todo` answers every door identically before and after.

**Nothing a booted instance can see today disappears.** Every live
`ARTIFACT_FIELD_TO_TYPE` key is a member of `AssembledPackageBodySchema`
(measured, not assumed), so iterating bodies loses no collection; and because
`packages` composes by `concat`, an artifact whose top level carries a
definition no package body repeats keeps it — registered once, attributed to the
artifact's own identity, and logged, because it means the artifact's two halves
disagree about what it ships.

⛔ The **producer** half is untouched: `composeStacks` and `os build` keep
emitting the flattened top level alongside `packages[]`. Whether they should is
#14512's decision, not this door's.
