---
"@objectstack/runtime": patch
"@objectstack/metadata": patch
---

fix(runtime,metadata): the default local environment id is `env_local`, not `proj_local` (#13366)

The v5.0 `project` to `environment` rename changed the default local environment
id and shipped that change on the surfaces most people meet: `packages/cli`'s
`CHANGELOG.md` records "Default local env id: `proj_local` -> `env_local`", the
`os dev` / `os start` / `os serve` commands emit `env_local`, and
`content/docs/deployment/cli.mdx` documents `env_local` as the default. Two
sites never received it and kept stamping `proj_local`.

FROM: `createStandaloneStack()` — with no `environmentId` in its config and no
`OS_ENVIRONMENT_ID` in the environment — stamped `proj_local` on the kernel it
composed, and `MetadataPlugin` used `proj_local` to fill the environment-artifact
validation envelope for a bare definition.

TO: both stamp `env_local`.

WHO SEES IT. Only a host that calls `createStandaloneStack` (or
`createDefaultHostConfig`) **directly** and lets the id default. A boot started
by `os dev` / `os start` never reached the changed line: those commands export
`OS_ENVIRONMENT_ID=env_local` into the child process, which the fallback yields
to. Where the id is observable — row scoping in `ObjectQLPlugin`, the
`X-Environment-Id` header, `sys_metadata.environment_id` — such an embedder now
sees `env_local` where it saw `proj_local`, so an install with rows already
written under the old id should set `environmentId: 'proj_local'` (or
`OS_ENVIRONMENT_ID=proj_local`) explicitly to keep them addressed. That escape
hatch is unchanged and still wins over the default.

NOT CHANGED, deliberately: `@objectstack/cloud-connection` still treats BOTH
spellings as the local sentinel, so a persisted `OS_ENVIRONMENT_ID=proj_local`
config keeps being recognised as local rather than presented to the control
plane as a cloud environment id; and `package-state-store`'s separate `'default'`
fallback keeps its own spelling, because renaming it would re-key persisted
package-disable state files.
