---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `saveMetaItem` canonicalizes flow bodies on write — a Studio edit now heals a legacy flow row like every other type's (#4542)

The once-per-boot stored-conversion warning promises that re-saving a row
("Studio edit → save") persists the canonical shape. That held for every type
except `flow`: the read path serves stored flows verbatim (the ADR-0078
open-namespace conflict guard needs the engine's live executor registry, so
`convertStoredItem` skips them), and `FlowNodeSchema.config` is an open
`z.record`, so the legacy dialect an author was served (`config.filters`, pre-17
node aliases) sailed back through `saveMetaItem`'s schema gate and re-persisted
verbatim. A flow row stayed `pending` in `os migrate meta --stored` no matter
how many times an author edited it — only the migration itself could retire it.

`saveMetaItem` now runs the #4498 resolver (`resolveFlowCanonicalizer`) on flow
bodies **before** the schema gate and persists `storable` — conversions plus the
derived condition envelopes, deliberately not the schema's defaults (ADR-0087).
The pass is copy-on-write, so already-canonical bodies (including the ones
`migrateStoredMetadata` and `duplicatePackage` hand in) are untouched.

Failure postures, same as the duplication seam:

- **A refused node-type rename** (the old token is a live name owned by a custom
  executor here) refuses the save with `409 FLOW_CONVERSION_CONFLICT`, naming
  the token and path — never a silent legacy persist. 409 rather than 422
  because the body may be perfectly valid: the refusal comes from environment
  state, so resubmitting the same body cannot help.
- **A body the canonicalizer cannot parse** falls back to the raw save and
  today's schema gate — in draft AND publish mode. `canonicalizeStoredFlow` is
  stricter than the gate (cycle detection, control-flow regions), and a
  work-in-progress draft with a temporary cycle must not become unsaveable;
  `registerFlow` still refuses to arm a malformed flow either way.
- **No automation service reachable** (a control-plane or metadata-only host):
  the save behaves exactly as before — a host must not start refusing flow
  writes it accepted yesterday. `os migrate meta --stored` reports what it
  could not canonicalize.

Reads are still unchanged — served bodies keep the stored dialect ("reads
diagnose, never drop"); the heal happens on the way back in.
