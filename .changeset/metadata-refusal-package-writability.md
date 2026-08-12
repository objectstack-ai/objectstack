---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the metadata write refusal reports the package door — `ITEM_LOCKED` / `WRITABLE_PACKAGE_REQUIRED` are emitted where they apply (#7682)

`PUT /api/v1/meta/object/showcase_task` answered `403 NOT_OVERRIDABLE`
("'object' is not allowOrgOverride in the registry") — the **same** code, status
and sentence whether `?package=` pointed at a **read-only** package or a
**writable** one. The refusal discriminated on the metadata TYPE's registry
flags and never read the base the caller named, so the two codes the error-code
ledger registers to this package for the package-writability condition —
`ITEM_LOCKED` and `WRITABLE_PACKAGE_REQUIRED` — were never emitted on this path
at all. Declared, not enforced.

`SysMetadataRepository.assertAllowed` now reads the named base through the
shared `isWritablePackage` predicate (the same one `saveMetaItem`'s ADR-0070 D1
gate and the `/packages` lifecycle gate use — imported, not re-spelled), and a
refused write that named a read-only base says so:

- **`override-artifact`** (an artifact backs the name, and it ships from a
  package the deployment provides) → `403 ITEM_LOCKED`, carrying
  `lockSource: 'package'` — ADR-0010's own reserved value for a lock the package
  layer asserts — plus the package id. `WRITABLE_PACKAGE_REQUIRED` would be the
  wrong prescription here: switching bases cannot help, because the artifact is
  code-shipped wherever the caller points. This is the server-side counterpart
  of the "Read-only" badge Studio already renders.
- **`runtime-only`** (no artifact under this name — a NEW item authored into a
  read-only base) → `422 WRITABLE_PACKAGE_REQUIRED` with the package id, the
  same code, status and prescription `saveMetaItem` already emits for exactly
  this condition. One vocabulary, now stated at the single persistence route as
  well, so callers that do not pass through that gate cannot skip it.

**No allow decision moves.** Every write that succeeded before still succeeds:
this is the code selection inside the refusal branch, not a new gate. That
distinction is load-bearing rather than cautious — an ADR-0005 org overlay names
the read-only package it customizes *by construction*, so a package door that
refused would close the overlay model itself. Writes that name no base keep the
previous `NOT_OVERRIDABLE` / `NOT_CREATABLE` codes verbatim, and the DELETE verb
is unchanged (#6960 moved that side on purpose; `DeleteOptions` names no
package).

The `OS_METADATA_WRITABLE` hatch is likewise untouched — structurally, because
its limb returns before the new door. That is **not** an endorsement: the
maintainer ruling of 2026-08-12 on #8146 holds that a hatch write into a
read-only package should REFUSE, and the test covering it is labelled a
characterization pin of today's behaviour so the #8146 fix must invert it rather
than pass it silently. Re-measured on current `main` at that ruling's request:
it still reproduces, and the row lands bound INTO the read-only package
(`package_id = com.example.showcase`) rather than as the per-org override the
variable's own documentation describes.

Reachability, stated so it is not mistaken for more than it is: this refusal is
what answers on the host-config topology (`environmentId` undefined — the CLI's
lightweight assembler, i.e. the flagship showcase and self-hosted servers shaped
like it), which is the topology the defect was measured on. On a scoped kernel
`saveMetaItem` refuses earlier, in `protocol.ts`, still with the undiscriminated
`NOT_OVERRIDABLE`; that second refusal point is filed separately.
