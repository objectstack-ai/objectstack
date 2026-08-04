---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `allowRuntimeCreate: false` is enforced on every kernel — `PUT /meta` no longer creates `job` / `agent` items the registry declares code-only (#5086)

#4509 set `allowRuntimeCreate: false` on `job` and promised the refusal without
qualification — *no "create job" in Studio or via `PUT /meta`*. ADR-0063 §2 says
the same for `agent`. The gate that keeps that promise existed, and worked, but
it sat behind `environmentId !== undefined`:

```ts
if (this.environmentId !== undefined) {
    // …not_overridable / not_creatable…
}
```

`environmentId` is a **row-scoping key**, not an authorization signal. Every
kernel assembled without one ran with the entire ADR-0005 authorization gate
disengaged — and that is not an exotic topology. The CLI's lightweight
assembler builds exactly that for a host config (`isHostConfig` → the
`createStandaloneStack` branch is skipped → `new ObjectQLPlugin()` with no
`environmentId`), which is the flagship showcase and every self-hosted app
server shaped like it. On those, the issue's repro answered:

```
PUT /api/v1/meta/job/rc3_runtime_job
    {"name":"rc3_runtime_job","label":"J",
     "schedule":{"type":"cron","expression":"0 0 * * *"},"handler":"nope"}
→ 200 {"success":true,"message":"Saved customization overlay (env-wide) — type=job, …"}
```

`handler: "nope"` names no function in any compiled bundle. The row persists,
lists, and can never be scheduled — the record #4509 exists to prevent, saved
and reported as success. It is the ADR-0049 failure mode one level up: the
*enforcement flag itself* was the silently-inert declaration, and Studio (which
reads the flag to hide "create") honoured a rule the API underneath did not.

**What changed.** A type whose registry entry sets BOTH `allowRuntimeCreate:
false` AND `allowOrgOverride: false` declares that it has no runtime write
channel at all. `saveMetaItem` now refuses it on every kernel, before
persistence, in draft mode as well as publish:

| write | before | now |
|---|---|---|
| `PUT /meta/job/*` on a single-kernel host | `200 success` | `403 NOT_CREATABLE` |
| `PUT /meta/agent/*` on a single-kernel host | `200 success` | `403 NOT_CREATABLE` |
| same, over a name a code package ships | `200 success` | `403 NOT_OVERRIDABLE` |
| project-scoped (cloud) kernels | `403` | `403` (unchanged) |

The refusal names the type, the flags that produced the verdict, the source
file pattern to declare it in (read from the type's own registry entry, so a
newly-flagged type carries an accurate hint the day it is flagged) and the
`OS_METADATA_WRITABLE` escape hatch.

**Scope, deliberately.** The rest of the ADR-0005 two-tier gate keeps its
single-kernel carve-out: that ADR's "single-kernel deployments keep their
existing behaviour" sentence is about the *overlay whitelist*, predates
`allowRuntimeCreate` entirely, and a type that stays runtime-creatable
(`object`, `hook`, `field`, `seed`, `mapping`, …) is untouched here. So is
`deleteMetaItem` — removing a code-only row that predates this refusal is
repair and must stay possible. `OS_METADATA_WRITABLE` remains the one door:
unlocking a type there unlocks it here too.

**Upgrading.** If a deployment relies on runtime-created `job` or `agent` rows,
move them into source (`**/*.job.ts`, `**/*.agent.ts`) and redeploy — a `job`
authored at runtime never had a reachable `handler` in the first place. To keep
writing them while migrating, set `OS_METADATA_WRITABLE=job,agent`.
