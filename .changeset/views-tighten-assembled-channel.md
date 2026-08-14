---
"@objectstack/objectql": minor
"@objectstack/runtime": minor
"@objectstack/lint": patch
---

feat(objectql,runtime,lint): tighten `views:` to the declared container-only contract; assembled manifests travel non-container view artifacts in `viewItems:` (#5320, #8070)

The registration loop (`registerApp` / nested-plugin seam) used to register
EVERY `views:` entry as type `view` — wider than the stack schema, which has
always declared containers only. The three gates now agree (#5320, ruled
2026-08-12):

- **objectql**: a non-container `views:` entry (ViewItem record, flattened
  overlay, inline config) is REFUSED with the ADR-0112 envelope
  (`INVALID_METADATA` / 422) and the wrap-it prescription. The declared entry
  for machine-assembled non-container artifacts is the new `viewItems:`
  channel: each entry is validated against `AssembledViewArtifactSchema` and
  the parsed body registers — declared = enforced in both directions.
- **runtime**: `GET /packages/:id/export` partitions view artifacts
  (`partitionAssembledViewArtifacts`): containers travel in `views:`, expanded
  items the container re-derives exactly are folded away, and standalone
  ViewItems / overlays / edited expansions travel in `viewItems:`. The
  export→import round trip that previously depended on the undeclared wider
  acceptance now survives end to end through the declared channels.
- **lint**: the pre-parse `view-container-shape` rule reaches the same
  verdicts — a `viewKind`-bearing `views:` entry is an error with the wrap-it
  prescription (it previously skipped them as "registered as-is"), and a
  hand-authored `viewItems:` is flagged machine-assembled-only.

Migration: a manifest assembled by an OLDER runtime (an export product carrying
expanded `viewKind` items inside `views:`) is refused on import with the
prescription — re-export the package with a runtime that writes the
`viewItems:` channel. Authored stacks are unaffected: `defineStack` already
refused every shape the loop now refuses.
