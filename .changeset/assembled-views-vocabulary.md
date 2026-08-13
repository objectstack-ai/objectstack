---
"@objectstack/spec": minor
---

feat(spec): declare the `viewItems:` channel — a portable home for non-container view artifacts in runtime-assembled manifests (#5320, #8070)

Runtime-assembled manifests (`GET /packages/:id/export`, environment artifact
bundles) carry view artifacts the authored stack vocabulary refuses: expanded
`viewKind` items (the ADR-0017 dual-read keeps them registered beside their
container), tenant-authored standalone ViewItems, and flattened overlays.
Measured on #5320, 2 of 3 exported entries in the minimal single-container case
were stack-schema-refused yet metadata-door-legal — the export→import round trip
worked only through the runtime registration loop's undeclared wider acceptance.

Per the 2026-08-12 fork ruling (option B plus A's mechanical half), the bridge
is now declared instead of silent:

- **`AssembledViewArtifactSchema`** (`ui/assembled-views.zod.ts`) — one entry of
  an assembled manifest's `viewItems:` collection: the non-container branches of
  the `view` metadata vocabulary, built from `VIEW_METADATA_MEMBERS` minus
  `container` so the two doors cannot drift. Strictly schema'd; no passthrough.
- **`partitionAssembledViewArtifacts`** — the producer-side re-aggregation
  shared by every manifest assembler: containers travel in `views:`; expanded
  items a travelling container re-derives exactly are folded away (reported in
  `folded`); everything else — standalone items, overlays, items whose stored
  body diverged from their container — travels in `viewItems:`.
- **`ObjectStackDefinition.viewItems`** is declared as an always-refusing key:
  hand-authoring it in `defineStack` source fails `tsc` (input type `never`) and
  parse, with the prescription (author containers in `views:`; author standalone
  views through the metadata door). The channel is machine-assembled by design.
