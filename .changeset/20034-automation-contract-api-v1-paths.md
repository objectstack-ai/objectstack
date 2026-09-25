---
'@objectstack/spec': minor
---

`AutomationApiContracts` now names the paths the platform actually serves — `/api/v1/automation…` instead of `/api/automation…` (#20034).

The dispatcher mounts the automation door at its `prefix` plus `/automation`, the prefix defaults to `/api/v1`, and `objectstack serve` passes none. So all nine declared paths answered `404 ENDPOINT_NOT_FOUND` on the default composition while the same requests under `/api/v1/automation` answered `200`, and the generated API reference printed the nine unserved paths as the endpoints. Every other `*ApiContracts` map in `@objectstack/spec/api` already carried `/api/v1`; this one was the only outlier. The runtime is unchanged — only the declaration moves.

Clause-②: no

**What moved on the published surface**

| entry | from | to |
| --- | --- | --- |
| `listFlows` (`GET`), `createFlow` (`POST`) | `/api/automation` | `/api/v1/automation` |
| `getFlow` (`GET`), `updateFlow` (`PUT`), `deleteFlow` (`DELETE`) | `/api/automation/:name` | `/api/v1/automation/:name` |
| `triggerFlow` (`POST`) | `/api/automation/:name/trigger` | `/api/v1/automation/:name/trigger` |
| `toggleFlow` (`POST`) | `/api/automation/:name/toggle` | `/api/v1/automation/:name/toggle` |
| `listRuns` (`GET`) | `/api/automation/:name/runs` | `/api/v1/automation/:name/runs` |
| `getRun` (`GET`) | `/api/automation/:name/runs/:runId` | `/api/v1/automation/:name/runs/:runId` |

The module's `Base path` and endpoint list move with them, and so does the text `ListRunsRequestSchema` raises for a retired `cursor`: it now names `GET /api/v1/automation/:name/runs`.

**Who notices.** A caller that built request URLs from these constants was calling paths nothing served on the default composition; it now reaches the serving door with no code change. A caller that hard-coded one of the old strings should send the `/api/v1/automation…` form. The `path` type is unchanged (`string`), no accepted input narrows, and no method changes.

A host that mounts the dispatcher under a different prefix — `@objectstack/hono`'s `createHonoApp`, whose `prefix` defaults to `/api`, is the in-repo example — serves every contract family under that prefix, so it replaces the leading `/api/v1` of any `*ApiContracts` path, now including these nine. The environment-scoped mount (`/api/v1/environments/:environmentId/automation…`, the only one served under `projectResolution: 'required'`) is not declared here, as it is not in any other contract map.

**Kept from drifting again.** A new test in `@objectstack/runtime` boots the dispatcher plugin with its default prefix and requires every contract route to be one it mounts, and to be a row of the runtime route ledger under the `/api/v1` wire prefix that the live-mount parity gate probes.
