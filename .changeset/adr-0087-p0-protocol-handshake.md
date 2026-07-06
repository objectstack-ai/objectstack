---
"@objectstack/spec": minor
"@objectstack/metadata-core": minor
"@objectstack/metadata-protocol": minor
---

ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

`PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

- **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
- **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a *positive* mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
- **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.
