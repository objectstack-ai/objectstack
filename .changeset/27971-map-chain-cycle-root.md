---
'@objectstack/service-automation': patch
---

fix(service-automation): a corrupt correlation cycle back to the resumed run no longer names that run as its own child

Clause-②: no
Metadata-protocol: none

The resume gate walks a run's linked-run chain to find the suspension a resume really continues. That walk now counts the caller's own run as already visited, so a corrupt `map:` / `subflow:` correlation that points back at it (A → B → A) ends the chain at B. The `409 RESUME_CHILD_PENDING` refusal then names the item run B to resume, never run A, the one the caller is already resuming.

The client's `resume()` docs, the service-automation README and the automation QA checklist now list `409 RESUME_CHILD_PENDING` beside the other resume refusals that leave the suspension intact.
