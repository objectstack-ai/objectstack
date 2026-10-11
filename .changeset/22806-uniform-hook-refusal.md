---
'@objectstack/trigger-api': minor
'@objectstack/spec': minor
---

fix(trigger-api,spec): every inbound hook post that does not verify gets one answer, `401 INVALID_SIGNATURE`, whatever its flow and hook id

Clause-②: yes

- **FROM → TO.** On `POST /api/v1/automation/hooks/:flowName/:hookId`, a post that named no armed flow, or the wrong hook id, answered `404 RESOURCE_NOT_FOUND`, while a post naming an armed flow and its hook id with an absent or bad `x-objectstack-signature` answered `401 INVALID_SIGNATURE`. Now all four answer `401 INVALID_SIGNATURE` with the same body, so the answer no longer tells an armed flow name from an unarmed one, whichever hook id a flow is armed with.
- **Who sees a difference.** A correctly configured sender (the flow's URL, its hook id, its secret) sees none: it still gets `202`. A sender posting to a flow that is not armed, or with a hook id that was rotated away, now gets `401` where it got `404`. A sender with a wrong secret or signing code still gets `401`, as before.
- **The cause is in the server log.** The trigger logs one `warn` line per refused post, with the cause and the flow name the post carried as structured fields: `cause` is one of `unknown-flow`, `wrong-hook-id`, `signature-absent`, `signature-malformed`, `signature-mismatch` or `signature-outside-window`. The line never carries the secret, the signature value or the body.
- **Unchanged: the `503` residual.** A post that names an armed flow and its hook id while that hook's secret cannot be read still answers `503 SERVICE_UNAVAILABLE`, signed or not, without verifying. It stays a `503` on purpose: it is the deployment's fault, a sender retries it, and it lasts only while the secret cannot be read. A wrong hook id never reaches the secret read, so it gets the uniform `401` even then.
- **`@objectstack/spec`.** The `ITriggerApiService.handleInboundHook` docblock states the one refusal and names the `503` as its residual. The type is unchanged.

**To adopt it.** A sender or monitor that read `404` from this route as "wrong URL" can no longer tell that from a bad signature by the answer: read the trigger's `warn` line for the post instead, whose `cause` names which one it was.
