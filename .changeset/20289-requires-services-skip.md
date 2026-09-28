---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/cli': minor
---

feat(spec,core,cli)!: a scenario's `requires` is checked before it runs — unmet `params` or `services` SKIP it with a reason; `requires.plugins` is retired into `requires.services` (#20289)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

A Quality Protocol scenario's `requires` block declared preconditions —
`params` (environment variables) and `plugins` (plugins that must be loaded) —
that nothing checked: measured on a stub target, a scenario naming a missing
plugin and an unset variable reported PASSED exactly like its no-requirements
control. ADR-0049 enforce-or-remove, verdict ENFORCE (the mainstream has
declared preconditions: JUnit `@EnabledIfEnvironmentVariable`, pytest `skipif`),
ruled B for the shape: each key is judged against something `os test` can
actually observe.

- **`requires.params`** — each variable must be set to a non-empty value in the
  environment of the process running `os test` (not the target server's, which a
  suite cannot see). An empty value counts as unset: an unconfigured CI secret
  arrives as an empty string.
- **`requires.services`** (new) — each entry is a discovery service key
  (`CoreServiceName`: `auth`, `automation`, `analytics`, `ai`, `storage`, …; a
  misspelling is refused when the suite loads) that the target must declare
  `enabled` with status `available` in its discovery document (ADR-0076 D12).
  It is read from the discovery request the HTTP adapter already makes once per
  run; a suite that requires no service issues no extra request.
- **SKIPPED.** A scenario with an unmet entry runs no step — `setup` included —
  and `os test` prints it with its reason, naming every unmet entry and, for a
  service, the services the target does declare available:
  `Skipped: requires.services 'ai' is not available on the target (enabled: false, status: unavailable). The target declares available: auth, data, metadata.`
  It is counted on its own — `SUCCESS: 3 scenarios passed. 1 skipped (not run, not counted as passed).` —
  and never as passed. Skips alone exit `0`; a run in which EVERY selected
  scenario was skipped prints `No scenario ran: …` instead of `SUCCESS`, exits
  `0`, and exits `1` under `--fail-on-empty`. With nothing skipped, the summary
  lines keep their spelling.
- **`@objectstack/core`:** `QA.TestResult` gains `status` (`'passed' | 'failed' | 'skipped'`)
  and, on a skipped result, `skipped` (`reason`, `unmet[]`, `availableServices`);
  `passed` stays and is `false` on a skip. `TestRunner` takes an optional
  `{ env }` (default: this process's environment), and `TestExecutionAdapter`
  gains an optional `readTargetServices()` — `HttpTestAdapter` answers it from
  its one discovery probe. An adapter without it skips a service requirement
  rather than running it.

```
FROM  { "id": "ai-summary", "requires": { "plugins": ["@objectstack/service-ai"] }, "steps": [...] }
      -> ran anyway; the missing plugin surfaced as whatever failure it caused, or passed
TO    -> os test refuses the suite at load:
           ✗ scenarios.0.requires.plugins: `scenarios[].requires.plugins` was removed in
             @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — nothing ever checked it: …
             Delete the key and name the service the scenario needs in `requires.services`, …
             Plugin → service: @objectstack/service-analytics → analytics, @objectstack/plugin-auth → auth, …

FROM  { "requires": { "services": ["ai"] }, … }   (new key)
TO    -> against a target whose discovery does not declare `ai` enabled and available:
           ⏭️  Scenario: Summarise an account [ai-summary] (skipped)
              Skipped: requires.services 'ai' is not available on the target (…). The target declares available: …
```

**Fix.** `requires.plugins: ["<package>"]` → `requires.services: ["<service>"]`,
using the mapping the refusal prints (derived from `CORE_SERVICE_PROVIDER`, the
provider table discovery itself reports): `@objectstack/plugin-auth` → `auth`,
`@objectstack/service-analytics` → `analytics`, `@objectstack/service-automation`
→ `automation`, `@objectstack/service-storage` → `storage`, and so on; the `ai`
service is provided by ObjectStack Cloud/Enterprise. A plugin that fills no
discovery service slot has no service to require — gate that scenario with a
`params` variable or select it with `--tags`. `tsc` refuses `plugins` at a typed
authoring site (its input type is `never`). A `TestResult` consumer that counted
`!passed` as a failure should read `status` — a skipped result is `passed: false`
and is not a failure.

**What does not change.** A scenario without `requires` runs exactly as before,
and a suite that requires no service issues no discovery request it did not
already issue.

### The retirement kit

- **Schema.** `TestScenarioSchema.requires` is a non-strict `z.object()`, so
  `plugins` is a `retiredKey()` tombstone carrying its prescription (a bare
  deletion would have stripped it in silence); `services` is new, closed over
  `CoreServiceName`.
- **ADR-0087.** `RETIRED_KEYS_BY_MAJOR[18]` gains `qa/TestScenario:requires.plugins`.
  No D2 conversion: a QA suite is a loose JSON file `os test` loads, never a
  stack collection member or a stored row. The family's D3 entry,
  `qa-scenario-requires-plugins-retired`, carries the prescription to
  `os migrate meta` and the upgrade guide.
- **Ledger and docs.** `liveness/qa.json` moves `qa.scenarios.requires` from
  `dead` to `live`, citing the runner's judgement and the adapter as producer;
  `state-counts.md` moves `qa` to 9 live / 0 dead. The `os test` section of the
  CLI reference documents the check, the skip line and the exit posture, and the
  generated `qa/testing` reference page is regenerated.

<!-- adr-0087: registered qa-scenario-requires-plugins-retired -->
