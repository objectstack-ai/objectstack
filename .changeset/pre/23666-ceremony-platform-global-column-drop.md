---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership --apply` drops `organization_id` from an object the host declares platform-global when its fate is `column-drop`, for a host that brings its own engine plugin (ADR-0131 D7, D10 fate 1)

Clause-②: no

ADR-0131 D7: an object a deployment declares platform-global (the `org-scoping` service's `platformGlobalObjects`) gets no organization column on that deployment. The engine installs that declaration at the top of `ObjectQLPlugin.start()`, before it hands any object to its driver.

**FROM.** A host config that brings its own `ObjectQLPlugin`, under the framework's plugin name, displaces the CLI's engine, and the migration boot composes host plugins for their declarations only, so that engine's `start()` does not run. The boot's own binding pass (the one that hands every declared object to its driver in place of that `start()`) did not install the declaration. Every object the host declared platform-global was planned with its organization column. The schema-drift ceremony therefore proposed no drop, and the ceremony's column-drops step blocked on a `column-drop` fate for such an object with "was not proposed for dropping by the schema-drift ceremony". `os migrate plan` showed no drift for the column either.

**TO.** The binding pass installs the declaration first, as `start()` does, through the same reader (`readDeploymentOrgScopingEntitlement`, `@objectstack/core`) and the registry's own re-plan. A declared object is planned without the column, the drift proposes its drop, and the column-drops step drops it through the schema-drift ceremony. `os migrate plan` lists the column as an unmapped, destructive column, as a served boot of the same stack plans it, and the plan's notes name the objects re-planned.

**Unchanged.** A host whose engine is the CLI's own already had the declaration installed by that engine's `start()`, and installing it again re-plans nothing. An object the host does not declare platform-global keeps its column, and a `column-drop` fate on it still blocks with `not-proposed`. A declared object whose column still holds a category's rows still blocks before any drop.
