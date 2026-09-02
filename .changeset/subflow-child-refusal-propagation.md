---
'@objectstack/service-automation': patch
---

Answer a delegated subflow child's retryable refusal as a refusal, not as a terminal child failure.

A run paused at a `subflow` node forwards a resume down to the child it is parked on — the screen-flow path, where the caller holds one stable run id (the parent's) and posts every wizard step to it. When the child *refused* that bag (`INVALID_SCREEN_INPUT` for a missing `required` field, `INVALID_SIGNAL`, `RESUME_IN_PROGRESS`, `STORE_UNAVAILABLE`), the delegation read it as a child that ran and died: it failed the parent run, consumed the parent's suspension, orphaned the still-paused child, and answered a **code-less** envelope, which a transport maps to `400 FLOW_FAILED`. The corrected retry on the same run id then answered `RUN_NOT_FOUND` — one mistyped form field destroyed a running workflow.

The delegation now branches on the child's own `code`. A refusal is returned verbatim with its `code` intact (and the parent's `durationMs`), **both** pauses left live, so the corrected submission still lands on the same parent run id. A child that genuinely ran and failed still fails the parent exactly as before.
