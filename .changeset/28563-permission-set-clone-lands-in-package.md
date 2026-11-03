---
'@objectstack/runtime': patch
---

feat(runtime)!: the permission-set clone door lands "new similar" in a writable target package — by default the source package's `.custom`, never package-less (#28563)

Clause-②: yes (narrowing) — `POST /security/permission-sets/:name/clone` takes an optional `package` and its answer names the package the copy landed in (widening); a copy of a set shipped by a read-only package now lands in that package's paired `<X>.custom`, ensured through the pair's one creation path, so a source whose package the ensure door refuses (it declares no namespace, its version is not SemVer, or another package owns the pair's namespace) is refused 409/422 where it was copied package-less before, and a given target that is unknown, read-only or out of reach is refused.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata key, value or type changes: the door's HTTP body gains an optional key and its answer gains one, and the copy's own definition is the same whole-definition copy as before. A refused clone writes nothing and its refusal names the remedy, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the permission-set clone door (`@objectstack/runtime`).

- **Before.** Every copy was saved environment-wide with no package, whatever package shipped the set it was copied from. The body was `{ name, label }`.
- **Now (ADR-0146 D3/D6).** The body is `{ name, label, package? }` and the answer is `{ permissionSet, package, notice }`.
  - `package` omitted, the set shipped by a read-only package X: the copy is saved in X's paired customization package `<X>.custom`, created through the ensure door (`ensureCustomizationPackage`) on the first copy and reused after. The stored row is bound to the pair; the copy's definition still names no package.
  - `package` omitted, the set already in a writable package (a base you own, or `<X>.custom`): the copy is saved in that package.
  - `package` omitted, the set authored in the environment: unchanged, environment-wide (`package: null`).
  - `package` given: it must be installed and writable (else 422 `WRITABLE_PACKAGE_REQUIRED`), and its dependency closure must reach the source's package and every object the set grants on (else 409 `RESOURCE_CONFLICT`). The rule is the one the flow clone door uses.
- **Unchanged.** A new name is mandatory and a taken one is 409; `manage_metadata` and the walled catalog refusal answer first; the copy is assignable by its bare name through a position or a direct assignment.
- **Who sees it.** An administrator copying a packaged set from Setup: the copy now travels with the package's customizations. A copy of a set from a package the ensure door cannot pair is refused with the ensure door's own sentence.

**The remedy.** For a refused pair: give the base package a namespace (and a SemVer version), or name a writable target with `package`.
