---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the environment list offers only "Set up your production environment"; the development-environment door is gone

Clause-②: no
Metadata-protocol: none

Each organization now has exactly one environment, its production environment: the development environment type is retired (objectstack-ai/cloud#3487, ruling D). The Console's `sys_environment` list follows.

- **Toolbar.** "Set up your production environment" is the only creation path. Once the organization owns its production environment, the `create_environment` action is withheld: no "Add development environment" button, no "Development environments · Team plan and up" locked mark, no dialog and no POST. The list's other toolbar actions render as before, and the `?runAction=create_environment` deep link is consumed and runs nothing in that state. The loading skeleton and the no-signal fallback (the action's metadata label) are unchanged.
- **Dialog.** `entitlementDialogFromError` maps `PRODUCTION_ENV_LIMIT` only. `DEV_ENV_PLAN_LOCKED`, `DEV_ENV_LIMIT` and the control plane's new `DEV_ENV_RETIRED` take the ordinary error path and show the server's own message.
- **State.** `EnvironmentEntitlementsState` drops `canCreateDevelopmentEnv`, and the summary type drops `development`; `EnvironmentCtaKind` is now `'setup_production' | 'production_exists'`. None of these is exported from `@object-ui/app-shell`.
- **i18n.** Removed from every locale bundle: `planTier.teamAndUp` (the namespace goes with it), `environment.addDevelopment`, `environment.developmentLocked`, and `environment.entitlement.{planLockedTitle, planLockedBody, limitTitle, limitBody, limitBodyWithCount, freePlan, namedPlan, upgradeCta}`. A host that read one of these keys through `t()` now gets the key back; there is no replacement, because nothing is left to label.
