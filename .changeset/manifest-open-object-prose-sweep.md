---
"@objectstack/spec": patch
"@objectstack/core": patch
---

Documentation: the manifest surface no longer describes itself as an open object.

`ManifestSchema` became a `strictObject` when the manifest surface was closed against unknown keys, but five prose sites still described the earlier posture. They shipped, so an author (or an AI writing metadata) reading the declarations was told the manifest tolerates undeclared keys — while the runtime rejects them by name and offers the declared spelling for a near miss. Prose that contradicts a tightened contract teaches exactly the wrong reflex, so each site now states the current refusal rather than merely dropping the old claim:

- `AssembledPackageBodySchema`'s docblock no longer explains its lack of a `strictObject` spelling by calling `ManifestSchema` open. The posture is inherited: the schema is `ManifestSchema.extend(...)`, and `.extend()` carries the base's unknown-key handling, so an undeclared key on an assembled body is refused — measured, with the rename suggestion intact.
- The artifact-registration seam kept the half of its reasoning that still holds (the schema applies defaults, so a parsed clone would not be byte-identical) and retired the half that does not ("Zod strips undeclared keys") — the key is now refused at that parse rather than dropped from the clone.
- The `os compile` per-package rule pass explains why a body may be re-read as its own manifest: nothing parses that superset, and against `ManifestSchema` it would now be refused.

No schema, behaviour or export changed; `check:api-surface` and the generated reference pages are unmoved.
