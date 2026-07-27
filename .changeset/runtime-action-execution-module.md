---
"@objectstack/runtime": minor
---

feat(runtime): extract the action-execution subsystem from the dispatcher — ADR-0076 D11 step ③, PR-8 (#2462)

The 16-helper machinery behind server-registered business actions
(declaration collection/resolution, ADR-0104 param enforcement, the
permission/AI-exposure gates, the engine facade + session shape, invocation,
and the `callData` protocol/ObjectQL bridge — ~560 lines) moves to
`action-execution.ts`, depending only on the narrow `ActionExecutionDeps`
slice (resolveService + getObjectQL; NO env-resolution state). The
ADR-0104 warn-once statics ride along as module functions. The dispatcher
keeps four thin delegates with in-class callers; twelve internal-only
helpers are called directly on the module. This is the pre-cut that turns
the `/actions` and `/mcp` domain extractions into mechanical moves (PR-9).
Zero behavior change — runtime 649, http-conformance 41, dogfood 351 green.
