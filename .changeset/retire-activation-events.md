---
"@objectstack/spec": major
---

refactor(spec)!: remove `activationEvents` (both keys) and the `ActivationEventSchema` vocabulary — lazy activation that no runtime ever implemented (#4657, ADR-0049)

`activationEvents` promised lazy plugin activation ("plugins remain dormant
until an activation event fires") on two authorable surfaces —
`DynamicLoadRequest.activationEvents` (`@objectstack/spec/kernel`) and
`StudioPluginManifest.activationEvents` (`@objectstack/spec/studio`, the
`defineStudioPlugin` input) — and **no runtime in objectstack / cloud /
cloud-v1 / objectui ever read either key** (four-repo bare-name scan in #4657,
re-verified at implementation time). Every plugin has always activated
immediately on load/registration; cloud-v1's own ROADMAP recorded lazy
activation as ❌ unimplemented (planned v0.4.0). That is ADR-0049's
declared ≠ enforced shape in the semantically-lying direction: an author
writing `activationEvents: [{ type: 'onMetadataType', pattern: 'flow' }]`
expected deferral and got eager activation with a clean parse.

#4653 had just converged the two `ActivationEventSchema` declarations onto one
structured `{ type, pattern }` form inside this same unreleased major; with the
enforce-or-remove ruling landing on **remove**, that converged vocabulary
retires before ever shipping. Composed across the two changes, a v16 author
simply deletes the key in whichever form they carried.

Migration (FROM → TO):

- `activationEvents` in a `defineStudioPlugin` input / `StudioPluginManifest`
  value — v16 string form (`['*']`, `['onMetadataType:flow']`) or v17-rc
  structured form (`[{ type: 'onStartup', pattern: '*' }]`) alike →
  **delete the key**. There is no replacement value: eager activation is the
  only behaviour there has ever been, and `activate()` still runs at
  registration time. The strict manifest parse rejects the key (and its former
  VS Code-flavoured aliases `activation` / `events` / `onActivate`) with this
  prescription.
- `activationEvents` in a `DynamicLoadRequest` value → **delete the key**.
  Tombstoned, not silently stripped — `DynamicLoadRequestSchema` is not
  `.strict()`, so a `retiredKey()` tombstone makes authoring it a `tsc` error
  and a parse error carrying the prescription.
- `import { ActivationEventSchema, ActivationEvent } from '@objectstack/spec/kernel'`
  (or `/studio`) → **no replacement export** (TS2305 after upgrade). Nothing
  consumed the vocabulary; an exported schema with no consumer is read as a
  capability by whoever finds it (#3950), so the orphaned def goes with the
  keys.
- Lazy activation is a **new capability**: if it is ever built it returns via
  the enforce route of ADR-0049 through a new ADR — executor first, vocabulary
  second — not by re-declaring inert keys.

Self-check (#4535 §5): TS2305 — yes, two removed exports on two entries;
metadata migration — none possible or needed (`StudioPluginManifest` is TS
configuration parsed by `defineStudioPlugin`, a root schema never stored in
`sys_metadata`; `DynamicLoadRequest` is a runtime request shape with no
caller — no stored row exists for a D2 conversion to rewrite, so the change is
one ADR-0087 D3 semantic record, `plugin-activation-events-retired`); shape
change — two keys removed, zero behaviour change (eager activation before and
after, byte-identical).

The retirement kit: `retiredKey()` tombstone on the non-strict kernel schema;
strict-parse `guidance` prescriptions on the studio manifest (including the
three former aliases); ADR-0087 D3 semantic migration; baselines
(`authorable-surface.json` — one `[RETIRED]` line, five lines dropped
deliberately with the defs; `json-schema.manifest.json` — `kernel/ActivationEvent`
and `studio/ActivationEvent` def removals; `api-surface.json`) regenerated
deliberately; compiler-API export pin (`activation-events-retirement.test.ts`,
zero holders across every public entry) — sabotage-verified.
