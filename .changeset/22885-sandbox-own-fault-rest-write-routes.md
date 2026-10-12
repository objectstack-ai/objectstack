---
'@objectstack/rest': patch
---

A sandboxed hook or action that fails on the sandbox's own fault (a capability it was not granted, a `ctx.api` method that is missing or unavailable, a CPU budget or wall-clock ceiling, an install or marshal failure) is now answered by the hand-built write routes the way `POST /api/v1/data/:object` answers it: a withheld `500` with `Internal server error`. The runner's diagnostic text, which names the hook, the object and the capability, goes to the server log only.

Clause-②: no

Before, 23 write routes relayed that text to the caller: `POST /analytics/dataset/query`, `POST /security/explain`, `POST` and `DELETE /data/:object/:id/shares`, the three sharing-rule writes, the two suggested-binding writes, the nine approval-request writes, `POST /packages/publish` and the four `POST /datasources/:name/external/*` routes. Most of them answered `500` with their own fault code, and the four external routes answered `400`. Twenty-one of them now answer `500 INTERNAL_ERROR`, the answer each already gave a sandboxed body that crashed. The record-share routes (and the share list, `GET /data/:object/:id/shares`) keep their own `500` and `SHARE_*_FAILED` code, as they do for a crash, and withhold the sentence the same way.

A refusal a sandboxed body throws keeps its own sentence and status on every route. No key, default, enum member or export moves.
