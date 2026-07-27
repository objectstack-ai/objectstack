---
"@objectstack/spec": minor
---

feat(spec)!: remove the orphaned `FeatureFlagSchema` module (`@objectstack/spec/kernel` feature.zod)

Follow-through of the capabilities-descriptor prune (#3605). `kernel/feature.zod.ts`
(`FeatureStrategy`, `FeatureFlagSchema`, the `FeatureFlag` factory and its
`FeatureFlag` / `FeatureFlagInput` types) had **zero runtime consumers**, and its
only protocol home — the static `ObjectStackCapabilities.system.features`
descriptor — was itself removed as dead in #3605 (no endpoint ever served it).
The module was a compile-checkable shape with nowhere to go: not authorable
(`defineStack` has no `features` key; strict parsing strips it), not registered,
not read by any engine.

**Migration — flags are runtime configuration, not authored metadata:**

| Removed | Live replacement |
| --- | --- |
| `FeatureFlagSchema` / `FeatureFlag.create()` rollout documents (strategies, percentage/group conditions) | the `feature_flags` **settings manifest** (`@objectstack/service-settings`, ADR-0007) — org-tunable `ai_enabled` / `beta_*` toggles, env-overridable via `OS_FEATURE_FLAGS_*` |
| deployment-level capability gating | `PUBLIC_AUTH_FEATURES` registry (`kernel/public-auth-features.ts`) + `requiresFeature` sugar on actions/params (unchanged, live) |
| runtime capability discovery | `GET /api/v1/discovery` (dynamic, declared === enforced) |

Docs regenerated (`references/kernel/feature.mdx` removed); the platform skill's
Feature Flags section and the hand-written quick-reference row now point at the
settings surface; `PROTOCOL_MAP.md` row dropped.
