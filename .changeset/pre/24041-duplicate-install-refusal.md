---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): `duplicatePackage` is refused, with nothing copied, when the install of the copy's package record is refused

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) The refusal is one verb's runtime answer at call time; no stored metadata, spec key or published type changes, so there is nothing for `objectstack migrate meta` to rewrite. The remedy is a different argument on the next call. -->

- **Refused now.** `duplicatePackage`, and `POST /api/v1/packages/:id/duplicate` which calls it, installs the copy's package record before it copies any item. When that install is refused, the duplicate is now refused with that same refusal, and nothing is minted or copied. A copy whose namespace another installed package owns answers `422 NAMESPACE_CONFLICT` with the registry's own sentence (ADR-0048); that covers an explicit `targetNamespace` and one derived from the last segment of `targetPackageId`. A failed `sys_packages` write answers the install's own `500`. Before, both refusals were dropped and the items were copied anyway: bound to an id with no package record (absent from `GET /packages`), after a namespace conflict inside the namespace the other package owns, and the answer read `success: true`.
- **Unchanged.** A duplicate whose package record installs copies exactly as before, with the same answer shape, and per-item failures still ride `failed[]`. A source with no package record still copies without installing one.
- **Remedy.** Choose a target namespace no installed package owns: pass `targetNamespace` explicitly, or pick a `targetPackageId` whose last segment derives a free one. For a deliberate migration, `OS_METADATA_COLLISION=warn` still downgrades the namespace gate to a warning, and the duplicate then proceeds.
- **Logged.** The refusal is logged once at `warn` by `[protocol.duplicatePackage]`, naming the target and source ids and the refusal's code and message. For a store fault the error itself is attached, so its cause reaches the log.
