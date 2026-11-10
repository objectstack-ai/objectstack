---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow `notify` step that delivered nothing now says so on its run-history row

Clause-②: no
Metadata-protocol: none

A `notify` step whose only channel was refused (for example `push` on a deployment with no push channel registered) used to record a clean `success`. The run history an admin reads was green, and the only place that said why nobody was notified was a server log line. The step now carries a warning on its run-history row that names each failed channel and its reason, such as `channel 'push' (1 delivery): channel 'push' not registered`. The Runs surface shows it on the step.

The step is still a `success`, and the run continues exactly as before: no `fault` edge fires, no `try_catch` catches it, and nothing that came after the step changes. A partial delivery (one channel refused while another delivered or was queued) carries the same warning, naming only the channel that failed. A step whose deliveries all succeeded or were queued has no warning. The run summary is unchanged: such a run already reads `acted: 0, unmeasured: 0`.
