---
"@objectstack/spec": minor
"@objectstack/cli": patch
"@objectstack/metadata": patch
---

feat(spec)!: the `@objectstack/spec/cloud` subpath is removed — the cloud control plane's contracts leave the open-source spec, and the package & marketplace format moves to `@objectstack/spec/marketplace` (#16325)

<!-- adr-0087: registered cloud-subpath-retired -->

**BREAKING** — a published subpath export of `@objectstack/spec` is deleted, with no
alias and no deprecation window (maintainer, 2026-08-27, verbatim: 「项目在创业阶段，
用户也很少，短期不考虑渐进。」). Shipped as `minor` under the repo's launch-window
convention, in which `major` is refused by `check-changeset-no-major` and breaking-ness
is carried by this banner plus the ADR-0087 disposition; the hand-migration prescription
is registered under protocol major 18 as `cloud-subpath-retired`.

## What moved, and why

Maintainer direction (2026-09-06, verbatim): 「我一直觉得 cloud 的协议应该放在云端，没必要开源」,
ruled option B "cut by owner" on #16325 (director batch #62, 2026-09-07, 「同意」).
`packages/spec/src/cloud/` held two families with different owners:

- **The cloud control plane's own contracts** — `environment.zod`, `environment-package.zod`,
  `tenant.zod`, `developer-portal.zod`, `marketplace-admin.zod`, `app-store.zod` (62 JSON-Schema
  defs, 2087 lines). Their producer and every consumer live in the closed cloud repo; the
  open-source tree read exactly one type from them. They are gone from `@objectstack/spec`:
  `environment` and `tenant` are re-declared in the cloud repo (objectstack-ai/cloud#2037), and
  the other four are deleted outright — zero consumers in any repo (#16526, ruled A). All of it
  is recoverable from git history at `d5d8d50db`.
- **The package & marketplace format** — `package.zod`, `package-version.zod`, `marketplace.zod`,
  `package-l10n`, `template-manifest.zod` (30 defs, 1400 lines). A package author needs it and the
  open-source CLI's `os package publish` speaks it, so it STAYS, relocated to `src/marketplace/`
  and published as `@objectstack/spec/marketplace`. Every def, key and JSON Schema is
  byte-identical under the new `$id` category (`RENAMED_DEFS`, 32 entries; nothing left the
  author-facing contract).

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `import { PackageSchema, CreatePackageRequestSchema, … } from '@objectstack/spec/cloud'` | `… from '@objectstack/spec/marketplace'` — same symbols, same shapes |
| `import { EnvironmentArtifactSchema } from '@objectstack/spec/cloud'` | `… from '@objectstack/spec/system'` (it was only ever a re-export of that declaration) |
| `import type { EnvironmentType } from '@objectstack/spec/cloud'` | `… from '@objectstack/spec/api'` (re-declared beside the discovery fold table that reads it) |
| `import { EnvironmentSchema, TenantPlanSchema, ProvisionEnvironmentRequestSchema, … } from '@objectstack/spec/cloud'` | no open-source replacement — these are the cloud repo's own declarations now |
| `/docs/references/cloud/<page>` | `/docs/references/marketplace/<page>` for the format pages (redirected); the control-plane pages have no successor |

Why the mis-binding hazard closes with this: `client.environments.*` keeps its erased `any`
deliberately (#11925/#12036), and the camelCase `Environment` row used to be the obvious-looking
binding for it — it compiled and read `undefined` at runtime against the snake_case wire. That
type no longer exists in the open-source package, so the wrong binding is structurally
impossible rather than warned about in a docblock.

`@objectstack/cli` and `@objectstack/metadata` change only an import path (`marketplace` and
`system` respectively); no behaviour moves.
