---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-webhooks": minor
---

ADR-0029 D7 — Setup app navigation contributions.

Adds the UI-layer analog of object `own`/`extend`: a package can contribute
navigation items into an app it does not own, so a shared admin app can be a
thin shell while each capability plugin ships the menu for the objects it owns.

- **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
  priority, items }`) and an optional `navigationContributions` field on the
  manifest.
- **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
  plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
  cloning so the stored app is never mutated); the engine wires
  `manifest.navigationContributions` during app registration.
- **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
  empty group anchors; its entries for platform-objects-owned objects move to
  `SETUP_NAV_CONTRIBUTIONS`.
- **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
  the Setup app it already registers.
- **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
  `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
  `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
  cross-plugin contribution.

The rendered Setup nav is identical to the former static artifact — just
assembled from its owners. A disabled/absent capability contributes nothing and
its slot stays empty (in addition to the existing `requiresObject` gating).
This unblocks moving each remaining K2 domain's menu out of the monolith with
its objects.
