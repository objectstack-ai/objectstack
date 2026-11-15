---
'@objectstack/service-automation': patch
---

fix(service-automation): a catalog connector descriptor saved active through `PUT /api/v1/meta/connector/:name` now gets the inert-connector warning at once

Clause-②: no
Metadata-protocol: none

The warning `[Automation] N declarative connector(s) declare actions but are not registered …` used to run only at boot and on `metadata:reloaded`. A direct active save raises neither, so a descriptor with actions and no runtime connector behind it stayed unreported until a later publish or a restart. The audit now also runs after the connector reconcile that a connector metadata change queues, so the save door reports it.

The warning is now printed when the set of inert descriptors changes, and it still names the whole set. A publish raises both the mutation signal and `metadata:reloaded`, and it still prints the warning once. A reload or save that leaves the set as it was prints nothing new. Before, every reload repeated the warning.
