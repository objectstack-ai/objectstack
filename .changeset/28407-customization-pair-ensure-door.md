---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
---

feat(metadata-protocol): an ensure door for a base's paired customization package (ADR-0146 D3)

Clause-②: yes (narrowing)
Metadata-protocol: added

The new route `POST /api/v1/packages/:id/ensure-customization`, with its request and response schemas (`EnsureCustomizationPackageRequestSchema`, `EnsureCustomizationPackageResponseSchema`), widens the surface, and `POST /api/v1/packages` and the duplicate door's target narrow theirs: a package id shaped like a pair (`<base>.custom`) is refused unless its manifest carries what the ensure door writes.

<!-- adr-0087: not-required (runtime-interface-only packages/metadata-protocol/src/protocol.ts#ObjectStackProtocolImplementation) The narrowing is a refusal added to the install primitive and the duplicate verb of this runtime class, and to the HTTP install door that fronts them: an install whose id is a paired customization package id must declare the explicit pair namespace and a dependency on the base. No Zod schema, spec contract or stored metadata shape changes, and no stored row is reread differently: a pair already in `sys_packages` replays at boot as stored. So `objectstack migrate meta` has nothing to rewrite. -->

**What it does.** The paired customization package of a read-only base holds the changes a customer makes to that base. `POST /api/v1/packages/:id/ensure-customization` answers that pair, `<base>.custom`, and creates it when it is absent. It is created through the same install primitive `POST /api/v1/packages` uses, with an explicit namespace (the base's namespace followed by `_custom`, so `crm` gives `crm_custom`), a dependency on the base at the major of the base's version (`^3` for `3.4.1`), version `0.1.0` and type `module`. The answer names the base, the pair, its namespace, its dependency range, whether this call created it (`201` when created, `200` when it was already there) and whether it is writable. Asking again changes nothing. Two calls at once leave one pair, and a call that arrives while another is creating the pair waits for it and answers from what it left.

**What it refuses, leaving nothing behind.** A base that is not installed (`404`). A base that is writable, because it is customized directly, a base that declares no namespace, a base whose namespace is too long to take the `_custom` suffix (nothing is truncated or hashed), and a base whose version is not SemVer (`409`). A base that is itself a pair (`400`). A pair namespace another package already owns (`422 NAMESPACE_CONFLICT`, the code the registry stamps for the same condition). An installed `<base>.custom` that lacks the namespace or the dependency (`409`): it is never adopted or rewritten. The caller is judged as at the install door: `manage_metadata` under `single`, and under `isolated` or `group` only the platform operator, so a tenant administrator gets `403`.

**The narrowing.** `POST /api/v1/packages`, the install primitive and the duplicate door now refuse, with `400`, a package whose id is a pair id but whose manifest lacks the explicit pair namespace or a dependency on the base. The refusal names the ensure door. An exported pair that declares both still installs, and the dependency check then judges its range against the base installed there.

**SDK.** `client.packages.ensureCustomization(baseId)` returns `EnsureCustomizationPackageResponse`.

What to do: nothing for an existing stack. A pair is created through the ensure door, or installed from an export that declares both its namespace and its dependency on the base.
