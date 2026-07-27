---
"@objectstack/runtime": minor
---

feat(runtime): extract the /automation dispatcher domain body — ADR-0076 D11 step ③, PR-6 (#2462)

The automation bridge (flow CRUD, trigger/execute, runs history,
pause/resume — the ADR-0018/0019/0022 surfaces, ~260 lines) moves to
`domains/automation.ts` with zero new deps-contract growth. The route-order
subtlety is preserved verbatim: `/actions`, `/connectors` and `/_status`
keep their guard positions before the `/:name → getFlow` catch-all. Zero
behavior change — http-conformance (41) plus 3 new seam tests.
