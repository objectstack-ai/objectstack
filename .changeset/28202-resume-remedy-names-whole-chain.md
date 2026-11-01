---
'@objectstack/service-automation': patch
---

fix(service-automation): the `RESUME_CHILD_PENDING` remedy names every run of the suspension chain

Clause-②: no (message wording only)
Metadata-protocol: none

A resume of a batch (`map`) run whose item run is gone with no `cancelled` history is refused with `RESUME_CHILD_PENDING` (409), and the message tells the operator which runs to cancel to end the batch. When the map sat more than one `subflow:` link below the run they resumed, it named only the map's run and the resumed run. Cancelling a run never cascades, so each run in between stayed parked after the operator followed it. The remedy now names the map's run, then every run waiting on it in order, up to the resumed run. The code, the status and the contract text are unchanged.
