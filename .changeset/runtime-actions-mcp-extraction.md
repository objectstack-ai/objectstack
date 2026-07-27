---
"@objectstack/runtime": minor
---

feat(runtime): extract the /actions and /mcp dispatcher domain bodies — ADR-0076 D11 step ③, PR-9 (#2462)

The two deep-coupled domains ride the PR-8 action-execution subsystem out
of the dispatcher: `domains/actions.ts` (ADR-0066 D4 permission gate +
ADR-0104 param contract) and `domains/mcp.ts` (JSON-RPC transport,
`/mcp/skill` download, OAuth resource-metadata, the principal-bound tool
bridge). Env-resolution state stays behind two new deps seams —
`getDefaultEnvironmentId` and `resolveProjectKernelObjectQL` (the ADR-0006
direct-caller kernel swap, side effect dispatcher-owned). The legacy
`/mcp/skill`-before-`/mcp` precedence is reproduced with ordered registry
entries incl. the `?` forms; the actions redundant trailing-slash regex
(the CodeQL polynomial-redos twin) is dropped for split+filter. The authz
identity pin for `buildMcpBridge(context)` follows the body to
`domains/mcp.ts`. Zero behavior change — runtime 649, http-conformance 41,
dogfood 351 green.
