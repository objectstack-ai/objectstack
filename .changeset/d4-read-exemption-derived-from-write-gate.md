---
"@objectstack/metadata-core": minor
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

`OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

**Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.
