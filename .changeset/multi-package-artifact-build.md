---
"@objectstack/spec": minor
"@objectstack/cli": minor
"@objectstack/objectql": patch
---

feat(cli,spec): compile a project of N packages into one `packages[]` artifact, with the assembled package body declared (#14439, closes #14242)

ADR-0130 D4's producer side. A product can now be split into modules without
renaming a single object: N ordinary `defineStack` packages, one project-level
`composeStacks([...], { manifest: 'preserve' })`, one compiled artifact that
carries them all.

**`@objectstack/spec` — the assembled package body has its own declaration.**
`ArtifactPackageEntrySchema` describes a package at AUTHORING time, where
`manifest.objects` is an array of glob patterns. What the ADR-0130 load path
registers is an ASSEMBLED body whose `objects` are definitions, so a full parse
of a real artifact entry was refused (`manifest.objects.0: expected string,
received object`) and the loader could gate the wrapper only. #14242 recorded
three roads and the maintainer took **B** (2026-09-02): the assembled stage is
now declared as `AssembledPackageBodySchema`, carried by `ArtifactPackageSchema`,
and `ObjectStackDefinitionSchema.packages` refers to that. ⛔ Road C — widening
`ManifestSchema.objects` into a union of both spellings — was rejected by name:
a union that accepts both stages makes neither stage checkable.

The body's collection keys are DERIVED from the same table the stack schema's
composition rules come from, never transcribed, so a metadata family added to
the stack reaches package bodies on the day it lands.

`composeStacks(..., { manifest: 'preserve' })` now folds each input stack's own
metadata onto its manifest instead of preserving the identity alone.
Composition is the last point at which per-package attribution exists — the
composed stack flattens every collection to the top level — so a package list
built without it names N packages that own nothing.

**Accept-set change, in one direction.** A `packages[]` entry whose body carries
authoring-time glob patterns where the assembled stage carries definitions is
now REFUSED — at `defineStack`, at `os build`, and at load. Nothing in the field
produces that shape: `packages[]` had no producer at all before this change.
Write the package's metadata in its own `defineStack` and let composition
assemble it.

**`@objectstack/cli` — `os build` / `os compile` read `packages[]`.** When the
loaded definition carries one, the same lowering walks every package body (an
un-lowered handler is a `function` value that `JSON.stringify` drops without a
word, and a `packages`-carrying artifact is registered THROUGH that list), the
same author-time rule table runs once per package, and one artifact JSON is
written whose `packages[i]` are assembled bodies. A single-package project is
untouched: no `packages` key is minted, and neither new branch runs.

**`@objectstack/objectql` — the load gate parses the whole entry.** The
wrapper-only gate was a narrow accommodation of the mismatch above; with the
assembled stage declared, a malformed package body is refused at the seam that
would otherwise register it owning nothing.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing has no
     FROM → TO for an author to apply: no path produced a `packages[]` artifact
     before this change, so no authored or stored metadata carries the refused
     shape. The authoring spelling that replaces it is not a rename of a key but
     the ordinary `defineStack` + `composeStacks` route the artifact is compiled
     from. -->
