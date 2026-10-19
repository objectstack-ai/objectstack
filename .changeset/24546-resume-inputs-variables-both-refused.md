---
'@objectstack/runtime': minor
---

fix(runtime)!: a flow resume body that carries both `inputs` and `variables` is refused with `400 VALIDATION_FAILED`; it no longer answers 200 with the `variables` bag silently dropped

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape, export or error code is added, removed or renamed. The resume route's body is declared by no published schema, and its accepted key set is unchanged: `inputs`, `variables`, `output`, `branchLabel`. The route now refuses one combination it accepted before, a body carrying both `inputs` and `variables`, whose `variables` bag it never read. Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (an accept-set narrowing on a public HTTP door: `POST /api/v1/automation/:name/runs/:runId/resume`), shipped as `minor` under the launch-window convention for breaking changes.

`variables` is an accepted alias of `inputs` on the resume route: both name the screen submission. A body that carried both used to answer `200` with `success: true`, the run resumed on the `inputs` bag, and the `variables` bag was never read, even when it held a field the screen does not declare. Sent alone, that same bag is refused `400 INVALID_SCREEN_INPUT`.

- **Now.** A body carrying both keys answers the route's own validation-failure envelope: `400`, `error.code: 'VALIDATION_FAILED'`, and `details.fields` naming `inputs` and `variables` (code `invalid_value`). The message says to send `inputs` alone. The engine is never consulted, so the paused run stays parked and the same call with a corrected body resumes it.
- **Unchanged.** A body carrying `inputs` alone, or `variables` alone, is forwarded exactly as before, and the engine judges it exactly as before. A key whose value is `undefined` counts as absent, as it already did for the value-shape check. The unknown-key and value-shape refusals keep their messages and come first.

What to do. Send the screen submission under `inputs` only. `@objectstack/client`'s `automation.resume()` and the console's flow runner already send `inputs` alone, and the MCP `resume_run` tool builds its signal in process rather than through this body, so none of them is affected.
