---
"@objectstack/lint": patch
---

`translation-target-unknown` no longer calls a locale key for a CONTRIBUTED navigation item an orphan — the remedy it printed deleted a translation the runtime honours (#18203)

`validateTranslationReferences` built the `apps.<app>.navigation.*` universe from the app's authored `navigation` array alone. An item injected by another package through `manifest.navigationContributions` (ADR-0029 D7, ADR-0130) is never in that array, so every locale key for it was reported as naming an item *"which app X does not declare"*, at `error` since 17.4.0, with the remedy *"Match the key to the navigation item's `id`, or drop it."*

⚠️ **That remedy is wrong in the worst direction a false positive can point: following it deletes a working translation.** Measured on `objectstack-ai/hotcrm` `be11c07` (pin 17.4.0), where a service module contributes five items into `crm_enterprise`:

| | measured |
| :-- | :-- |
| `os build` | **15** findings — 5 contributed items × 3 non-default locales |
| `GET /api/v1/meta/app?id=crm_enterprise` | returns all 5 items, `zh-CN` labels **resolved** from the app's own pack |

The universe now folds in every contribution aimed at the app, walked by the same `walkNav` a declared subtree gets, so what the rule judges is the population the runtime serves rather than the array the author typed.

**Both carriers are read**, because a stack in hand has two shapes and `os build` runs the rule table over both:

- `packages[].manifest.navigationContributions` — the ADR-0130 D4 artifact entry. This is the shape the per-package leg needs (`compile.ts` step 3b-ii): the app's owning package declares no contribution of its own, and the union run above it de-duplicates, so a fix reading only the union would have left that leg reporting the finding alone.
- `manifest.navigationContributions` — the stack's own `StackSchema.manifest`, where a single-`defineStack` project's contributions live. `os validate` judges only the union stack, so reading the artifact form alone would have left the fast inner-loop command still reporting what the build no longer does.

**The runtime's fold is deliberately not imported, and the union is faithful anyway.** `@objectstack/lint` depends on `@objectstack/spec` and never on a runtime; `applyNavContributions` is a `SchemaRegistry` method in `@objectstack/objectql`. A second implementation would normally be exactly the drift this class of defect is made of — except that the fold pushes the contributed items in *every* branch: into a `group` that resolves, at the app top level when the `group` id names nothing (a `nav_contribution_group_missing` diagnostic, never a refusal), and at the top level when `group` is omitted. It chooses **where** an item lands and never **whether**, so the set of addressable ids is invariant under it. All three placements are pinned side by side so that invariant cannot quietly stop holding.

**The control, which is the point of the change.** Widening a universe trades a false positive for a blind spot unless the genuine orphan still reports. A key that nothing contributes is still an `error` carrying `translation-target-unknown`, its path and its message; a contribution aimed at app B does not make its ids addressable under app A; and the contributed ids join the population the hint enumerates, so the remedy an author is handed lists what they may actually key to.

**What this still cannot see, stated rather than implied.** Contributions registered imperatively by plugin code (`engine.registerAppNavContribution` from a plugin's `init`) are not metadata, and no static rule can read them — that is the population `pnpm check:app-nav-i18n` has to boot a composition to judge. A locale key for one of those is still reported here.
