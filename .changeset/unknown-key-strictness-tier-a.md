---
"@objectstack/spec": major
---

feat(spec)!: reject unknown keys on the flow and permission authoring schemas (#4001 Tier-A)

Zod's default `.strip` silently discarded any key these schemas did not
declare — the instance kept parsing, so a mis-spelled or wrong-layer key
shipped as metadata that quietly ignored the author's config (#3405's
action-param `reference`, #1535's object-level `workflows`). #3746 tightened
one schema; this extends the same treatment to the two highest-risk
authorable surfaces, per the ADR-0054 ratchet and the
`docs/audits/2026-07-unknown-key-strictness-ledger.md` triage:

- **`security/permission.zod.ts`** — `PermissionSetSchema`,
  `ObjectPermissionSchema`, `FieldPermissionSchema`, `AdminScopeSchema` are
  now `.strict()`. A silently dropped key on the capability container meant
  the author believed a grant or restriction was in place that the runtime
  never saw. `EffectiveObjectPermissionSchema` (response-side) explicitly
  `.strip()`s back and stays wire-tolerant.
- **`automation/flow.zod.ts`** — `FlowSchema`, `FlowNodeSchema`,
  `FlowEdgeSchema`, `FlowVariableSchema` are now `.strict()`. A node's
  `config` record stays **open**: it is per-node-type, owned by the
  registered executor's `configSchema` (#4027/#4040) and the ADR-0087
  conversion layer.
- **`shared/suggestions.zod.ts`** — new `strictUnknownKeyError` factory (the
  #3746 hand-rolled map, generalized): every rejection names the offending
  key(s) and, where recognisable, the canonical spelling or a retired-key
  tombstone. `ui/action.zod.ts` re-homes onto it with byte-identical messages.
- **`PermissionSetSchema` gains `description`, `protection` and the ADR-0010
  runtime protection envelope (`_lock`, `_packageId`, `_provenance`, …).** The
  strict gate's own catches: all of these are written by real code — the
  built-in default sets author `description` and the Setup projection reads
  it; `applyProtection` stamps the envelope on every metadata type and
  `getMetaItemLayered` → `saveMetaItem` round-trips it — but the schema could
  not represent them, so they were silently stripped at every parse (ADR-0078
  §3 inverse drift). Every sibling registered metadata type already spread
  `MetadataProtectionFields`; permission was the outlier.

**Migration.** Any key these schemas now reject was previously stripped and
therefore had **no runtime effect** — removing or renaming it never changes
the behavior of a working app; validation simply stops lying about it. The
error message carries the fix; the FROM → TO mappings baked into it include:

- Permission set: `objectPermissions`→`objects`, `fieldPermissions`/`fls`→`fields`,
  `tabs`→`tabPermissions`, `rls`/`policies`→`rowLevelSecurity`;
  `read`/`edit`/`export`/…→`allowRead`/`allowEdit`/`allowExport`/…;
  `readable`/`editable` vocabulary for FLS (`hidden` → declare `readable: false`).
  Retired keys carry tombstones: `contextVariables` (ADR-0105 D11 — use a
  registered `rlsMembership` resolver or an inline literal), `isProfile`
  (ADR-0090 D2 — use `isDefault`).
- Flow: `steps`→`nodes`, `connections`/`transitions`/`links`→`edges`,
  `trigger`/`triggerType`→`type`, `title`→`label`; edge `from`/`to`→`source`/`target`,
  `guard`/`when`/`expression`→`condition`; a top-level `object`/`objectName`/`schedule`
  belongs on the START node's `config` (`{ objectName, triggerType, condition,
  schedule }`), not on the flow.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
