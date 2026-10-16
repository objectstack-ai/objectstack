---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/core': patch
'@objectstack/platform-objects': patch
---

feat(spec)!: retire the delegated-admin scope's `manageBindings` and `authorEnvironmentSets` — rights no door honoured (#23488)

**BREAKING** — `manageBindings` and `authorEnvironmentSets` on a permission set's `adminScope` (`AdminScopeSchema`, ADR-0090 D12) are now refused at parse. They named the right to bind sets to positions and the right to author environment permission sets, and they gated the `sys_position_permission_set` and `sys_permission_set` rows, which ADR-0131 D3 retired. A position's sets are part of its definition and a permission set is a definition; both are written through the metadata door, which admits a `manage_metadata` holder and reads no `adminScope`. So a delegate who "may bind" or "may author" was granted nothing. Delete both keys: a delegate's scope is placement, assignment and the allowlist.

Clause-②: yes (narrowing)

Measured before removal, at `cdc42eb49`: no production author set either key to `true` (the showcase wrote the default `false`; the control key `manageAssignments: true` has four production authors), and no door that writes a position or a permission set consulted either key. Their one reader was the delegated-admin gate's strict-containment comparison, which changes below.

## FROM → TO

| you wrote (17.7 and earlier) | write instead |
| --- | --- |
| `adminScope: { …, manageBindings: true \| false }` | nothing — delete the key |
| `adminScope: { …, authorEnvironmentSets: true \| false }` | nothing — delete the key |
| a delegate who re-composes what a position distributes, or authors a set's body | a `manage_metadata` holder writes the position or set definition through the metadata door (ADR-0131 D3); the delegate assigns people to positions and grants allowlisted sets inside its subtree |
| reading `scopes[].manageBindings` / `scopes[].authorEnvironmentSets` from `GET /api/v1/security/my-delegable-scope` (`DelegableAdminScope`) | nothing — the report carries `manageAssignments` as the scope's one action right |

**The one-line fix:** delete `manageBindings` and `authorEnvironmentSets` from every `adminScope`.

**What an author who still writes either sees.** `tsc` fails at the authoring site (`AdminScope` types both keys as retired), and the parse — `definePermissionSet()`, `defineStack({ permissions })`, `PUT /api/v1/meta/permission/:name` — refuses it at its own path with the prescription:

> `permission.adminScope.manageBindings` was removed in @objectstack/spec 18 (ADR-0049 enforce-or-remove, ADR-0090 D12) — nothing honoured it once the position-to-permission-set binding rows it gated were retired: a position's sets are part of its definition (ADR-0131 D3), and that definition is written through the metadata door, which admits a `manage_metadata` holder and reads no adminScope. Delete the key; a delegate's scope is placement, assignment and the allowlist — `businessUnit` with `includeSubtree`, `manageAssignments`, and `assignablePermissionSets`. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.

## The containment change (`@objectstack/plugin-security`)

The delegated-admin gate judges a delegate who hands out a set that itself carries an `adminScope` — a `sys_user_position` assignment of a position that distributes it, or a direct `sys_user_permission_set` grant — by **strict containment**. That comparison read both retired flags. It now reads `includeSubtree`, `manageAssignments` and the allowlist only:

- a delegate whose own scope set either flag `true` can **no longer** hand out a scope otherwise EQUAL to its own — the inert flag used to count as the strictly-larger axis and let that lateral copy through the equal-scope refusal. It is refused `403 PERMISSION_DENIED` (`… would hand out an adminScope not strictly contained by yours`);
- a granted scope that set either flag `true` no longer counts as out-reaching a delegate that did not.

`DelegatedAdminGate.describeDelegableScope()` (and so `GET /api/v1/security/my-delegable-scope`) no longer reports either flag.

## The retirement kit

- **Two `retiredKey()` tombstones** on `AdminScopeSchema`, a `strictObject` — so each refusal carries its prescription and `tsc` fails first. `RETIRED_KEYS_BY_MAJOR[18]`: `security/AdminScope:manageBindings`, `security/AdminScope:authorEnvironmentSets`. `DelegableAdminScope` (`@objectstack/spec/contracts`) drops both fields.
- **The D2 conversion `permission-admin-scope-binding-authoring-removed`** (protocol 18, retired from the load path) deletes both keys from every `permissions[].adminScope`, one notice per key, whatever they hold. Both keys carried the default `false`, so a 17.x parse materialized them in every declared scope; the rehydration seams replay this conversion over stored `permission` rows and built artifacts, and `os migrate meta --stored` lists the rows that carry them before the upgrade.
- **The D3 entry `permission-admin-scope-binding-authoring-retired`** records the containment change above: the judgement the strip cannot make for the upgrader.
- **`@objectstack/core`:** `permissionSetDefinitionFromRow` — the mapping `os migrate`'s legacy-row ceremony saves a `sys_permission_set` row through — drops both keys from the row's `admin_scope`. That save goes through `saveMetaItem`, which replays no conversion: measured, a 17.x row's body answered `422 INVALID_METADATA` at `adminScope.manageBindings`, and the same body without the keys saved.
- **`@objectstack/platform-objects`:** the permission-set form's `adminScope` help text (all four locales) names the scope's live keys only.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for. Studio's two switches for these keys retire in an objectui follow-up.

<!-- adr-0087: registered permission-admin-scope-binding-authoring-removed, permission-admin-scope-binding-authoring-retired -->
