---
"@objectstack/spec": patch
---

`manifest.integrity`'s TSDoc no longer asserts an unpack-time verification that nobody performs.

The `integrity` docblocks said that per-file re-verification at unpack is the **cloud control plane's** obligation. The cloud repo's own design docs said it is the **runtime's**. Neither side unpacks anything, so the two published texts pointed at each other and a reader of either learned that a verification exists when none does. This text ships in `@objectstack/spec`'s `.d.ts`, so the wrong claim reached every consumer that hovered the field.

Both `integrity` docblocks in `manifest.zod.ts` — `PluginIntegritySchema` and the `ManifestSchema` field — now state what is true:

- **Computed and self-checked by the publisher.** `os plugin build` computes the map into the compiled manifest, and the `os plugin publish` preflight re-hashes the artifact bytes against it, refusing the upload on a digest mismatch, a declared entry with no file, or a packaged file the map does not declare. An absent map is a permissive pass — the field is `.optional()`.
- **Not re-verified at unpack.** That leg is not implemented: there is no `os plugin install`, and the archive reader's only production caller is the publish preflight reading back its own output. It is owned by the **future runtime loader** (ADR-0025 §3.5 steps 4–7), not by the control plane, which stores the artifact blob opaquely. The enforce leg is tracked on #11331.

No schema, export, key or accept-set changes — the field's shape, optionality and `.describe()` are untouched, and a present `integrity` map validates exactly as before. What changes is that the documentation no longer advertises a guarantee the runtime does not deliver.

The liveness ledger row for `integrity` and its README note carry the same corrected attribution. The row's `status` (`dead`) and `verifiedAt` are deliberately unchanged: this is a prose correction, not a re-measurement.
