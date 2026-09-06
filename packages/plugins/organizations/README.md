# @objectstack/organizations

The multi-organization runtime: single-database, row-level Organization isolation for
ObjectStack. Installing this package is what turns the organization wall **on** — it
registers the `org-scoping` service that `@objectstack/plugin-security` probes and that the
Setup navigation's `requiresService: 'org-scoping'` gates key on.

Recorded in [ADR-0132](../../../docs/adr/0132-multi-organization-runtime-is-open-core.md).
The machinery shipped here originally, moved to a closed runtime under cloud ADR-0081 D2,
and has now returned to open core; only the commercial **entitlement** stayed behind.

## What it does

- **`organization_id` auto-stamp on insert.** Every authenticated insert into an object
  that declares `organization_id` is stamped from `ExecutionContext.tenantId`. A user
  cannot choose which organization a row lands in: a supplied — possibly forged — value is
  overwritten, never trusted. On-behalf writes running under a system context are untouched.
- **Per-org seed replay.** After a `sys_organization` insert, the app's *own* seed datasets
  are replayed into the new organization. ⛔ Never another organization's rows: a new
  organization's data comes from the app's seed definitions, or it starts empty.
- **Default-organization bootstrap.** Ensures the platform admin has an organization to
  operate in, idempotently, on `kernel:ready` and after the writes that can move the "who is
  the platform admin" answer.
- **Walled-posture membership-policy gate.** A deployment that raises the wall must
  *declare* what a new user joins. Running the framework default `auto` merely because
  nobody configured it refuses the boot, with a message that names the remedy.

## Install

```bash
pnpm add @objectstack/organizations
```

```ts
import { OrganizationsPlugin } from '@objectstack/organizations';

await kernel.use(new OrganizationsPlugin());
```

Register it **before** `SecurityPlugin`, so the posture probe finds the service.

> ⚠️ `objectstack serve` does not yet mount this package off `OS_TENANCY_POSTURE` — it
> still resolves one hard-coded runtime spelling from the host app. Wiring `serve` to this
> registrar, so an open install can set `OS_TENANCY_POSTURE=isolated` and boot with the wall
> active, is tracked separately and is not delivered by shipping this package.

## Key exports

| Export | Kind | Description |
|:---|:---|:---|
| `OrganizationsPlugin` | class | The plugin. Registers the `org-scoping` service, the two ObjectQL middlewares and the boot gate. |
| `OrganizationsPluginOptions` | type | Constructor options — currently `ensureDefaultOrganization`. |
| `OrgScopingPlugin` | alias | Alias of `OrganizationsPlugin`, matching the package name. |
| `OrgScopingPluginOptions` | alias | Alias of `OrganizationsPluginOptions`. |
| `claimOrphanOrgRows` | function | One-time back-fill of `organization_id` on orphaned seed rows, for the first organization. |
| `claimOrgSeedOwnership` | function | Hands an organization's seeded rows to its owner (`owner_id` back-fill, scoped to one org). |
| `ensureDefaultOrganization` | function | Multi-org flavour of the default-org bootstrap; wraps the open `plugin-auth` helper and adds the per-org seed-ownership handoff. |
| `assertWalledMembershipPolicyDeclared` | function | The boot gate: throws unless a walled deployment declared its membership policy. |
| `isWalledMembershipPolicyError` | function | Structural discriminator for that refusal — survives duplicate module instances. |
| `readMembershipPolicyDeclaration` | function | Total read of what the deployment declared, and where it came from. |
| `walledMembershipPolicyFatalMessage` | function | The operator-facing refusal text. |
| `WalledMembershipPolicyError` | class | The refusal. |
| `organizationsPluginManifestHeader` | const | Manifest header shared by compile-time config and runtime registration. |

## Boundaries

⛔ This package carries **no licence check of any kind** and offers no hook for one
(ADR-0132 boundary 3). Commercial gating of multi-organization operation lives in a private
package of the same name, whose class `extends OrganizationsPlugin` and answers its own
licence gate in its own constructor.

That shared name is the mechanism, not a collision. Which class a deployment mounts is
decided by the manifest that **declares** the name: a commercial host declares
`"@objectstack/organizations": "workspace:*"`, which pnpm resolves only to its local
workspace package and never to the registry; an open install declares the same name from
npm and gets this package. `objectstack serve` reaches it through a host-anchored importer
that refuses a package the served app has not declared, so the resolution base is always
the app's own manifest.

## License

Apache-2.0
