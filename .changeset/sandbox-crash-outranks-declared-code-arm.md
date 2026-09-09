---
"@objectstack/rest": patch
---

fix(rest): a hook that crashes after declaring a code now answers 500 UNCLASSIFIED_FAULT instead of the declared status with the crash text (#15071)

**What changes for an operator.** A sandboxed hook or action body that declared a
refusal code and then CRASHED — `throw`-ing nothing, but hitting a bug on a later
line — used to answer the single-record `/api/v1/data` routes with the code's own
business status and the QuickJS debug sentence as the client-facing message, for
example `409 DELETE_RESTRICTED · "hook 'guard' threw: TypeError: x is not a
function"`. It now answers `500 UNCLASSIFIED_FAULT` with the sanitised message
and no crash text, which is what the same crash carrying no declared code has
always answered. The full wrapper still reaches the server log through the
existing `[REST] Unhandled error` / withheld-fault path, so nothing an operator
diagnoses with is lost.

**What does NOT change.** An ordinary declared refusal — a hook that throws a
business error carrying a code and does not crash — is untouched: same status,
same code, same sentence, same structured fields. So is every non-sandbox
producer of those codes, and so is the `developerMessage` channel, which keeps
the rule it already had for a fault.

**Why.** A declared code is the author's statement about the failure mode they
handled; a crash is not that mode. Answering one with a business status shipped
an internal, stack-shaped sentence to an end user and told the client the wrong
thing about what happened, while the door one branch down already sanitised the
identical crash. Maintainer ruling, 2026-09-04, decision batch #27, on #15071.

**If you were relying on the old answer,** the affected shape is a hook that
declares one of the classification's ten code-gated refusals and then faults: it
now surfaces as a 5xx to clients and retry policies rather than as a 4xx. That is
the point of the change — the crash was never the refusal the code named.
