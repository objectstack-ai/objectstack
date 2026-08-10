# Dead-surface disposition plan (spec liveness)

> ## ⚠️ CORRECTION (2026-06-16) — this plan is substantially invalidated; do NOT prune from it
> The "dead" verdicts were seeded from audits that **only checked the framework runtime + end-user renderers and MISSED objectui's metadata-admin authoring UI** (`../objectui/packages/app-shell/src/views/metadata-admin/`, which renders/edits nearly every authorable prop). A cross-repo re-audit (reading the actual consumer code in BOTH repos) found **~25 props this plan called "dead" are actually objectui-live** — pruning them would break the authoring UI / detail rendering. Reclassified `dead→live` in the ledgers: field `externalId`/`currencyConfig`/`searchable` + the 6 master-detail overrides; tool `category`/`requiresConfirmation`/`active`/`builtIn`; skill `triggerPhrases`/`permissions`; action `execute`/`shortcut`/`bulkEnabled`/`disabled`; flow `status`/`active`/`nodes.boundaryConfig`; agent `knowledge`; role `parent`; permission `isProfile`.
> **Only ~42 props are confirmed dead in BOTH repos** (the genuine prune candidates — dominated by the 24 object-level props, which also hit `NoExcessObjectKeys` TS-strict cross-package coupling). Merged prunes #1945/#1946 were re-verified against objectui and are safe. **Any further pruning MUST verify each prop against framework AND objectui first.** The sections below are kept for history but their per-prop "prune" verdicts are unreliable.

**Date**: 2026-06-16 · **Input**: the spec-liveness gate (`packages/spec/liveness/`) over 10 governed metadata types. **Builds on**: [ADR-0049](../adr/0049-no-unenforced-security-properties.md) (security enforce-or-remove). **Purpose**: turn the gate's measurement into an executable decision — for each of the **89 `dead` properties**, recommend **enforce / wire-rename / prune / mark-experimental / defer / objectui** with rationale, cost and risk.

> The gate already proves these properties have no framework runtime consumer. This document decides what to *do* about each. It makes recommendations; the team owns execution (especially spec removals and runtime enforcement).

## Headline

**The dominant disposition is PRUNE (~64 of 89).** Most dead surface is aspirational enterprise config, duplicate flags, or display options that nobody reads and nobody has a committed roadmap for. For a platform whose value proposition is a *trustworthy* metadata contract (and whose positioning is an open Ontology protocol), **shedding false surface is the highest-leverage hygiene move** — under-promise in the spec, deliver what's declared. "Narrow and true" beats "broad and half-wired."

| Disposition | Count | Meaning |
|---|---|---|
| **PRUNE** | ~64 | Remove from spec. No roadmap; aspirational / duplicate / display-only. Shrinks false surface. |
| **WIRE-RENAME** | ~8 | A user-visible *bug*: the property is meant to work but reads under a wrong key, or duplicates a flat sibling. Fix the key / route the consumer. |
| **ENFORCE-or-PRUNE** | ~6 | Security/scoping-relevant — needs a product call: build the enforcement, or remove the false promise. Do **not** leave as silent dead. |
| **OBJECTUI** | 1 | Fix lives in the separate `objectui` renderer repo (can't be done here). |

Security note carried over from ADR-0049: a *dead security/governance property is worse than absent* — it implies a boundary that isn't there. The P0 cluster below is exactly those.

---

## Priority-ordered actions

### P0 — false-compliance / security-relevant dead → decide enforce-or-remove (don't leave)
These imply a security/governance/isolation boundary that does not exist.

| Property | Disposition | Why · cost · risk |
|---|---|---|
| `field.encryptionConfig` | **PRUNE** | Implies at-rest encryption; the only real channel is `type:'secret'` (engine `encryptSecretFields`). A field-level encryptionConfig is false assurance. Remove + point authors to `secret`. Low cost; risk: seeds using it. |
| `field.maskingRule` | **PRUNE** | Implies field masking; no consumer. False data-protection promise. Remove. |
| `field.writeRequiresMasterRead` | **PRUNE** | Governance flag, no consumer. Remove. |
| `field.dataQuality` / `field.auditTrail` | **PRUNE** | Aspirational governance, no runtime. Remove (re-introduce with the feature). |
| `permission.contextVariables` | **PRUNE** | Doc claims runtime RLS evaluation; RLS uses only `current_user.*` built-ins. Misleading — remove. |
| `permission.isProfile` | **PRUNE** | profile-vs-permset never gates anything. Remove (the `profile` type alias already conveys intent). |
| `agent.tenantId` | **ENFORCE-or-PRUNE** | Multi-tenant agent isolation — if agents must be tenant-scoped, wire it in the runtime; else remove. Product call. |
| `skill.permissions` | **ENFORCE-or-PRUNE** | A skill should be restrictable; today unenforced + naming drift (`requiredPermissions`). Enforce at skill-activation, or remove + drop the drift. |

### P1 — naming-drift / duplication *bugs* (authors set them, they silently no-op) → wire or rename
User-visible: documented per the protocol, fails silently.

| Property | Disposition | Why · cost · risk |
|---|---|---|
| `field.referenceFilters` | **WIRE-RENAME** | Lookup dialog reads `lookup_filters`; normalize the key so the documented camelCase works. Net user-facing fix. (renderer side = objectui) |
| `field.columnName` | **WIRE-RENAME → else PRUNE** | DANGEROUS: advertises custom physical column names the driver never honors (`resolveColumnName` has 0 call sites). Either wire it in driver-sql or remove. Removal is safer. |
| `field.currencyConfig` / `field.vectorConfig` / `field.fileAttachmentConfig` | **PRUNE (pick flat)** | Nested config is dead; renderers read flat siblings (`currency`/`precision`, `dimensions`, `multiple`/`accept`/`maxSize`). Remove the nested form — one shape per field type. |
| `agent.knowledge` | **WIRE-RENAME → else PRUNE** | Shape drift `{topics,indexes}` vs read `{sources}`; no runtime reader (RAG via `service-knowledge`). Reconcile the shape or remove (RAG is wired elsewhere). |
| `action.disabled` | **OBJECTUI** | CEL form ignored; primary renderers read non-spec `enabled` and invert. Fix is in the objectui renderers (`action-button.tsx`) + normalize the key. Cross-repo. |

### P2 — aspirational / duplicate / display surface → PRUNE (narrow-and-true)
No security implication; no roadmap; removing shrinks false surface. Grouped for batch removal.

**object (≈22)** — the largest prune target:
`enable.{trackHistory,searchable,files,feeds,activities,trash,mru,clone}` (capability flags, no readers — `apiEnabled`/`apiMethods` already enforced, #1937); `versioning` / `partitioning` / `cdc` (aspirational enterprise blocks); `softDelete` & `search` (duplicate the dead `enable.trash`/`enable.searchable`); `recordTypes` / `defaultDetailForm` (unimplemented, elaborate docstrings); `recordName` (superseded by field `autonumber`); `keyPrefix` / `tags` / `abstract` / `isSystem` / `active` (no reader); `tenancy.{strategy,tenantField,crossTenantAccess}` (only `tenancy.enabled` is live).

**field (≈24)** — enhanced-type display config + redundant flags:
`theme` / `lineNumbers` (code: only `language` live); `allowHalf` / `maxRating` (rating: `max` live); `displayMap` / `allowGeocoding` / `addressFormat`; `colorFormat` / `allowAlpha` / `presetColors`; `showValue` / `marks` (slider: min/max/step live); `barcodeFormat` / `qrErrorCorrection` / `displayValue` / `allowScanning`; `inlineTitle` / `inlineColumns` / `inlineAmountField` / `relatedList` / `relatedListTitle` / `relatedListColumns` (master-detail explicit overrides — auto-derivation works); `searchable` / `index` / `externalId` (field-level — superseded by object/dataset-level); `cached` / `dependencies` / `trackFeedHistory` / `caseSensitive`.

**✅ Ledgered 2026-08-08 — `field.step` (slider) is UI-ONLY and deliberately unenforced (#6514).** Not a prune row: it is an entry for a key that **stays declared**, added here because the paragraph above is where the next reader looks. The parenthetical "(slider: min/max/step live)" is a *renderer* verdict and had been read as an enforcement one; the two split. **Renderer-live:** objectui `packages/fields/src/widgets/SliderField.tsx:14` reads `field.step ?? 1` and passes it to the Slider, and `packages/spec/liveness/field.json` ledgers `step` as `live` on exactly that evidence — so it is *not* a prune candidate and never joins the pruned `showValue` / `marks` beside it. **Not a value constraint:** the numeric branch of `packages/objectql/src/validation/record-validator.ts` enforces `min`/`max` for `slider` and reads `step` nowhere; an off-grid stored value is accepted. Maintainer ruling 2026-08-08 — **ledger, do NOT enforce** (the ADR-0049 "ledger" half): the settings-side ruling (#6199 / PR #6501, which enforced that schema's `step`) does not transfer, because its hook was the settings schema's own "numeric bounds and step" comment grouping `step` with `min`/`max`, absent from this declaration ("Step increment for slider (default: 1)"); and enforcing a grid would create a stored-data hazard for zero measured demand — `record-validator` judges **updates to existing rows**, so already-stored off-grid values would start failing validation on their next edit. The only declaration in the repo is the showcase's `f_slider` (`min: 0, max: 100, step: 5`). Should grid enforcement gain real user pull, it returns as a feature request in PR #6501's shape: anchor at `min + k * step` (falling back to 0 when no `min` is declared) plus an epsilon-tolerant comparison. Mirrored as a comment beside the declaration in `packages/spec/src/data/field.zod.ts`.

**flow (5)**: `description` / `template` (no reader); `active` (deprecated, redundant with `status`); `nodes.outputSchema` (never validated); `nodes.boundaryConfig` (drives the dead BPMN `boundary_event`); `errorHandling.fallbackNodeId` (engine uses per-node fault edges). *Special:* `flow.status` — currently doesn't gate (engine uses an in-memory `flowEnabled` map); **WIRE** `status` → the enable map, or accept it's display-only and prune. Product call.

**tool (5)**: `category` / `requiresConfirmation` / `permissions` / `active` / `builtIn` — cosmetic on a write-only projection. Prune. *(The deeper question — make `tool` metadata authoritative vs stop projecting a schema that implies authorability — is a design decision, not a prune; track separately.)*

**action (3)**: `execute` (deprecated, auto-migrated to `target`); `shortcut` (registered but no keydown listener); `bulkEnabled` (no spec-driven path calls `executeBulk`); `timeout` (server uses `body.timeoutMs`). Prune (or wire shortcut/bulk if wanted).

**hook (1)**: `label` **or** `description` — keep one for docs, drop the redundant other.

**role (1)**: `parent` — manager rollup unimplemented (org hierarchy uses `sys_department`). **PRUNE** now; re-introduce with the hierarchy feature, or **DEFER-M2** if roadmapped.

**skill (1)**: `triggerPhrases` — no intent matcher exists. **PRUNE** (remove the misleading "activates this skill" framing) or **ENFORCE** if intent-routing is on the roadmap.

---

## Execution guidance

- **Pruning is low-risk and mechanical**: each is a spec property removal + ledger entry removal; CI (`validate`/seed fixtures + the liveness gate) catches anything that authored the removed prop. Batch by type into a few PRs (one per type keeps review tight). Estimated: object + field prunes are ~2 PRs covering ~46 of the 64.
- **Wire-rename** items are bug-fixes; the renderer-side ones (`referenceFilters`, `action.disabled`) land in **objectui**.
- **ENFORCE-or-PRUNE (P0)** items need a one-line product decision each; default to **prune** (remove the false promise) unless there's a committed roadmap, per ADR-0049.
- After each prune/enforce, the liveness ledger updates and the gate stays green — the loop closes.

## Sequencing recommendation

1. **P0 first** (8 props) — false-compliance is the trust risk; mostly prunes, fast.
2. **P2 object + field prune** (~46 props) — biggest surface reduction, low risk, high signal ("the spec got honest").
3. **P1 wire-rename** — schedule the framework-side ones; file the objectui ones in that repo.
4. **Remaining P2** (flow/tool/action/hook/role/skill) — opportunistic.

The security cluster already handled by ADR-0049 (Policy tree, `allow{Transfer,Restore,Purge}`, SharingRule, flow `runAs`) is **not** re-listed here — those are `experimental`/M2, not `dead`.
