---
"@objectstack/runtime": minor
---

feat(runtime): extract the /auth and /ai dispatcher domain bodies — ADR-0076 D11 step ③, PR-7 (#2462)

`/auth` (better-auth service bridge + the browser-safe mock fallback for
MSW/test environments, with the local `randomUUID` wrapper moving alongside
its only consumer) and `/ai` (dispatch to the AI plugin's kernel-cached
route table with per-route auth-contract enforcement and actor threading)
move to `domains/`. `DomainHandlerDeps` grows two lazily-read members:
`isAuthRequired()` (the deployment's requireAuth posture —
construction-order safe) and `getRegisteredAiRoutes()`. `/mcp` was
deliberately excluded: `buildMcpBridge` couples to the action-execution
family (callData / actionPermissionError / invokeBusinessAction), so it
goes with the /actions /meta /data deep-coupling batch. Zero behavior
change — http-conformance (41) plus 5 new seam tests.
