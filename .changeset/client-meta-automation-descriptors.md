---
"@objectstack/client": minor
"@objectstack/runtime": patch
---

feat(client): the final six route-audit gaps — meta drafts/published/FSM + automation descriptors (#3563 PR-5)

- `meta.getPublished(type, name)` — the published version of a metadata item
  (ADR-0033; compound names pass through unencoded, matching `getItem`).
- `meta.listDrafts({ packageId?, type? })` — pending drafts the active-only
  lists hide.
- `meta.getLegalNextStates(object, field, from?)` — ADR-0020 FSM
  introspection ("from here, where can this record go?").
- `automation.listActions({ paradigm?, source?, category? })` /
  `automation.listConnectors({ type? })` — the ADR-0018/0022 descriptor
  registries backing the Studio designer's pickers.
- `automation.getRuntimeStatus()` — per-flow enabled/bound engine state.

With these, the #3563 gap ratchet reaches **0** (from 27): every dispatcher
route that should be SDK-expressible is, and the conformance guard keeps it
that way.
