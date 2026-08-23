---
"@objectstack/runtime": minor
---

fix(runtime): the background drift check introspects the datasource it was armed for (#10961)

`ExternalValidationPlugin.scheduleDriftChecks` arms one `setInterval` **per
datasource** — one timer for each datasource declaring
`external.validation.checkIntervalMs`. Every tick asked the `external-datasource`
service for `validateAll()` — every federated object on every federated
datasource, each validation driving a live `introspect(datasource)` remote-schema
read — and then kept only the rows whose `datasource` matched the one that timer
was armed for. The emitted events were right; the **work** was the whole farm.

This is the periodic twin of the request-gate defect fixed in
`POST /datasources/:name/external/validate`, and worse in the one way that
matters: a request gate has a caller waiting on the answer and watching the
latency, while this is **unattended**. The fan-out repeated on every interval of
every armed datasource, forever, with nobody reading the rows it discarded.

Measured at the branch point against the real `ExternalDatasourceService` over a
recording introspector, on a fixture with three federated datasources: a single
tick armed for `wh_a` introspected `['wh_a', 'wh_b', 'wh_c']`; two armed timers
introspected **six** remotes in one cycle where two were asked for; three ticks
of one timer introspected nine. A timer armed for a name nothing is bound to
still dialled all three, to produce the empty result it already had.

Each tick now calls the scoped `validateDatasource(datasource)` — the twin
composed service-side from the same primitives (`listObjects` → filter →
`validateObject`) with the same federation predicate, so it returns row-for-row
what the post-filter kept. **No change to what is emitted**: the same
`external.schema.drift` event per drifted object, the same payload, the same
`onMismatch` policy handling, and the same "never throws" contract for a
fire-and-forget timer. Same tick, `['wh_a']`; two armed timers, two remotes; an
unbound name, none.

Unchanged: `validateAll()` itself, and the **boot** gate
(`ExternalValidationPlugin.runValidation`), whose subject genuinely is every
federated object in the environment.

## What you may newly see, and why this is a `minor`

`validateDatasource` is deliberately **not** on `IExternalDatasourceService` —
the contract offers `validateObject(objectName)` and `validateAll()`, and adding
a per-datasource spelling to it is a spec-surface decision to take on its own
terms. So the plugin **probes** for the scoped spelling, and a registered
service that does not have it is **declined** rather than served by the fan-out:
a silent fallback would leave the old unattended sweep reachable on a path no
test drives, in exactly the deployments nobody is looking at.

If you register your own `external-datasource` service — a
contract-conforming implementation has no reason to carry `validateDatasource`
today — background drift checking for that host now stops, where it previously
worked via the sweep. That narrowing, not the scoping fix, is what earns a
`minor`: it is visible to embedders and it is quiet by design.

**Quiet, deliberately.** The REST route answers `503` for the same absence; a
background timer must not. There is no caller waiting on this check, so "loud"
would mean spraying errors at nobody or manufacturing 5xx noise from a check
nothing requested. The honest degradation for an unattended checker is to not do
the thing and record why: no events, no throw, one `warn` naming the consequence
(drift on that datasource is not being watched) and the fix — register a service
that can validate a single datasource, or drop `external.validation.checkIntervalMs`
so nothing is armed. `warn`, not `error`: nothing claimed to have been persisted,
so this is a functional degradation, not a durability one.

The probe re-runs on every tick and its verdict is cached nowhere, so a service
registered after the timers were armed starts being checked on the next interval.
