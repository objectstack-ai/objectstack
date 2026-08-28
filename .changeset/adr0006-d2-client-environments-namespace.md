---
"@objectstack/client": minor
"@objectstack/cli": minor
---

feat(client,cli)!: `client.projects.*` becomes `client.environments.*`, the scoped sub-client becomes `ScopedEnvironmentClient`, and the unwrap keys follow the wire (#12866, #12882, ADR-0006 D2)

<!-- adr-0087: not-required (runtime-interface-only packages/client/src/index.ts#ObjectStackClient) The renamed surface is a member of a published runtime TypeScript class and the response-key shapes it declares inline. There is no Zod schema, no `packages/spec` declaration, no authorable key and no stored representation behind either half — measured 2026-08-28: zero `projects` envelope contracts anywhere in `packages/spec/src`, positive control being that `environments` hits do exist there. So `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The channel that reaches every affected consumer is the COMPILER, at the call site, which is strictly more precise than a ledger line; the wire half is carried by the paired control-plane release in the same coordinated window. MEASURED CAVEAT, recorded here rather than worked around: this claim is REFUSED by check-adr-0087-registration at step 4, because `packages/spec/src/api/contract.zod.ts` names `ObjectStackClient` in a JSDoc PROSE comment (line 164, describing what `unwrapResponse` keys on) while neither declaring nor importing it, and the predicate does not strip comments before scanning a metadata surface for references. Steps 1-3 pass. The disposition is left stated rather than swapped for `no-migration-prescription`, which would mechanically pass only through a detector blind spot while contradicting the migration table below it — the exact anti-pattern this gate's own header records as #8299. -->


**BREAKING** public-API rename on `@objectstack/client`, and a breaking change to
the `--format json` payload of the `os environments` command family. It lands
after the v17.0.0 cut, so the lockstep launch-window convention ships it as
`minor` (`scripts/check-changeset-no-major.mjs`); the version number is not the
migration signal here, this entry is.

This is the **SDK half** of one coordinated cross-repo rename. The **producer
half** is the cloud control plane, which renames the same field keys on the same
endpoints. Neither half ships alone: shipping the SDK half by itself is
ADR-0006 D3, permanently declined, as is any mapping layer between the two
spellings.

## Migration

**No aliases exist.** The old namespace is gone, not deprecated — there is no
`client.projects` getter, no `res.project ?? res.environment` hedge, and none is
coming (ADR-0006 D3 declined a mapping layer with reasons; the v5.0 rename rule
「no aliases」 is the standing one). Every call site moves in one edit.

### Method namespace

| before | after |
| --- | --- |
| `client.projects.list(…)` | `client.environments.list(…)` |
| `client.projects.get(id)` | `client.environments.get(id)` |
| `client.projects.create(req)` | `client.environments.create(req)` |
| `client.projects.update(id, patch)` | `client.environments.update(id, patch)` |
| `client.projects.delete(id, opts)` | `client.environments.delete(id, opts)` |
| `client.projects.activate(id)` | `client.environments.activate(id)` |
| `client.projects.rotateCredential(…)` | `client.environments.rotateCredential(…)` |
| `client.projects.updateHostname(…)` | `client.environments.updateHostname(…)` |
| `client.projects.updateVisibility(…)` | `client.environments.updateVisibility(…)` |
| `client.projects.listRevisions(…)` | `client.environments.listRevisions(…)` |
| `client.projects.listBranches(id)` | `client.environments.listBranches(id)` |
| `client.projects.renameBranch(…)` | `client.environments.renameBranch(…)` |
| `client.projects.deleteBranch(…)` | `client.environments.deleteBranch(…)` |
| `client.projects.retryProvisioning(id)` | `client.environments.retryProvisioning(id)` |
| `client.projects.listDrivers()` | `client.environments.listDrivers()` |
| `client.projects.packages.*` | `client.environments.packages.*` |

The URL paths are unchanged — they were already on the `environments` spelling
(`/api/v1/cloud/environments/…`). Only the method namespace and the response
field keys move.

### Response keys

| before | after | where |
| --- | --- | --- |
| `res.projects` | `res.environments` | `list` (the `total` key is unchanged) |
| `res.project` | `res.environment` | `get`, `update`, `activate`, `updateHostname`, `updateVisibility`, `retryProvisioning` |

The joined blocks on `get` (`database`, `credential`, `membership`,
`organization`) keep their names, as do every `packages.*` key, the
`delete`/`listBranches`/`renameBranch`/`deleteBranch` payloads (already
`environmentId`-keyed), and `listRevisions`.

### Two declarations that were false before this change

Measured 2026-08-28 against the cloud repo's `main`, and corrected here rather
than carried forward under a new spelling:

- **`create` never answered a `project` key at all.** `POST /api/v1/cloud/environments`
  has always answered `{ environment, warnings, durationMs, hostnameAssignment? }`.
  The old `{ project: any; database: any }` declaration was not merely
  pre-rename, it was wrong against the running control plane — and
  `os environments create` read `res.project.id` through it, so the default
  `--activate` silently never activated and the table output printed
  `undefined`. Both are fixed by this rename.
- **`create` declares no `database` key.** That route does not send one; the key
  was declared NON-optional, so `res.database.driver` typechecked and threw. The
  method that really answers a `database` block is `get`, which keeps it.

The keys `create` does send beside `environment` (`warnings`, `durationMs`,
`hostnameAssignment`) are deliberately still undeclared — adding them is new
published surface and a separate decision.

### The environment-scoped sub-client (#12882)

The fourth `project`-spelled surface on the same class, folded in by the same
maintainer ruling. ADR-0006's D1 census named three surfaces and missed this one;
it was an oversight, not a deliberate retention.

| before | after |
| --- | --- |
| `client.project(id)` | `client.environment(id)` |
| `ScopedProjectClient` (exported class) | `ScopedEnvironmentClient` |

Same no-alias rule: neither old spelling survives. `client.project(id)` is not a
deprecated method, it is gone, and the exported class is gone under its old name
— a `import { ScopedProjectClient }` fails at the import line, which is the
loudest and most precise channel this change has.

Nothing about the behaviour moves: the scoped client still prefixes
`/api/v1/environments/:environmentId/...`, still exposes the same `data` / `meta`
/ `batch` / `packages` shape, and the thrown guard message becomes
`[ObjectStack] environment(id): environmentId is required`.

**Deliberately NOT renamed, because each is a different surface needing its own
decision:** `setProjectId` / `getProjectId` on the client — `getProjectId` is a
cross-package protocol contract that `packages/runtime` and
`packages/metadata-protocol` both speak, so it is a coordinated rename, not a
local one — and the REST API config keys `enableProjectScoping` /
`projectResolution`, which are live keys read by `packages/cli/src/commands/serve.ts`.
The docblocks that name them are worded so they stay true.

Note for whoever compiles the release notes: four other pending changesets in
this release describe methods on `ScopedProjectClient` under its old name
(`client-unannotated-return-erasure`, `client-saveitem-ifmatch-header`,
`client-meta-saveitem-query-options`, `client-precise-sdk-return-types`). They
were accurate when written and are deliberately left alone; this entry is the one
that renames the class.

### JSDoc

The `create` docblock claimed the server delegates to
`ProjectProvisioningService.provisionProject`. That spelling has zero hits in the
control plane (measured 2026-08-28). Both this SDK's docblock and
`os environments create`'s now name the **endpoint** instead, which is the one
identifier an in-repo reader can verify — the class lives in a repo this one
never compiles against, so no gate here could ever have caught the rot.

## CLI

`os environments list | show | create | switch | bind` follow the same rename.
No flag, argument, exit code or command id changes. `--format json` / `--format yaml`
payloads are `formatOutput(res, …)` straight from the control-plane response, so
their top-level keys change with the wire: a script reading `.projects` or
`.project` from those payloads reads `.environments` / `.environment` instead.
