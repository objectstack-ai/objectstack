---
"@objectstack/runtime": minor
---

fix(runtime): `/automation` run-state reads require the `sys_automation_run` read grant (#7900)

**⚠️ BEHAVIOUR NARROWING — pre-grant before you upgrade.** Operator tooling that
read automation run detail with bare authentication now needs read access to the
`sys_automation_run` object. See the migration note at the bottom.

**What was open.** `GET /automation/:name/runs/:runId` answered with
`deps.success(run)` — the `ExecutionLogEntry` verbatim, no projection, no
redaction, no masking, on any field. The only gate on that path was the #5519
anonymous baseline, applied to the whole `/automation` domain rather than per
route, so the sole question the surface asked was *"are you authenticated?"*. Any
authenticated caller who knew a run id read whatever that run's log entry held —
including, through the variables snapshot and through `output`, the triggering
record's fields, **with that record's own field-level security never applying**.
`GET /:name/runs` served the same entries a page at a time, gated the same way.

The identical snapshot has always had a second, differently-gated door:
`sys_automation_run.variables_json` persists it for every paused run, and that
read goes through the system object's permissions. One platform, two answers,
depending on which door you knocked on.

**What this does — converge the two doors** (maintainer ruling, 2026-08-12). Both
run-state reads now consult the same permission the `sys_automation_run` object
read answers with: `ISecurityService.explain({ object: 'sys_automation_run',
operation: 'read' })`, which runs the same permission-set resolution, the same
`PermissionEvaluator` and the same RLS compiler the enforcement middleware runs.
No new permission system, no new cross-package seam — the `security` slot was
already on `DomainHandlerDeps`. A caller without the grant gets **403
`PERMISSION_DENIED`**, and the automation service is never consulted, so the
snapshot is not even loaded. A caller **with** the grant reads exactly what they
read before, byte for byte.

**Not** per-field filtering of `variables` — explicitly rejected by the ruling, on
the measurement that the map's keys (`.`, `record`, `previous`, `$runId`, seeded
inputs) are not decidably record fields, so a per-field rule is one an
implementation can get quietly wrong.

**The rest of the domain was audited against the same rule**, and the routes that
stay authenticated-only carry their reason in the source rather than in silence:
`GET /`, `GET /:name`, `GET /actions`, `GET /connectors` and `GET /_status` serve
flow-definition and registry data, not `sys_automation_run`-class data, so the
grant this ruling names says nothing about them and requiring it would invent a
second policy rather than converge one. `GET /:name/runs/:runId/screen` is the
interactive runner's refresh-safe re-fetch for the caller the flow paused *for*,
and its write sibling `resume` already answers on the engine's per-run
`resumeAuthority` axis; its residual disclosure (a screen's defaults are
interpolated against live flow variables) is filed separately rather than closed
by an operator grant that would refuse the end user.

Three non-denials, each deliberate: a **system** context passes (the middleware's
own first bypass); a deployment with **no `plugin-security`** passes, because
there is no object-permission system for either door to consult and refusing
would put them in disagreement the other way; a **partial** security service that
omits `explain` degrades rather than throwing. An `explain` that throws is a
denial — an access-narrowing answer fails closed.

---

### Migration

Deployments upgrading to this release should **pre-grant before upgrading**.

Any identity that reads automation run history or run detail over HTTP —
operator dashboards, monitoring pollers of `GET /automation/:name/runs?status=failed`,
support tooling that opens a run by id, scripted health checks — must now hold
**read on `sys_automation_run`** in one of its permission sets:

```ts
permissions: [{
  name: 'automation_operator',
  objects: { sys_automation_run: { allowRead: true } },
}]
```

Nothing else changes for a caller that already holds it: the response body is
unchanged, including the full `variables` map. Service/system-context callers and
the engine's own internal paths are unaffected — neither goes through this seam.
Screen-flow end users are unaffected: the screen re-fetch is not gated.
